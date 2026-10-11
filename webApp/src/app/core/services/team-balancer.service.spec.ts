import { beforeEach, describe, expect, it } from 'vitest';
import { TeamBalancerService, BalancerPlayer } from './team-balancer.service';

describe('TeamBalancerService', () => {
  let service: TeamBalancerService;

  beforeEach(() => {
    service = new TeamBalancerService();
  });

  it('maps points into a 1..10 rating used for balancing', () => {
    expect(service.toRatingFromPoints(0, 10)).toBe(1);
    expect(service.toRatingFromPoints(5, 10)).toBe(5);
    expect(service.toRatingFromPoints(10, 10)).toBe(10);
  });

  it('adds 1 to winner ratings and subtracts 1 from loser ratings', () => {
    const players: BalancerPlayer[] = [
      { playerId: '1', nombre: 'A', puntos: 10, rating: 7 },
      { playerId: '2', nombre: 'B', puntos: 9, rating: 6 },
      { playerId: '3', nombre: 'C', puntos: 8, rating: 4 },
      { playerId: '4', nombre: 'D', puntos: 7, rating: 3 }
    ];

    const adjusted = service.applyLastGameResult(players, 'teamA', ['1', '2'], ['3', '4']);

    expect(adjusted.find((p) => p.playerId === '1')?.rating).toBe(8);
    expect(adjusted.find((p) => p.playerId === '2')?.rating).toBe(7);
    expect(adjusted.find((p) => p.playerId === '3')?.rating).toBe(3);
    expect(adjusted.find((p) => p.playerId === '4')?.rating).toBe(2);
  });

  it('splits players into two teams with balanced totals via snake draft using rating', () => {
    const players: BalancerPlayer[] = [
      { playerId: '1', nombre: 'A', puntos: 5, rating: 8 },
      { playerId: '2', nombre: 'B', puntos: 5, rating: 7 },
      { playerId: '3', nombre: 'C', puntos: 3, rating: 5 },
      { playerId: '4', nombre: 'D', puntos: 2, rating: 4 }
    ];

    const { teamA, teamB } = service.balance(players);

    expect(teamA.players.length + teamB.players.length).toBe(players.length);
    expect(Math.abs(teamA.total - teamB.total)).toBeLessThanOrEqual(3);
  });

  it.each([12, 13])('keeps team sizes equal or one apart for %i players', (count) => {
    const ratings = [10, 2, 9, 1, 8, 3, 7, 4, 6, 5, 10, 1, 9];
    const players: BalancerPlayer[] = Array.from({ length: count }, (_, index) => ({
      playerId: `p${index}`,
      nombre: `Player ${index}`,
      puntos: ratings[index % ratings.length],
      rating: ratings[index % ratings.length]
    }));

    const { teamA, teamB } = service.balance(players);

    expect(teamA.players.length).toBe(Math.ceil(count / 2));
    expect(teamB.players.length).toBe(Math.floor(count / 2));
  });

  it('keeps restricted players on different teams', () => {
    const players: BalancerPlayer[] = [
      { playerId: 'p1', nombre: 'Jose', puntos: 9, rating: 9 },
      { playerId: 'p2', nombre: 'Andrew', puntos: 8, rating: 8 },
      { playerId: 'p3', nombre: 'Jonathan', puntos: 7, rating: 7 },
      { playerId: 'p4', nombre: 'Michael G', puntos: 6, rating: 6 },
      { playerId: 'p5', nombre: 'Other', puntos: 5, rating: 5 }
    ];

    const restrictions = [
      { id: 'r1', playerAId: 'p1', playerBId: 'p2' },
      { id: 'r2', playerAId: 'p3', playerBId: 'p4' }
    ];

    const { teamA, teamB } = service.balance(players, restrictions);

    const teamAIds = new Set(teamA.players.map((player) => player.playerId));
    const teamBIds = new Set(teamB.players.map((player) => player.playerId));

    expect(teamAIds.has('p1') !== teamAIds.has('p2')).toBe(true);
    expect(teamAIds.has('p3') !== teamAIds.has('p4')).toBe(true);
  });

  it('returns zeroed team stats when given no players', () => {
    const { teamA, teamB } = service.balance([]);
    expect(teamA.total).toBe(0);
    expect(teamA.promedio).toBe(0);
    expect(teamB.players).toEqual([]);
  });
});
