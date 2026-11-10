import { Injectable } from '@angular/core';
import { TdpHistoryCategory, TdpHistoryEntry, TdpWeights } from '../models/tdp.model';
import { WeeklyRecord } from '../models/weekly-record.model';

export interface WeeklyScore {
  fecha: string;
  pts: number;
  ptosFecha: number;
  /** 1st late arrival this season (warning only, no points penalty per reglamento.md). */
  tarjetaAmarilla: boolean;
  /** 2nd+ late arrival this fecha, or unpaid rental: zeroes PtosFecha for this fecha. */
  tarjetaRoja: boolean;
}

export interface PlayerScoreSummary {
  playerId: string;
  tdp: number;
  ptsTemporadaAnterior: number;
  sumPtosFecha: number;
  puntos: number;
  weeklyScores: WeeklyScore[];
}

/**
 * Reproduces, cell for cell, the formulas documented in FFCH_Puntuacion/formulas.txt
 * and verified against the "Convocado/Jugo/Sede -> Pts/Casta" legend table in
 * "FFCH - Puntuacion - TDP.csv". See FFCH_Puntuacion/README.md for the mapping.
 */
@Injectable({ providedIn: 'root' })
export class ScoringService {
  /** Pts = decision tree on (RSVP, Jugo, Sede). Unaffected by Pago/Tarde. */
  computePts(rsvp: boolean | null, jugo: boolean | null, sede: boolean | null): number {
    const r = !!rsvp;
    const j = !!jugo;
    const s = !!sede;

    if (r && j && s) return 5;
    if (r && j && !s) return 3;
    if (r && !j && s) return 1;
    if (r && !j && !s) return -3;
    if (!r && j && s) return -1;
    if (!r && j && !s) return -2;
    if (!r && !j && s) return 7;
    return 0; // !r && !j && !s
  }

  /** PtosFecha = if not played, Pts stands; if played, a card sanction (roja) or unpaid rental zeroes that week. */
  computePtosFecha(jugo: boolean | null, sanctioned: boolean, pts: number): number {
    if (!jugo) return pts;
    return sanctioned ? 0 : pts;
  }

  /**
   * reglamento.md: 1st tardanza (5+ min late) this season -> Tarjeta Amarilla (warning only).
   * 2nd+ tardanza -> Tarjeta Roja on that specific fecha -> no points that fecha.
   * Unpaid rental (`pago === false`) also triggers Tarjeta Roja -> no points that fecha.
   */
  computeWeeklyScores(records: WeeklyRecord[]): WeeklyScore[] {
    let tardeCount = 0;

    return records
      .slice()
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
      .map((record) => {
        const pts = this.computePts(record.rsvp, record.jugo, record.sede);

        let tarjetaAmarilla = false;
        let tarjetaRojaPorTardanza = false;
        if (record.tarde) {
          tardeCount += 1;
          if (tardeCount === 1) {
            tarjetaAmarilla = true;
          } else {
            tarjetaRojaPorTardanza = true;
          }
        }

        const tarjetaRojaPorPago = record.pago === false;
        const tarjetaRoja = tarjetaRojaPorTardanza || tarjetaRojaPorPago;
        const ptosFecha = this.computePtosFecha(record.jugo, tarjetaRoja, pts);

        return { fecha: record.fecha, pts, ptosFecha, tarjetaAmarilla, tarjetaRoja };
      });
  }

  /** PtsTemporadaAnterior = 7 if hosted the field last season, else 0. */
  computePtsTemporadaAnterior(sedeTemporadaAnterior: boolean): number {
    return sedeTemporadaAnterior ? 7 : 0;
  }

  /**
   * TDP% = weighted sum of historical participation flags across per-year categories,
   * plus the Socio Fundador weight once if the player has that single lifetime flag set.
   */
  computeTdp(history: TdpHistoryEntry[], weights: TdpWeights, socioFundador: boolean): number {
    const categories = (Object.keys(weights) as (TdpHistoryCategory | 'socioFundador')[]).filter(
      (c): c is TdpHistoryCategory => c !== 'socioFundador'
    );
    const perYearTotal = categories.reduce((total, category) => {
      const yearsParticipated = history.filter((h) => h.category === category && h.participated).length;
      return total + yearsParticipated * weights[category];
    }, 0);
    return perYearTotal + (socioFundador ? weights.socioFundador : 0);
  }

  /** Puntos = (1 + TDP) * SUM(PtosFecha [+ PtsTemporadaAnterior if configured]). */
  computePuntos(
    tdp: number,
    sumPtosFecha: number,
    ptsTemporadaAnterior: number,
    includePtsTemporadaAnterior: boolean
  ): number {
    const base = sumPtosFecha + (includePtsTemporadaAnterior ? ptsTemporadaAnterior : 0);
    return (1 + tdp) * base;
  }

  summarizePlayer(
    playerId: string,
    weeklyRecords: WeeklyRecord[],
    tdpHistory: TdpHistoryEntry[],
    weights: TdpWeights,
    sedeTemporadaAnterior: boolean,
    includePtsTemporadaAnterior: boolean,
    socioFundador: boolean
  ): PlayerScoreSummary {
    const records = weeklyRecords.filter((r) => r.playerId === playerId);
    const weeklyScores = this.computeWeeklyScores(records);
    const sumPtosFecha = weeklyScores.reduce((sum, w) => sum + w.ptosFecha, 0);
    const tdp = this.computeTdp(
      tdpHistory.filter((h) => h.playerId === playerId),
      weights,
      socioFundador
    );
    const ptsTemporadaAnterior = this.computePtsTemporadaAnterior(sedeTemporadaAnterior);
    const puntos = this.computePuntos(tdp, sumPtosFecha, ptsTemporadaAnterior, includePtsTemporadaAnterior);

    return { playerId, tdp, ptsTemporadaAnterior, sumPtosFecha, puntos, weeklyScores };
  }
}
