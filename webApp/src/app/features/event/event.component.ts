import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  EventAnswers,
  EventOption,
  EventRegistration,
  FfchEvent,
  eventCategoryLabel,
  eventYear,
  formatEventDate,
  isRegistrationOpen
} from '../../core/models/event.model';
import { Player } from '../../core/models/player.model';
import { AuthService } from '../../core/services/auth.service';
import { DataStoreService } from '../../core/services/data-store.service';
import { EventReportService } from '../../core/services/event-report.service';
import { EventService } from '../../core/services/event.service';
import { EventAnswersComponent } from './event-answers.component';

const LAST_PLAYER_SETTING = 'event:lastPlayerId';

@Component({
  selector: 'app-event',
  imports: [FormsModule, EventAnswersComponent],
  templateUrl: './event.component.html',
  styleUrl: './event.component.scss'
})
export class EventComponent {
  readonly event = signal<FfchEvent | null>(null);
  readonly players = signal<Player[]>([]);
  readonly registrations = signal<EventRegistration[]>([]);
  readonly myRegistration = signal<EventRegistration | null>(null);
  readonly submitting = signal(false);
  readonly statusMessage = signal('');

  readonly availablePlayers = computed(() => {
    const claimed = new Set(this.registrations().map((registration) => registration.playerId));
    return this.players().filter((player) => !claimed.has(player.id));
  });
  readonly attendees = computed(() => this.registrations().filter((registration) => registration.attending));
  /** Player linked to the account in Usuarios; when set, the user can't pick a different one. */
  readonly linkedPlayer = computed(() => {
    const playerId = this.auth.currentUser()?.playerId;
    return playerId ? (this.players().find((player) => player.id === playerId) ?? null) : null;
  });
  readonly usage = computed(() => {
    const event = this.event();
    return event ? this.report.usage(event, this.registrations()) : {};
  });
  readonly open = computed(() => {
    const event = this.event();
    return !!event && isRegistrationOpen(event);
  });
  readonly formatDate = formatEventDate;

  playerId = '';
  attending = false;
  answers: EventAnswers = {};

  constructor(
    private readonly events: EventService,
    private readonly store: DataStoreService,
    private readonly auth: AuthService,
    private readonly report: EventReportService,
    private readonly router: Router
  ) {
    void this.load();
  }

  async load(): Promise<void> {
    try {
      const event = await this.events.fetchActiveEvent();
      if (!event) {
        await this.router.navigateByUrl('/');
        return;
      }
      const [players, registrations, mine, lastPlayerId] = await Promise.all([
        this.store.players.orderBy('galactico').toArray(),
        this.events.listRegistrations(event.id),
        this.events.getMyRegistration(event.id),
        this.store.getSetting(LAST_PLAYER_SETTING)
      ]);
      this.event.set(event);
      this.players.set(players);
      this.registrations.set(registrations);
      this.myRegistration.set(mine);
      this.answers = this.report.emptyAnswers(event.options);
      const linked = this.linkedPlayer();
      if (linked) {
        this.playerId = linked.id;
        if (!this.myRegistration() && !this.availablePlayers().some((player) => player.id === linked.id)) {
          this.statusMessage.set(`${linked.galactico} ya tiene una inscripción de otra cuenta. Contacta a un administrador.`);
        }
      } else if (lastPlayerId && this.availablePlayers().some((player) => player.id === lastPlayerId)) {
        this.playerId = lastPlayerId;
      }
    } catch (error) {
      this.statusMessage.set(this.errorMessage(error));
    }
  }

  async submit(): Promise<void> {
    const event = this.event();
    const user = this.auth.currentUser();
    const player = this.players().find((item) => item.id === this.playerId);
    if (!event || !user || this.myRegistration()) return;
    if (!player) {
      this.statusMessage.set('Selecciona tu jugador.');
      return;
    }
    if (!isRegistrationOpen(event)) {
      this.statusMessage.set('Las inscripciones para este evento ya cerraron.');
      return;
    }
    const answers = this.attending ? this.report.clean(event.options, this.answers) : {};
    const invalid = this.attending ? this.report.validate(event, answers, this.registrations()) : null;
    if (invalid) {
      this.statusMessage.set(invalid);
      return;
    }
    if (!confirm('Una vez enviada, tu inscripción no se puede modificar. ¿Enviar?')) return;

    const registration: EventRegistration = {
      userId: user.id,
      userName: user.name,
      playerId: player.id,
      playerName: player.galactico,
      attending: this.attending,
      answers,
      submittedAt: new Date().toISOString()
    };

    this.submitting.set(true);
    try {
      await this.events.submitRegistration(event.id, registration);
      this.myRegistration.set(registration);
      this.registrations.update((items) => [...items, registration]);
      await this.store.setSetting(LAST_PLAYER_SETTING, player.id);
      this.statusMessage.set('¡Inscripción enviada!');
    } catch (error) {
      this.statusMessage.set(this.errorMessage(error));
      this.submitting.set(false);
      return;
    }

    if (registration.attending && user.isAdmin) {
      try {
        await this.events.applyRegistrationsToTdp();
        this.statusMessage.set('¡Inscripción enviada! TDP actualizado en Firestore.');
      } catch (error) {
        this.statusMessage.set(`Inscripción enviada, pero no se pudo actualizar el TDP: ${this.errorMessage(error)}`);
      }
    }
    this.submitting.set(false);
  }

  categoryLabel(event: FfchEvent): string {
    return `${eventCategoryLabel(event.category)} ${eventYear(event)}`;
  }

  answerText(registration: EventRegistration, option: EventOption): string {
    return this.report.answerText(registration, option);
  }

  private errorMessage(error: unknown): string {
    if ((error as { code?: string })?.code === 'permission-denied') {
      return 'No se pudo guardar: el evento ya no está habilitado, las inscripciones cerraron o ya enviaste tu inscripción.';
    }
    return error instanceof Error ? error.message : 'Error desconocido.';
  }
}
