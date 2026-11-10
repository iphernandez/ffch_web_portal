import { Injectable, effect, signal, untracked } from '@angular/core';
import {
  Unsubscribe,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch
} from 'firebase/firestore';
import { firestore } from './firebase';
import { AuthService } from './auth.service';
import { DataStoreService } from './data-store.service';
import { RemoteSyncService } from './remote-sync.service';
import { EventReportService } from './event-report.service';
import { environment } from '../../../environments/environment';
import { EventRegistration, FfchEvent, GUEST_NAME_MAX_LENGTH, eventYear } from '../models/event.model';
import { TdpHistoryEntry } from '../models/tdp.model';

const EVENTS_COLLECTION = 'events';
const REGISTRATIONS_SUBCOLLECTION = 'registrations';
const ACTIVE_EVENT_DOC = 'meta/activeEvent';

interface PendingAttendance {
  eventId: string;
  userId: string;
  entry: TdpHistoryEntry;
}

/**
 * Event registration (Pre Temporada / Galas / Team Building). Events and registrations live in their own
 * Firestore collections because non-admins can't write the shared `data/ffch-puntuacion` document; an admin
 * client later folds "attending" registrations into the shared TDP history (see applyRegistrationsToTdp).
 */
@Injectable({ providedIn: 'root' })
export class EventService {
  /** The single enabled event (live), or null when registration is closed for everyone. */
  readonly activeEvent = signal<FfchEvent | null>(null);

  private watchedUserId: string | null = null;
  private unsubscribeActive?: Unsubscribe;
  private unsubscribeEvent?: Unsubscribe;

  constructor(
    private readonly auth: AuthService,
    private readonly store: DataStoreService,
    private readonly remoteSync: RemoteSyncService,
    private readonly report: EventReportService
  ) {
    effect(() => {
      const userId = this.auth.currentUser()?.id ?? null;
      untracked(() => this.watchActiveEvent(userId));
    });
  }

  async getActiveEventId(): Promise<string | null> {
    const snapshot = await getDoc(doc(firestore, ACTIVE_EVENT_DOC));
    return (snapshot.data()?.['eventId'] as string | null | undefined) ?? null;
  }

  async fetchActiveEvent(): Promise<FfchEvent | null> {
    const id = await this.getActiveEventId();
    return id ? this.getEvent(id) : null;
  }

  async getEvent(id: string): Promise<FfchEvent | null> {
    const snapshot = await getDoc(doc(firestore, EVENTS_COLLECTION, id));
    return snapshot.exists() ? ({ ...(snapshot.data() as FfchEvent), id }) : null;
  }

