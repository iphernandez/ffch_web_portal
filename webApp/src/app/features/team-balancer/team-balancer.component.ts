import { Component, DestroyRef, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Unsubscribe } from 'firebase/firestore';
import { Player } from '../../core/models/player.model';
import { AuthService } from '../../core/services/auth.service';
import { DataStoreService } from '../../core/services/data-store.service';
import { ScoringService } from '../../core/services/scoring.service';
import { TeamBalancerService, BalancedTeams, BalancerPlayer, TeamRestriction } from '../../core/services/team-balancer.service';
import {
  StoredPendingTeams,
  TeamBalancerStateService,
  TeamHistoryEntry,
  TeamWinner,
  TeamsState
} from '../../core/services/team-balancer-state.service';

/** Max players that take the field; change this value to adjust the cap. */
const MAX_PLAYERS_PER_GAME = 12;

interface Candidate extends BalancerPlayer {
  selected: boolean;
  tdp: number;
}

@Component({
  selector: 'app-team-balancer',
  imports: [FormsModule],
  templateUrl: './team-balancer.component.html',
  styleUrl: './team-balancer.component.scss'
})
export class TeamBalancerComponent {
  readonly candidates = signal<Candidate[]>([]);
  readonly teams = signal<BalancedTeams | null>(null);
  readonly substitutes = signal<BalancerPlayer[]>([]);
  readonly maxPlayers = MAX_PLAYERS_PER_GAME;
  readonly copyText = signal('');
  readonly pastTeams = signal<TeamHistoryEntry[]>([]);
  readonly lastWinner = signal<TeamWinner | null>(null);
  readonly restrictions = signal<TeamRestriction[]>([]);
  readonly restrictionAId = signal('');
  readonly restrictionBId = signal('');
  readonly statusMessage = signal('');

  private playerMap = new Map<string, Player>();
  private readonly unsubscribers: Unsubscribe[] = [];
  private destroyed = false;
  /** Latest result date seen; undefined until the first snapshot so loading doesn't trigger a rating refresh. */
  private seenResultDate: string | null | undefined;
  private ownResultDate: string | null = null;

