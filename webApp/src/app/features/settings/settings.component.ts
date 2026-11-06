import { Component, computed, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DataStoreService } from '../../core/services/data-store.service';
import { RemoteSyncService } from '../../core/services/remote-sync.service';
import { CsvImportService } from '../../core/services/csv-import.service';
import { FfchData } from '../../core/models/ffch-data.model';
import {
  EVENT_CATEGORIES,
  EventAnswers,
  EventCategory,
  EventOption,
  EventRegistration,
  FfchEvent,
  eventCategoryLabel,
  eventId,
  formatEventDate,
  safeHttpUrl
} from '../../core/models/event.model';
import { Player } from '../../core/models/player.model';
import { PublicUser } from '../../core/models/user.model';
import { AuthService } from '../../core/services/auth.service';
import { EventReportService } from '../../core/services/event-report.service';
import { EventService } from '../../core/services/event.service';
import { EventAnswersComponent } from '../event/event-answers.component';

interface DraftOption extends EventOption {
  /** Comma-separated editor text for `choices`. */
  choicesText: string;
}

interface EventDraft {
  category: EventCategory;
  title: string;
  description: string;
  date: string;
  deadline: string;
  location: string;
  locationUrl: string;
  options: DraftOption[];
}

function emptyDraft(): EventDraft {
  return {
    category: 'pretemporada',
    title: '',
    description: '',
    date: '',
    deadline: '',
    location: '',
    locationUrl: '',
    options: []
  };
}

function shiftYear(value: string): string {
  return value ? `${Number(value.slice(0, 4)) + 1}${value.slice(4)}` : '';
}

