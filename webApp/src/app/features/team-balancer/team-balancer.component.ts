import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Player } from '../../core/models/player.model';
import { AuthService } from '../../core/services/auth.service';
import { DataStoreService } from '../../core/services/data-store.service';
import { ScoringService } from '../../core/services/scoring.service';
import { TeamBalancerService, BalancedTeams, BalancerPlayer, TeamRestriction } from '../../core/services/team-balancer.service';

const PENDING_TEAMS_KEY = 'team-balancer:pendingTeams';
/** Max players that take the field; change this value to adjust the cap. */
const MAX_PLAYERS_PER_GAME = 12;

interface Candidate extends BalancerPlayer {
  selected: boolean;
  tdp: number;
}

interface TeamHistoryEntry {
  date: string;
  winner: 'teamA' | 'teamB';
  teamA: string[];
  teamB: string[];
}

interface StoredPendingTeams extends BalancedTeams {
  substitutes?: BalancerPlayer[];
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
  readonly lastWinner = signal<'teamA' | 'teamB' | null>(null);
  readonly restrictions = signal<TeamRestriction[]>([]);
  readonly restrictionAId = signal('');
  readonly restrictionBId = signal('');

  private playerMap = new Map<string, Player>();

  constructor(
    private readonly store: DataStoreService,
    private readonly scoring: ScoringService,
    private readonly balancer: TeamBalancerService,
    private readonly auth: AuthService
  ) {
    void this.load();
  }

  get isAdmin(): boolean {
    return this.auth.currentUser()?.isAdmin ?? false;
  }

  async load(): Promise<void> {
    const [allPlayers, weeklyRecords, tdpHistory, seasonConfig, storedWinner, storedHistory, storedRestrictions, storedPending] = await Promise.all([
      this.store.players.toArray(),
      this.store.weeklyRecords.toArray(),
      this.store.tdpHistory.toArray(),
      this.store.getSeasonConfig(),
      this.store.getSetting('team-balancer:lastWinner'),
      this.store.getSetting('team-balancer:history'),
      this.store.getSetting('team-balancer:restrictions'),
      this.store.getSetting(PENDING_TEAMS_KEY)
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

    const pending = storedPending ? (JSON.parse(storedPending) as StoredPendingTeams) : null;
    if (pending) {
      const substitutes = pending.substitutes ?? [];
      const pendingIds = new Set(
        [...pending.teamA.players, ...pending.teamB.players, ...substitutes].map((p) => p.playerId)
      );
      for (const candidate of candidates) {
        candidate.selected = pendingIds.has(candidate.playerId);
      }
      this.teams.set(pending);
      this.substitutes.set(substitutes);
      this.copyText.set(this.formatConvocados(pending, substitutes));
    }

    this.candidates.set(candidates);

    const winner = storedWinner === 'teamA' || storedWinner === 'teamB' ? storedWinner : null;
    this.lastWinner.set(winner);
    this.pastTeams.set(storedHistory ? (JSON.parse(storedHistory) as TeamHistoryEntry[]) : []);
    this.restrictions.set(storedRestrictions ? (JSON.parse(storedRestrictions) as TeamRestriction[]) : []);
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
    await this.store.setSetting(PENDING_TEAMS_KEY, JSON.stringify(pending));
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

    const next = [...this.restrictions(), { id: crypto.randomUUID(), playerAId, playerBId }];
    this.restrictions.set(next);
    await this.store.setSetting('team-balancer:restrictions', JSON.stringify(next));
    this.restrictionAId.set('');
    this.restrictionBId.set('');
  }

  async deleteRestriction(restrictionId: string): Promise<void> {
    if (!this.isAdmin) return;
    const next = this.restrictions().filter((restriction) => restriction.id !== restrictionId);
    this.restrictions.set(next);
    await this.store.setSetting('team-balancer:restrictions', JSON.stringify(next));
  }

  async applyLastGameResult(winner: 'teamA' | 'teamB'): Promise<void> {
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

    this.lastWinner.set(winner);
    await this.store.setSetting('team-balancer:lastWinner', winner);

    const historyEntry: TeamHistoryEntry = {
      date: new Date().toISOString(),
      winner,
      teamA: teamAIds,
      teamB: teamBIds
    };

    const nextHistory = [historyEntry, ...this.pastTeams()];
    this.pastTeams.set(nextHistory.slice(0, 10));
    await this.store.setSetting('team-balancer:history', JSON.stringify(this.pastTeams()));

    await this.store.clearSetting(PENDING_TEAMS_KEY);
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