  async listEvents(): Promise<FfchEvent[]> {
    const snapshot = await getDocs(collection(firestore, EVENTS_COLLECTION));
    return snapshot.docs
      .map((d) => ({ ...(d.data() as FfchEvent), id: d.id }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  async saveEvent(event: FfchEvent): Promise<void> {
    await setDoc(doc(firestore, EVENTS_COLLECTION, event.id), { ...event, updatedAt: new Date().toISOString() });
  }

  /** A single pointer document guarantees at most one event is enabled at a time. */
  async setActiveEvent(eventId: string | null): Promise<void> {
    await setDoc(doc(firestore, ACTIVE_EVENT_DOC), { eventId, updatedAt: new Date().toISOString() });
  }

  async listRegistrations(eventId: string): Promise<EventRegistration[]> {
    const snapshot = await getDocs(collection(firestore, EVENTS_COLLECTION, eventId, REGISTRATIONS_SUBCOLLECTION));
    return snapshot.docs
      .map((d) => d.data() as EventRegistration)
      .sort((a, b) => a.playerName.localeCompare(b.playerName));
  }

  async getMyRegistration(eventId: string): Promise<EventRegistration | null> {
    const userId = this.auth.currentUser()?.id;
    if (!userId) return null;
    const snapshot = await getDoc(doc(firestore, EVENTS_COLLECTION, eventId, REGISTRATIONS_SUBCOLLECTION, userId));
    return snapshot.exists() ? (snapshot.data() as EventRegistration) : null;
  }

  /** Creates the user's registration; Firestore rules reject any later edit by the user. */
  async submitRegistration(eventId: string, registration: EventRegistration): Promise<void> {
    await setDoc(
      doc(firestore, EVENTS_COLLECTION, eventId, REGISTRATIONS_SUBCOLLECTION, registration.userId),
      registration
    );
  }

  /** Admin-only: adds a named attendee with no account or roster player; Firestore rules allow admins to create any id. */
  async addGuest(eventId: string, name: string, addedBy: string, existing: EventRegistration[]): Promise<EventRegistration> {
    const playerName = name.trim().replace(/\s+/g, ' ').slice(0, GUEST_NAME_MAX_LENGTH);
    if (!playerName) throw new Error('Escribe el nombre del invitado.');
    const lower = playerName.toLocaleLowerCase('es');
    if (existing.some((registration) => registration.playerName.toLocaleLowerCase('es') === lower)) {
      throw new Error(`Ya hay alguien en la lista con el nombre "${playerName}".`);
    }

    const registration: EventRegistration = {
      userId: `guest-${crypto.randomUUID()}`,
      userName: 'Invitado',
      playerId: '',
      playerName,
      attending: true,
      answers: {},
      submittedAt: new Date().toISOString(),
      registeredBy: addedBy,
      guest: true
    };
    await this.submitRegistration(eventId, registration);
    return registration;
  }

  /**
   * Queues a confirmation email in the collection watched by the `sendQueuedMail` Cloud Function
   * (the browser can't send email itself). Returns false when emails are disabled.
   */
  async sendConfirmationEmail(to: string, event: FfchEvent, registration: EventRegistration): Promise<boolean> {
    if (!environment.mailCollection || !to) return false;
    await addDoc(collection(firestore, environment.mailCollection), {
      to: [to],
      message: this.report.confirmationEmail(event, registration, environment.eventPageUrl),
      createdAt: new Date().toISOString()
    });
    return true;
  }

  /** Admin-only: deleting a registration lets that user submit again (e.g. they made a mistake). */
  async deleteRegistration(eventId: string, userId: string): Promise<void> {
    await deleteDoc(doc(firestore, EVENTS_COLLECTION, eventId, REGISTRATIONS_SUBCOLLECTION, userId));
  }

  /** TDP entries implied by "attending" registrations that an admin hasn't folded into the shared data yet. */
  async pendingTdpEntries(): Promise<TdpHistoryEntry[]> {
    return (await this.pendingAttendance()).map((item) => item.entry);
  }

  /**
   * Admin-only: writes pending attendance into the shared Firestore TDP history (merged onto the latest
   * remote version, so unpushed local edits aren't overwritten) and into local IndexedDB, then marks the
   * registrations as applied so later manual TDP edits by an admin are not re-overridden.
   */
  async applyRegistrationsToTdp(): Promise<number> {
    if (!this.auth.currentUser()?.isAdmin) return 0;
    const pending = await this.pendingAttendance();
    if (!pending.length) return 0;

    const entries = [...new Map(pending.map((item) => [item.entry.id, item.entry])).values()];
    const remote = await this.remoteSync.pull();
    if (remote) {
      const history = new Map(remote.data.tdpHistory.map((entry) => [entry.id, entry]));
      for (const entry of entries) history.set(entry.id, entry);
      await this.remoteSync.push({ ...remote.data, tdpHistory: [...history.values()] }, remote.version);
    }
    await this.store.tdpHistory.bulkPut(entries);

    const batch = writeBatch(firestore);
    for (const item of pending) {
      batch.update(doc(firestore, EVENTS_COLLECTION, item.eventId, REGISTRATIONS_SUBCOLLECTION, item.userId), {
        appliedToTdp: true
      });
    }
    await batch.commit();
    return entries.length;
  }

  private async pendingAttendance(): Promise<PendingAttendance[]> {
    const events = await this.listEvents();
    const perEvent = await Promise.all(
      events.map(async (event) => {
        const registrations = await this.listRegistrations(event.id);
        const year = eventYear(event);
        return registrations
          .filter((registration) => registration.attending && !registration.appliedToTdp && registration.playerId)
          .map((registration) => ({
            eventId: event.id,
            userId: registration.userId,
            entry: {
              id: `${registration.playerId}-${event.category}-${year}`,
              playerId: registration.playerId,
              category: event.category,
              year,
              participated: true
            }
          }));
      })
    );
    return perEvent.flat();
  }

  private watchActiveEvent(userId: string | null): void {
    if (userId === this.watchedUserId) return;
    this.watchedUserId = userId;
    this.unsubscribeActive?.();
    this.unsubscribeEvent?.();
    this.activeEvent.set(null);
    if (!userId) return;

    this.unsubscribeActive = onSnapshot(
      doc(firestore, ACTIVE_EVENT_DOC),
      (snapshot) => {
        this.unsubscribeEvent?.();
        const id = snapshot.data()?.['eventId'] as string | null | undefined;
        if (!id) {
          this.activeEvent.set(null);
          return;
        }
        this.unsubscribeEvent = onSnapshot(
          doc(firestore, EVENTS_COLLECTION, id),
          (eventSnapshot) =>
            this.activeEvent.set(eventSnapshot.exists() ? { ...(eventSnapshot.data() as FfchEvent), id } : null),
          () => this.activeEvent.set(null)
        );
      },
      (error) => {
        console.error('No se pudo leer el evento activo:', error);
        this.activeEvent.set(null);
      }
    );
  }
}
