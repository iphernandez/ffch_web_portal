import { Injectable } from '@angular/core';

export interface BalancerPlayer {
  playerId: string;
  nombre: string;
  puntos: number;
  rating: number;
}

export interface BalancedTeam {
  players: BalancerPlayer[];
  total: number;
  promedio: number;
}

export interface BalancedTeams {
  teamA: BalancedTeam;
  teamB: BalancedTeam;
}

export interface TeamRestriction {
  id: string;
  playerAId: string;
  playerBId: string;
}

/**
 * Splits confirmed players into two equal-sized teams (or differing by one for odd counts),
 * using rating totals to choose between available slots and honoring compatible restrictions.
 * Callers can freely move players between the resulting teams afterwards (manual override).
 */
@Injectable({ providedIn: 'root' })
export class TeamBalancerService {
  toRatingFromPoints(points: number, maxPoints: number): number {
    if (!Number.isFinite(points)) return 1;
    if (maxPoints <= 0) return 1;

    const ratio = Math.max(0, points / maxPoints);
    const rawValue = ratio * 9 + 1;
    return this.clampRating(Math.floor(rawValue));
  }

  applyLastGameResult(
    players: BalancerPlayer[],
    winner: 'teamA' | 'teamB',
    teamAIds: string[],
    teamBIds: string[]
  ): BalancerPlayer[] {
    const teamASet = new Set(teamAIds);
    const teamBSet = new Set(teamBIds);

    return players.map((player) => {
      if (winner === 'teamA' && teamASet.has(player.playerId)) {
        return { ...player, rating: this.clampRating(player.rating + 1) };
      }

      if (winner === 'teamB' && teamBSet.has(player.playerId)) {
        return { ...player, rating: this.clampRating(player.rating + 1) };
      }

      if (winner === 'teamA' && teamBSet.has(player.playerId)) {
        return { ...player, rating: this.clampRating(player.rating - 1) };
      }

      if (winner === 'teamB' && teamASet.has(player.playerId)) {
        return { ...player, rating: this.clampRating(player.rating - 1) };
      }

      return player;
    });
  }

  balance(players: BalancerPlayer[], restrictions: TeamRestriction[] = []): BalancedTeams {
    const sorted = [...players].sort((a, b) => b.rating - a.rating);
    const capacityA = Math.ceil(sorted.length / 2);
    const capacityB = Math.floor(sorted.length / 2);

    const teamAPlayers: BalancerPlayer[] = [];
    const teamBPlayers: BalancerPlayer[] = [];
    let totalA = 0;
    let totalB = 0;

    for (const player of sorted) {
      const hasRoomA = teamAPlayers.length < capacityA;
      const hasRoomB = teamBPlayers.length < capacityB;
      const canUseA = hasRoomA && this.canAddPlayerToTeam(player.playerId, teamAPlayers, restrictions);
      const canUseB = hasRoomB && this.canAddPlayerToTeam(player.playerId, teamBPlayers, restrictions);

      let team: 'teamA' | 'teamB';
      if (canUseA && canUseB) {
        team = totalA <= totalB ? 'teamA' : 'teamB';
      } else if (canUseA) {
        team = 'teamA';
      } else if (canUseB) {
        team = 'teamB';
      } else if (hasRoomA && hasRoomB) {
        // Restrictions may be mutually incompatible; preserve the required team sizes.
        team = totalA <= totalB ? 'teamA' : 'teamB';
      } else {
        team = hasRoomA ? 'teamA' : 'teamB';
      }

      if (team === 'teamA') {
        teamAPlayers.push(player);
        totalA += player.rating;
      } else {
        teamBPlayers.push(player);
        totalB += player.rating;
      }
    }

    return {
      teamA: this.toTeam(teamAPlayers),
      teamB: this.toTeam(teamBPlayers)
    };
  }

  canAddPlayerToTeam(playerId: string, teamPlayers: BalancerPlayer[], restrictions: TeamRestriction[]): boolean {
    return !teamPlayers.some((member) => this.hasRestriction(playerId, member.playerId, restrictions));
  }

  hasRestriction(playerAId: string, playerBId: string, restrictions: TeamRestriction[]): boolean {
    return restrictions.some(
      (restriction) =>
        (restriction.playerAId === playerAId && restriction.playerBId === playerBId) ||
        (restriction.playerAId === playerBId && restriction.playerBId === playerAId)
    );
  }

  private clampRating(value: number): number {
    return Math.min(10, Math.max(1, Math.round(value)));
  }

  private toTeam(players: BalancerPlayer[]): BalancedTeam {
    const total = players.reduce((sum, p) => sum + p.rating, 0);
    const promedio = players.length ? total / players.length : 0;
    return { players, total, promedio };
  }
}