@Component({
  selector: 'app-settings',
  imports: [FormsModule, NgTemplateOutlet, EventAnswersComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent {
  readonly statusMessage = signal('');
  readonly lastVersion = signal<number | null>(null);
  readonly csvWarnings = signal<string[]>([]);

  readonly eventCategories = EVENT_CATEGORIES;
  readonly eventList = signal<FfchEvent[]>([]);
  readonly activeEventId = signal<string | null>(null);
  readonly registrationsEventId = signal<string | null>(null);
  readonly registrations = signal<EventRegistration[]>([]);
  readonly eventMessage = signal('');
  readonly formatDate = formatEventDate;
  readonly categoryLabel = eventCategoryLabel;

  /** Active event stays in the main list even if its date passed; other past events are archived. */
  readonly upcomingEvents = computed(() =>
    this.eventList().filter((event) => !this.isPast(event) || event.id === this.activeEventId())
  );
  readonly pastEvents = computed(() =>
    this.eventList().filter((event) => this.isPast(event) && event.id !== this.activeEventId())
  );
  readonly registrationsEvent = computed(() =>
    this.eventList().find((event) => event.id === this.registrationsEventId())
  );
  readonly usage = computed(() => {
    const event = this.registrationsEvent();
    return event ? this.report.usage(event, this.registrations()) : {};
  });

  readonly players = signal<Player[]>([]);
  readonly users = signal<PublicUser[]>([]);
  readonly behalfPlayers = computed(() => {
    const registered = new Set(this.registrations().map((registration) => registration.playerId));
    return this.players().filter((player) => !registered.has(player.id));
  });
  readonly whatsappText = signal('');
  behalfPlayerId = '';
  behalfAttending = true;
  behalfAnswers: EventAnswers = {};

  draft: EventDraft = emptyDraft();
  /** Id of the event loaded into the editor, to warn before overwriting a different existing one. */
  editingId: string | null = null;

  constructor(
    private readonly store: DataStoreService,
    private readonly remoteSync: RemoteSyncService,
    private readonly csvImport: CsvImportService,
    private readonly events: EventService,
    private readonly report: EventReportService,
    private readonly auth: AuthService
  ) {
    void this.loadEvents();
  }

  async loadEvents(): Promise<void> {
    try {
      const [eventList, activeId] = await Promise.all([this.events.listEvents(), this.events.getActiveEventId()]);
      this.eventList.set(eventList);
      this.activeEventId.set(activeId);
    } catch (error) {
      this.eventMessage.set(this.errorMessage(error));
    }
  }

  newEvent(): void {
    this.draft = emptyDraft();
    this.editingId = null;
  }

  editEvent(event: FfchEvent): void {
    this.draft = {
      category: event.category,
      title: event.title,
      description: event.description,
      date: event.date,
      deadline: event.deadline ?? '',
      location: event.location,
      locationUrl: event.locationUrl ?? '',
      options: event.options.map((option) => ({
        ...option,
        required: option.required ?? false,
        limit: option.limit ?? null,
        choicesText: (option.choices ?? []).join(', ')
      }))
    };
    this.editingId = event.id;
  }

  /** Events repeat yearly with new details: copy into the editor for next year, keeping the old one as history. */
  duplicateToNextYear(event: FfchEvent): void {
    this.editEvent(event);
    this.draft.date = shiftYear(this.draft.date);
    this.draft.deadline = shiftYear(this.draft.deadline);
    this.draft.options = this.draft.options.map((option) => ({ ...option, id: crypto.randomUUID() }));
    this.editingId = null;
    this.eventMessage.set(`Copiado a ${this.draft.date.slice(0, 4)}. Revisa los detalles y guarda.`);
  }

  addOption(): void {
    this.draft.options = [
      ...this.draft.options,
      { id: crypto.randomUUID(), label: '', type: 'checkbox', required: false, limit: null, choicesText: '' }
    ];
  }

  removeOption(optionId: string): void {
    this.draft.options = this.draft.options.filter((option) => option.id !== optionId);
  }

  async saveEvent(): Promise<void> {
    const { category, date, deadline } = this.draft;
    const title = this.draft.title.trim();
    const location = this.draft.location.trim();
    if (!title || !date || !location) {
      this.eventMessage.set('Título, fecha y lugar son obligatorios.');
      return;
    }
    if (deadline && deadline > date) {
      this.eventMessage.set('La fecha límite de inscripción debe ser antes del evento.');
      return;
    }
    const locationUrl = this.draft.locationUrl.trim() ? safeHttpUrl(this.draft.locationUrl) : null;
    if (this.draft.locationUrl.trim() && !locationUrl) {
      this.eventMessage.set('El enlace del lugar debe ser una URL completa que empiece con http:// o https://.');
      return;
    }
    const options: EventOption[] = this.draft.options
      .map((option) => ({
        id: option.id,
        label: option.label.trim(),
        type: option.type,
        required: !!option.required,
        limit: option.type !== 'text' && option.limit && option.limit > 0 ? Math.floor(option.limit) : null,
        choices:
          option.type === 'choice'
            ? [...new Set(option.choicesText.split(',').map((choice) => choice.trim()).filter(Boolean))]
            : []
      }))
      .filter((option) => option.label);
    const emptyChoice = options.find((option) => option.type === 'choice' && !option.choices?.length);
    if (emptyChoice) {
      this.eventMessage.set(`Agrega al menos un valor (separados por coma) para "${emptyChoice.label}".`);
      return;
    }

    const id = eventId(category, date);
    if (id !== this.editingId && this.eventList().some((event) => event.id === id)) {
      if (!confirm(`Ya existe un evento ${this.categoryLabel(category)} ${date.slice(0, 4)}. ¿Sobrescribirlo?`)) return;
    }

    const event: FfchEvent = {
      id,
      category,
      title,
      description: this.draft.description.trim(),
      date,
      location,
      locationUrl,
      options,
      deadline: deadline || null,
      deadlineMs: deadline ? new Date(deadline).getTime() : null,
      updatedAt: new Date().toISOString()
    };
    try {
      await this.events.saveEvent(event);
      this.editingId = id;
      this.eventMessage.set(`Evento "${title}" guardado.`);
      await this.loadEvents();
    } catch (error) {
      this.eventMessage.set(this.errorMessage(error));
    }
  }

  async setActiveEvent(id: string | null): Promise<void> {
    try {
      await this.events.setActiveEvent(id);
      this.activeEventId.set(id);
      this.eventMessage.set(id ? 'Evento habilitado; los demás quedan deshabilitados.' : 'Todos los eventos deshabilitados.');
    } catch (error) {
      this.eventMessage.set(this.errorMessage(error));
    }
  }

  async showRegistrations(id: string): Promise<void> {
    try {
      const [registrations, players, users] = await Promise.all([
        this.events.listRegistrations(id),
        this.players().length ? this.players() : this.store.players.orderBy('galactico').toArray(),
        this.users().length ? this.users() : this.auth.listUsers()
      ]);
      this.registrations.set(registrations);
      this.players.set(players);
      this.users.set(users);
      this.registrationsEventId.set(id);
      this.whatsappText.set('');
      this.resetBehalfForm();
    } catch (error) {
      this.eventMessage.set(this.errorMessage(error));
    }
  }

  /** Admin registers a player (e.g. without an account); uses the linked account's uid when there is one. */
  async submitOnBehalf(): Promise<void> {
    const event = this.registrationsEvent();
    const admin = this.auth.currentUser();
    const player = this.players().find((item) => item.id === this.behalfPlayerId);
    if (!event || !admin || !player) {
      this.eventMessage.set('Selecciona un jugador.');
      return;
    }
    const answers = this.behalfAttending ? this.report.clean(event.options, this.behalfAnswers) : {};
    const invalid = this.behalfAttending ? this.report.validate(event, answers, this.registrations()) : null;
    if (invalid) {
      this.eventMessage.set(invalid);
      return;
    }

    const linkedUser = this.users().find((user) => user.playerId === player.id);
    const registration: EventRegistration = {
      userId: linkedUser?.id ?? `player-${player.id}`,
      userName: linkedUser?.name ?? '—',
      playerId: player.id,
      playerName: player.galactico,
      attending: this.behalfAttending,
      answers,
      submittedAt: new Date().toISOString(),
      registeredBy: admin.name
    };
    try {
      await this.events.submitRegistration(event.id, registration);
      this.registrations.update((items) =>
        [...items, registration].sort((a, b) => a.playerName.localeCompare(b.playerName))
      );
      this.resetBehalfForm();
      this.eventMessage.set(`Inscripción de ${player.galactico} guardada.`);
      if (linkedUser) {
        try {
          if (await this.events.sendConfirmationEmail(linkedUser.email, event, registration)) {
            this.eventMessage.set(`Inscripción de ${player.galactico} guardada; confirmación enviada a ${linkedUser.email}.`);
          }
        } catch (error) {
          console.error('No se pudo enviar el correo de confirmación:', error);
        }
      }
      if (registration.attending) await this.applyRegistrationsToTdp();
    } catch (error) {
      this.eventMessage.set(this.errorMessage(error));
    }
  }

  downloadCsv(): void {
    const event = this.registrationsEvent();
    if (!event) return;
    const blob = new Blob([this.report.toCsv(event, this.registrations())], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inscripciones-${event.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async copyWhatsapp(): Promise<void> {
    const event = this.registrationsEvent();
    if (!event) return;
    const text = this.report.toWhatsapp(event, this.registrations());
    this.whatsappText.set(text);
    try {
      await navigator.clipboard.writeText(text);
      this.eventMessage.set('Resumen copiado al portapapeles.');
    } catch {
      this.eventMessage.set('No se pudo copiar automáticamente; copia el texto manualmente.');
    }
  }

  private resetBehalfForm(): void {
    this.behalfPlayerId = '';
    this.behalfAttending = true;
    this.behalfAnswers = this.report.emptyAnswers(this.registrationsEvent()?.options ?? []);
  }

  private isPast(event: FfchEvent): boolean {
    return new Date(event.date).getTime() < Date.now();
  }

  async deleteRegistration(registration: EventRegistration): Promise<void> {
    const id = this.registrationsEventId();
    if (!id) return;
    if (!confirm(`¿Eliminar la inscripción de ${registration.playerName}? Podrá volver a inscribirse.`)) return;
    try {
      await this.events.deleteRegistration(id, registration.userId);
      this.registrations.update((items) => items.filter((item) => item.userId !== registration.userId));
    } catch (error) {
      this.eventMessage.set(this.errorMessage(error));
    }
  }

  async applyRegistrationsToTdp(): Promise<void> {
    try {
      const applied = await this.events.applyRegistrationsToTdp();
      this.eventMessage.set(
        applied ? `${applied} asistencia(s) aplicadas al TDP y guardadas en Firestore.` : 'No hay asistencias pendientes.'
      );
      const id = this.registrationsEventId();
      if (id) await this.showRegistrations(id);
    } catch (error) {
      this.eventMessage.set(this.errorMessage(error));
    }
  }

  registrationAnswer(registration: EventRegistration, option: EventOption): string {
    return this.report.answerText(registration, option);
  }

  async pullFromFirestore(): Promise<void> {
    try {
      const remote = await this.remoteSync.pull();
      if (!remote) {
        this.statusMessage.set('Todavía no hay datos guardados en Firestore.');
        return;
      }
      await this.store.importAll(remote.data);
      this.lastVersion.set(remote.version);
      this.statusMessage.set('Datos sincronizados desde Firestore.');
    } catch (error) {
      this.statusMessage.set(this.errorMessage(error));
    }
  }

  async pushToFirestore(): Promise<void> {
    try {
      const remote = await this.remoteSync.pull();
      const expectedVersion = remote?.version ?? 0;
      const data = await this.store.exportAll();
      const newVersion = await this.remoteSync.push(data, expectedVersion);
      this.lastVersion.set(newVersion);
      this.statusMessage.set('Datos guardados en Firestore.');
    } catch (error) {
      this.statusMessage.set(this.errorMessage(error));
    }
  }

  async exportJson(): Promise<void> {
    const data = await this.store.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ffch-puntuacion.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async importJsonFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const text = await file.text();
    const data = JSON.parse(text) as FfchData;
    await this.store.importAll(data);
    this.statusMessage.set('Datos importados desde archivo JSON.');
  }

  async importCsv(puntosInput: HTMLInputElement, tdpInput: HTMLInputElement): Promise<void> {
    const puntosFile = puntosInput.files?.[0];
    const tdpFile = tdpInput.files?.[0];
    if (!puntosFile || !tdpFile) {
      this.statusMessage.set('Selecciona ambos archivos CSV (Puntos y TDP).');
      return;
    }
    const [puntosText, tdpText] = await Promise.all([puntosFile.text(), tdpFile.text()]);
    const { data, warnings } = this.csvImport.import(puntosText, tdpText);
    this.csvWarnings.set(warnings);
    await this.store.importAll(data);
    this.statusMessage.set(`Importación CSV completa: ${data.players.length} jugadores, ${data.weeklyRecords.length} registros semanales.`);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Error desconocido.';
  }
}