  constructor(
    private readonly store: DataStoreService,
    private readonly scoring: ScoringService,
    private readonly balancer: TeamBalancerService,
    private readonly auth: AuthService,
    private readonly sharedState: TeamBalancerStateService,
    destroyRef: DestroyRef
  ) {
    destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    });
    void this.load();
  }

  get isAdmin(): boolean {
    return this.auth.currentUser()?.isAdmin ?? false;
  }

  async load(): Promise<void> {
    const [allPlayers, weeklyRecords, tdpHistory, seasonConfig] = await Promise.all([
      this.store.players.toArray(),
      this.store.weeklyRecords.toArray(),
      this.store.tdpHistory.toArray(),
      this.store.getSeasonConfig()
    ]);

    this.playerMap = new Map(allPlayers.map((player) => [player.id, player]));

    const activePlayers = allPlayers.filter((player) => player.activo).sort((a, b) => a.posicion - b.posicion);
    const maxPoints = activePlayers.reduce((max, player) => {
      const summary = this.scoring.summarizePlayer(
        player.id,
        weeklyRecords,
        tdpHistory,
        seasonConfig.weights,
        player.sedeTemporadaAnterior,
        seasonConfig.ptsTemporadaAnteriorIncludedInSum,
        player.socioFundador
      );
      return Math.max(max, summary.puntos);
    }, 0);

    const candidates: Candidate[] = activePlayers.map((player) => {
      const summary = this.scoring.summarizePlayer(
        player.id,
        weeklyRecords,
        tdpHistory,
        seasonConfig.weights,
        player.sedeTemporadaAnterior,
        seasonConfig.ptsTemporadaAnteriorIncludedInSum,
        player.socioFundador
      );

      const rating = player.rating ?? this.balancer.toRatingFromPoints(summary.puntos, maxPoints || 1);

      return {
        playerId: player.id,
        nombre: player.galactico,
        puntos: summary.puntos,
        tdp: summary.tdp,
        rating,
        selected: false
      };
    });

    this.candidates.set(candidates);
    if (this.destroyed) return;

    const onError = (error: unknown) => {
      console.error('No se pudo sincronizar el balanceador de equipos:', error);
      this.statusMessage.set('No se pudo sincronizar el balanceador con Firestore.');
    };
    this.unsubscribers.push(this.sharedState.watchTeams((state) => this.applyTeams(state), onError, this.isAdmin));
    // Restrictions are admin-only in firestore.rules.
    if (this.isAdmin) {
      this.unsubscribers.push(this.sharedState.watchRestrictions((list) => this.restrictions.set(list), onError));
    }
  }

  private applyTeams(state: TeamsState): void {
    const hadPending = this.teams() !== null;
    const pending = state.pendingTeams;
    if (pending) {
      const substitutes = pending.substitutes ?? [];
      const pendingIds = new Set(
        [...pending.teamA.players, ...pending.teamB.players, ...substitutes].map((p) => p.playerId)
      );
      this.candidates.update((list) => list.map((c) => ({ ...c, selected: pendingIds.has(c.playerId) })));
      this.teams.set(pending);
      this.substitutes.set(substitutes);
      this.copyText.set(this.formatConvocados(pending, substitutes));
    } else {
      if (hadPending) this.candidates.update((list) => list.map((c) => ({ ...c, selected: false })));
      this.teams.set(null);
      this.substitutes.set([]);
      this.copyText.set('');
    }

    this.lastWinner.set(state.lastWinner);
    this.pastTeams.set(state.history);

    const latest = state.history[0]?.date ?? null;
    if (this.seenResultDate !== undefined && latest && latest !== this.seenResultDate && latest !== this.ownResultDate) {
      void this.refreshRatings();
    }
    this.seenResultDate = latest;
  }

  /** Another admin recorded a result: bring their rating changes from the shared data into this device. */
  private async refreshRatings(): Promise<void> {
    try {
      const changed = await this.sharedState.pullRatings();
      if (!changed.size) return;
      for (const [playerId, rating] of changed) {
        const player = this.playerMap.get(playerId);
        if (player) this.playerMap.set(playerId, { ...player, rating });
      }
      this.candidates.update((list) =>
        list.map((c) => (changed.has(c.playerId) ? { ...c, rating: changed.get(c.playerId)! } : c))
      );
    } catch (error) {
      console.error('No se pudieron actualizar los ratings desde Firestore:', error);
    }
  }

  async buildTeams(): Promise<void> {
    if (!this.isAdmin) return;
    if (this.teams() && !confirm('Ya hay equipos armados sin resultado. ¿Reemplazarlos?')) {
      return;
    }
    const selected = [...this.candidates().filter((c) => c.selected)].sort((a, b) => b.tdp - a.tdp);
    const playing = selected.slice(0, this.maxPlayers);
    const subs = selected.slice(this.maxPlayers);

    const teams = this.balancer.balance(playing, this.restrictions());
    this.teams.set(teams);
    this.substitutes.set(subs);
    this.copyText.set(this.formatConvocados(teams, subs));

    const pending: StoredPendingTeams = { ...teams, substitutes: subs };
    await this.saveShared(() => this.sharedState.setPendingTeams(pending));
  }

  private async saveShared(write: () => Promise<void>): Promise<void> {
    try {
      await write();
      this.statusMessage.set('');
    } catch (error) {
      console.error('No se pudo guardar el balanceador de equipos:', error);
      this.statusMessage.set('No se pudo guardar en Firestore. Revisa tu conexión e intenta de nuevo.');
    }
  }

  async addRestriction(): Promise<void> {
    if (!this.isAdmin) return;
    const playerAId = this.restrictionAId().trim();
    const playerBId = this.restrictionBId().trim();

    if (!playerAId || !playerBId || playerAId === playerBId) {
      return;
    }

    const exists = this.restrictions().some(
      (restriction) =>
        (restriction.playerAId === playerAId && restriction.playerBId === playerBId) ||
        (restriction.playerAId === playerBId && restriction.playerBId === playerAId)
    );

    if (exists) {
      return;
    }

    const restriction: TeamRestriction = { id: crypto.randomUUID(), playerAId, playerBId };
    this.restrictions.set([...this.restrictions(), restriction]);
    await this.saveShared(() => this.sharedState.addRestriction(restriction));
    this.restrictionAId.set('');
    this.restrictionBId.set('');
  }

  async deleteRestriction(restrictionId: string): Promise<void> {
    if (!this.isAdmin) return;
    const restriction = this.restrictions().find((item) => item.id === restrictionId);
    if (!restriction) return;
    this.restrictions.set(this.restrictions().filter((item) => item.id !== restrictionId));
    await this.saveShared(() => this.sharedState.removeRestriction(restriction));
  }

  async applyLastGameResult(winner: TeamWinner): Promise<void> {
    if (!this.isAdmin) return;
    const currentTeams = this.teams();
    if (!currentTeams) return;

    const teamAIds = currentTeams.teamA.players.map((p) => p.playerId);
    const teamBIds = currentTeams.teamB.players.map((p) => p.playerId);

    const playedIds = new Set([...teamAIds, ...teamBIds]);
    const nextCandidates = this.balancer.applyLastGameResult(
      this.candidates().filter((candidate) => playedIds.has(candidate.playerId)),
      winner,
      teamAIds,
      teamBIds
    );

    const nextCandidatesById = new Map(nextCandidates.map((candidate) => [candidate.playerId, candidate]));
    const updatedCandidates = this.candidates().map((candidate) => {
      const next = nextCandidatesById.get(candidate.playerId);
      if (!next) {
        return candidate;
      }
      return { ...candidate, rating: next.rating };
    });

    this.candidates.set(updatedCandidates);

    for (const candidate of nextCandidates) {
      const persisted = this.playerMap.get(candidate.playerId);
      if (!persisted) continue;
      this.playerMap.set(candidate.playerId, { ...persisted, rating: candidate.rating });
    }

    await this.store.players.bulkPut(
      Array.from(this.playerMap.values()).map((player) => ({ ...player, rating: player.rating ?? 1 }))
    );

    const historyEntry: TeamHistoryEntry = {
      date: new Date().toISOString(),
      winner,
      teamA: teamAIds,
      teamB: teamBIds
    };
    this.ownResultDate = historyEntry.date;

    // Ratings go first so other devices find them in the shared data when the new result reaches them.
    let ratingsError: string | null = null;
    try {
      await this.sharedState.pushRatings(new Map(nextCandidates.map((candidate) => [candidate.playerId, candidate.rating])));
    } catch (error) {
      console.error('No se pudieron guardar los ratings en Firestore:', error);
      ratingsError = error instanceof Error ? error.message : 'Error desconocido.';
    }

    this.lastWinner.set(winner);
    this.pastTeams.set([historyEntry, ...this.pastTeams()].slice(0, 10));
    await this.saveShared(() => this.sharedState.recordResult(historyEntry));
    if (ratingsError) {
      this.statusMessage.set(
        `Resultado guardado, pero los ratings quedaron solo en este dispositivo (${ratingsError}). Usa "Guardar en Firestore" en Ajustes.`
      );
    }

    this.teams.set(null);
    this.substitutes.set([]);
    this.copyText.set('');
    this.candidates.update((list) => list.map((candidate) => ({ ...candidate, selected: false })));
  }

  playerLabel(player: { nombre: string; playerId: string; wanumber?: string }): string {
    return player.wanumber ? `${player.nombre} (${player.wanumber})` : player.nombre;
  }

  private formatConvocados(teams: BalancedTeams, substitutes: BalancerPlayer[] = []): string {
    const gameDate = this.getNextThursday(new Date());
    const seasonStart = this.getSeasonStart(gameDate);
    const seasonYear = seasonStart.getFullYear();
    const gameDay = Date.UTC(gameDate.getFullYear(), gameDate.getMonth(), gameDate.getDate());
    const seasonStartDay = Date.UTC(seasonStart.getFullYear(), seasonStart.getMonth(), seasonStart.getDate());
    const weekNumber = Math.floor((gameDay - seasonStartDay) / (7 * 24 * 60 * 60 * 1000)) + 1;
    const date = `${String(gameDate.getMonth() + 1).padStart(2, '0')}/${String(gameDate.getDate()).padStart(2, '0')}/${gameDate.getFullYear()}`;
    const format = (label: string, team: BalancedTeams['teamA']) => {
      const names = team.players
        .map((player, index) => `${player.nombre}(${player.rating.toFixed(0)})${index < team.players.length - 1 ? ',' : ''}`)
        .join('\n');
      return `${label}\n${names}\nTOTAL ${team.total.toFixed(0)} | PROM ${team.promedio.toFixed(2)}`;
    };
    const supList = substitutes.length ? substitutes.map((player) => player.nombre).join(', ') : 'Ninguno';

    return `⚽ ${date} 7:00 PM | Fecha ${weekNumber} - ${seasonYear} | Invierno\n📍 Coloso de Hillsboro\n\n${format('🟧 EQUIPO A', teams.teamA)}\n\n${format('🔵 EQUIPO B', teams.teamB)}\n\n🪑 Sup: ${supList}\n🚫 Susp: Ninguno\n\n_*LAS OPINIONES VERTIDAS EN ESTA ALINEACIÓN SON DE EXCLUSIVA RESPONSABILIDAD DE Chat GPT Y NO REPRESENTAN EL PENSAMIENTO NI LA LÍNEA DE BULLYING DE LA FFCH NI DE NINGUNO DE SUS MIEMBROS. CUALQUIER QUEJA POR FAVOR DIRIGIRLA A LA DIRECCIÓN DE CORREO INDICADA EN EL MENSAJE DE EMAIL*_`;
  }

  private getNextThursday(from: Date): Date {
    const daysUntilThursday = (4 - from.getDay() + 7) % 7 || 7;
    const thursday = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    thursday.setDate(thursday.getDate() + daysUntilThursday);
    return thursday;
  }

  private getSeasonStart(date: Date): Date {
    let seasonStart = new Date(date.getFullYear(), 9, 1);
    seasonStart.setDate(seasonStart.getDate() + (4 - seasonStart.getDay() + 7) % 7);

    if (date < seasonStart) {
      seasonStart = new Date(date.getFullYear() - 1, 9, 1);
      seasonStart.setDate(seasonStart.getDate() + (4 - seasonStart.getDay() + 7) % 7);
    }

    return seasonStart;
  }

  formatDate(value: string): string {
    return new Date(value).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  }

  async copyToClipboard(): Promise<void> {
    await navigator.clipboard.writeText(this.copyText());
  }
}
