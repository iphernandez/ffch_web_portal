import { PercentPipe } from '@angular/common';
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Player } from '../../core/models/player.model';
import { SeasonConfig } from '../../core/models/season-config.model';
import { TdpCategory, TdpHistoryCategory, TdpHistoryEntry, TdpWeights } from '../../core/models/tdp.model';
import { AuthService } from '../../core/services/auth.service';
import { DataStoreService } from '../../core/services/data-store.service';
import { EventService } from '../../core/services/event.service';
import { ScoringService } from '../../core/services/scoring.service';

const TDP_CATEGORIES: Array<{ value: TdpHistoryCategory; label: string }> = [
  { value: 'anualidad', label: 'Año (Anualidad)' },
  { value: 'pretemporada', label: 'Pre Temporada' },
  { value: 'gala', label: 'Galas' },
  { value: 'partidoPavo', label: 'Partido del Pavo' },
  { value: 'anfitrionGala', label: 'Anfitrión Gala' },
  { value: 'teamBuilding', label: 'Team Building' }
];

const TDP_WEIGHT_CATEGORIES: Array<{ value: TdpCategory; label: string }> = [
  ...TDP_CATEGORIES,
  { value: 'socioFundador', label: 'Socio Fundador' }
];

@Component({
  selector: 'app-tdp',
  imports: [FormsModule, PercentPipe],
  templateUrl: './tdp.component.html',
  styleUrl: './tdp.component.scss'
})
export class TdpComponent {
  readonly categories = TDP_CATEGORIES;
  readonly weightCategories = TDP_WEIGHT_CATEGORIES;
  readonly players = signal<Player[]>([]);
  readonly seasonConfig = signal<SeasonConfig | null>(null);
  readonly yearParticipation = signal<Record<string, Partial<Record<TdpHistoryCategory, boolean>>>>({});
  readonly tdpValues = signal<Record<string, number>>({});
  readonly eventSyncMessage = signal('');
  year = new Date().getFullYear();

  private history: TdpHistoryEntry[] = [];

  constructor(
    private readonly store: DataStoreService,
    private readonly scoring: ScoringService,
    private readonly auth: AuthService,
    private readonly events: EventService
  ) {
    void this.load();
  }

  get isAdmin(): boolean {
    return this.auth.currentUser()?.isAdmin ?? false;
  }

  async load(): Promise<void> {
    const pendingFromEvents = await this.syncEventAttendance();
    const [players, seasonConfig, history] = await Promise.all([
      this.store.players.orderBy('posicion').toArray(),
      this.store.getSeasonConfig(),
      this.store.tdpHistory.toArray()
    ]);
    this.players.set(players);
    this.seasonConfig.set(seasonConfig);
    const merged = new Map(history.map((entry) => [entry.id, entry]));
    for (const entry of pendingFromEvents) merged.set(entry.id, entry);
    this.history = [...merged.values()];
    this.refreshYearParticipation();
    this.recalculateTdp();
  }

  /**
   * Admins fold event registrations into the shared TDP automatically; non-admins can't write the shared
   * data, so they get the not-yet-applied attendance overlaid in memory instead.
   */
  private async syncEventAttendance(): Promise<TdpHistoryEntry[]> {
    try {
      if (!this.isAdmin) return await this.events.pendingTdpEntries();
      const applied = await this.events.applyRegistrationsToTdp();
      if (applied) this.eventSyncMessage.set(`${applied} asistencia(s) de eventos aplicadas al TDP y guardadas en Firestore.`);
    } catch (error) {
      console.error('No se pudieron aplicar las inscripciones de eventos al TDP:', error);
      if (this.isAdmin) this.eventSyncMessage.set('No se pudieron aplicar las inscripciones de eventos al TDP.');
    }
    return [];
  }

  setYear(year: number): void {
    if (!Number.isInteger(year) || year < 1900) return;
    this.year = year;
    this.refreshYearParticipation();
  }

  async saveParticipation(player: Player, category: TdpHistoryCategory, participated: boolean): Promise<void> {
    if (!this.isAdmin) return;
    const entry: TdpHistoryEntry = {
      id: `${player.id}-${category}-${this.year}`,
      playerId: player.id,
      category,
      year: this.year,
      participated
    };
    this.history = this.history.filter((item) => item.id !== entry.id).concat(entry);
    this.yearParticipation.update((values) => ({
      ...values,
      [player.id]: { ...values[player.id], [category]: participated }
    }));
    this.recalculateTdp();
    await this.store.tdpHistory.put(entry);
  }

  async saveWeight(category: TdpCategory, percent: number): Promise<void> {
    if (!this.isAdmin) return;
    const config = this.seasonConfig();
    if (!config || !Number.isFinite(percent) || percent < 0) return;
    const weights: TdpWeights = { ...config.weights, [category]: percent / 100 };
    const updatedConfig = { ...config, weights };
    this.seasonConfig.set(updatedConfig);
    this.recalculateTdp();
    await this.store.saveSeasonConfig(updatedConfig);
  }

  tdpFor(playerId: string): number {
    return this.tdpValues()[playerId] ?? 0;
  }

  private refreshYearParticipation(): void {
    const participation: Record<string, Partial<Record<TdpHistoryCategory, boolean>>> = {};
    for (const entry of this.history) {
      if (entry.year !== this.year) continue;
      participation[entry.playerId] ??= {};
      participation[entry.playerId][entry.category] = entry.participated;
    }
    this.yearParticipation.set(participation);
  }

  private recalculateTdp(): void {
    const config = this.seasonConfig();
    if (!config) return;
    this.tdpValues.set(
      Object.fromEntries(
        this.players().map((player) => [
          player.id,
          this.scoring.computeTdp(
            this.history.filter((entry) => entry.playerId === player.id),
            config.weights,
            player.socioFundador
          )
        ])
      )
    );
  }
}
