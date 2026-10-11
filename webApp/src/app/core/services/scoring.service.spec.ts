import { ScoringService } from './scoring.service';
import { WeeklyRecord } from '../models/weekly-record.model';
import { DEFAULT_TDP_WEIGHTS, TdpHistoryEntry } from '../models/tdp.model';

describe('ScoringService', () => {
  let service: ScoringService;

  beforeEach(() => {
    service = new ScoringService();
  });

  // Verified against the Convocado/Jugo/Sede -> Pts legend table at the bottom of
  // "FFCH - Puntuacion - TDP.csv".
  const ptsCases: Array<[boolean, boolean, boolean, number]> = [
    [true, true, true, 5],
    [true, true, false, 3],
    [true, false, true, 1],
    [true, false, false, -3],
    [false, true, true, -1],
    [false, true, false, -2],
    [false, false, true, 7],
    [false, false, false, 0]
  ];

  it.each(ptsCases)('computePts(rsvp=%s, jugo=%s, sede=%s) => %s', (rsvp, jugo, sede, expected) => {
    expect(service.computePts(rsvp, jugo, sede)).toBe(expected);
  });

  it('computePtosFecha returns Pts unchanged when the player did not play', () => {
    expect(service.computePtosFecha(false, true, 7)).toBe(7);
  });

  it('computePtosFecha zeroes points when played but sanctioned', () => {
    expect(service.computePtosFecha(true, true, 5)).toBe(0);
  });

  it('computePtosFecha keeps points when played and not sanctioned', () => {
    expect(service.computePtosFecha(true, false, 5)).toBe(5);
  });

  it('computePtsTemporadaAnterior returns 7 only when sede was hosted last season', () => {
    expect(service.computePtsTemporadaAnterior(true)).toBe(7);
    expect(service.computePtsTemporadaAnterior(false)).toBe(0);
  });

  it('computePuntos applies the (1+TDP) multiplier over the summed weekly points', () => {
    // (1 + 0.5) * (10 + 7) = 25.5
    expect(service.computePuntos(0.5, 10, 7, true)).toBeCloseTo(25.5);
    // PtsTemporadaAnterior excluded when the season config says so.
    expect(service.computePuntos(0.5, 10, 7, false)).toBeCloseTo(15);
  });

  it('includes future-year participation in TDP and applies it to Puntos', () => {
    const history: TdpHistoryEntry[] = [
      { id: 'p1-anualidad-2027', playerId: 'p1', category: 'anualidad', year: 2027, participated: true },
      { id: 'p1-anualidad-2028', playerId: 'p1', category: 'anualidad', year: 2028, participated: true },
      { id: 'p1-gala-2028', playerId: 'p1', category: 'gala', year: 2028, participated: true },
      { id: 'p1-anualidad-2029', playerId: 'p1', category: 'anualidad', year: 2029, participated: false }
    ];
    const tdp = service.computeTdp(history, DEFAULT_TDP_WEIGHTS, false);

    expect(tdp).toBeCloseTo(0.05);
    expect(service.computePuntos(tdp, 100, 0, false)).toBeCloseTo(105);
  });

  it('1st tardanza only gives Tarjeta Amarilla (no points penalty)', () => {
    const records: WeeklyRecord[] = [
      { id: '1', playerId: 'p1', fecha: '2026-01-08', rsvp: true, jugo: true, sede: true, pago: true, tarde: true }
    ];
    const [score] = service.computeWeeklyScores(records);
    expect(score.tarjetaAmarilla).toBe(true);
    expect(score.tarjetaRoja).toBe(false);
    expect(score.ptosFecha).toBe(5);
  });

  it('2nd tardanza gives Tarjeta Roja and zeroes that fecha only', () => {
    const records: WeeklyRecord[] = [
      { id: '1', playerId: 'p1', fecha: '2026-01-08', rsvp: true, jugo: true, sede: true, pago: true, tarde: true },
      { id: '2', playerId: 'p1', fecha: '2026-01-15', rsvp: true, jugo: true, sede: true, pago: true, tarde: true }
    ];
    const [first, second] = service.computeWeeklyScores(records);
    expect(first.tarjetaRoja).toBe(false);
    expect(second.tarjetaRoja).toBe(true);
    expect(second.ptosFecha).toBe(0);
  });

  it('unpaid rental gives Tarjeta Roja and zeroes that fecha even without tardanza', () => {
    const records: WeeklyRecord[] = [
      { id: '1', playerId: 'p1', fecha: '2026-01-08', rsvp: true, jugo: true, sede: true, pago: false, tarde: false }
    ];
    const [score] = service.computeWeeklyScores(records);
    expect(score.tarjetaRoja).toBe(true);
    expect(score.ptosFecha).toBe(0);
  });
});
