import { Injectable } from '@angular/core';
import Papa from 'papaparse';
import { Player } from '../models/player.model';
import { WeeklyRecord } from '../models/weekly-record.model';
import { TdpCategory, TdpHistoryCategory, TdpHistoryEntry, TdpWeights, DEFAULT_TDP_WEIGHTS } from '../models/tdp.model';
import { FfchData } from '../models/ffch-data.model';

export interface CsvImportResult {
  data: FfchData;
  warnings: string[];
}

const STATIC_COLUMNS = ['Galactico', 'Bullying', 'wanumber', 'Posicion', 'TDP', 'Puntos', 'SedeTemporadaAnterior', 'PtsTemporadaAnterior'] as const;

/**
 * TDP.csv's per-year category columns (excludes Socio Fundador, handled separately below since it's
 * a single lifetime column, not one-per-year), in the exact order/width used by its "TDP" formula:
 * `sum(D:S)*B49 + sum(T:AB)*B50 + sum(AC:AJ)*B51 + sum(AK)*B52 + sum(AL:AM)*B53 + sum(AN:AO)*B54 + sum(AP:AQ)*B54`.
 * Verified against the CSV data (Rafa: 16+9+8=33 "Año/Pretemporada/Galas" flags, then AK/AL:AM/AN:AO/AP:AQ
 * all "1" except one blank -> 16*2% + 9*1% + 8*1% + 1*2% + 2*1% + 1*1% + 2*1% = 56%, matching Rafa's
 * displayed TDP exactly). Column AK has no year label in the exported header row (blank) but IS live
 * data, not a spacer - it is the sole column weighted by $B$52 (Socio Fundador). Row1's merged group
 * labels ("Socios fundadores", "Partido del Pavo", "Afitrion Gala", "Team Building") are shifted one
 * column to the right relative to the weights actually applied, so category columns are located by
 * fixed width relative to the "TDP" column instead of by searching for those group labels.
 */
const TDP_PER_YEAR_COLUMN_WIDTHS: Array<{ category: TdpHistoryCategory; width: number }> = [
  { category: 'anualidad', width: 16 }, // D:S
  { category: 'pretemporada', width: 9 }, // T:AB
  { category: 'gala', width: 8 } // AC:AJ
];
/** Single column (AK) right after the per-year "Galas" columns - one lifetime flag, not per-year. */
const SOCIO_FUNDADOR_WIDTH = 1;
const TDP_PER_YEAR_COLUMN_WIDTHS_AFTER_SOCIO_FUNDADOR: Array<{ category: TdpHistoryCategory; width: number }> = [
  { category: 'partidoPavo', width: 2 }, // AL:AM
  { category: 'anfitrionGala', width: 2 }, // AN:AO
  { category: 'teamBuilding', width: 2 } // AP:AQ (reuses AnfitrionGala's weight in the original formula)
];

const WEIGHT_ROW_LABELS: Record<string, TdpCategory> = {
  anualidad: 'anualidad',
  pretemporada: 'pretemporada',
  gala: 'gala',
  'socio fundador': 'socioFundador',
  'partido pavo': 'partidoPavo',
  'anfitrion gala': 'anfitrionGala',
  'afitrion gala': 'anfitrionGala'
};

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function toBoolean(cell: string | undefined): boolean {
  return (cell ?? '').trim() === '1';
}

function slugify(text: string): string {
  return (
    normalize(text)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'player'
  );
}

/** "18 December 2025" or "12/11/2025" -> "2025-12-18" / "2025-12-11" (ISO, yyyy-MM-dd). */
function parseFechaLabel(label: string): string | null {
  const trimmed = label.trim();
  if (!trimmed) return null;

  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, m, d, y] = slash;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

/**
 * Parses the two legacy Excel-exported CSVs (FFCH_Puntuacion/*.csv) into the app's
 * JSON schema. Puntos.csv's weekly column boundaries are discovered by header name
 * search (robust to merged-cell export shifts). TDP.csv's category columns are located
 * by fixed width relative to the "TDP" column (see TDP_COLUMN_WIDTHS), since its row1
 * group labels don't reliably align with the columns the TDP formula actually weights.
 */
@Injectable({ providedIn: 'root' })
export class CsvImportService {
  import(puntosCsvText: string, tdpCsvText: string): CsvImportResult {
    const warnings: string[] = [];
    const puntosRows = Papa.parse<string[]>(puntosCsvText, { skipEmptyLines: false }).data;
    const tdpRows = Papa.parse<string[]>(tdpCsvText, { skipEmptyLines: false }).data;

    const { players, weeklyRecords } = this.parsePuntosCsv(puntosRows, warnings);
    const { tdpHistory, weights, playerTdpPercent } = this.parseTdpCsv(tdpRows, players, warnings);

    // Prefer the TDP% already computed by the spreadsheet's VLOOKUP for players we
    // could not confidently reconstruct from raw category flags.
    for (const player of players) {
      if (!playerTdpPercent.has(player.galactico)) {
        warnings.push(`No se encontró TDP.csv para "${player.galactico}"; TDP se calculará desde 0.`);
      }
    }

    const data: FfchData = {
      players,
      weeklyRecords,
      tdpHistory,
      seasonConfig: {
        id: 'default',
        ptsTemporadaAnteriorIncludedInSum: true,
        weights
      },
      updatedAt: new Date().toISOString()
    };

    return { data, warnings };
  }

  private parsePuntosCsv(rows: string[][], warnings: string[]): { players: Player[]; weeklyRecords: WeeklyRecord[] } {
    const headerRowIndex = rows.findIndex((row) => row[0]?.trim() === 'Galactico');
    if (headerRowIndex < 1) {
      throw new Error('No se encontró la fila de encabezados ("Galactico") en el CSV de Puntos.');
    }
    const headerRow = rows[headerRowIndex];
    const fechaRow = rows[headerRowIndex - 1] ?? [];

    const staticIndex: Record<string, number> = {};
    for (const name of STATIC_COLUMNS) {
      const index = headerRow.findIndex((cell) => cell?.trim() === name);
      if (index === -1) {
        warnings.push(`No se encontró la columna estática "${name}" en el CSV de Puntos.`);
      }
      staticIndex[name] = index;
    }

    interface Block {
      fecha: string;
      colByName: Record<string, number>;
    }
    const blocks: Block[] = [];
    let current: Block | null = null;

    headerRow.forEach((cellRaw, col) => {
      const cell = cellRaw?.trim();
      if (!cell) return;
      if (cell === 'RSVP') {
        const fechaLabel = fechaRow[col]?.trim();
        const fecha = fechaLabel ? parseFechaLabel(fechaLabel) : null;
        if (!fecha) {
          warnings.push(`Fecha no reconocida en columna ${col} ("${fechaLabel ?? ''}"); se omite ese bloque semanal.`);
        }
        current = { fecha: fecha ?? `desconocida-col-${col}`, colByName: { RSVP: col } };
        blocks.push(current);
        return;
      }
      if (current && ['Jugo', 'Sede', 'Pts', 'Pago', 'Pago/Tarde', 'PtosFecha'].includes(cell)) {
        current.colByName[cell] = col;
      }
    });

    const dataRows = rows.slice(headerRowIndex + 1).filter((row) => row[staticIndex['Galactico']]?.trim());

    const players: Player[] = [];
    const weeklyRecords: WeeklyRecord[] = [];
    const usedIds = new Set<string>();

    dataRows.forEach((row) => {
      const galactico = row[staticIndex['Galactico']].trim();
      let id = slugify(galactico);
      while (usedIds.has(id)) id += '-2';
      usedIds.add(id);

      const posicionRaw = row[staticIndex['Posicion']]?.trim();
      players.push({
        id,
        galactico,
        bullying: row[staticIndex['Bullying']]?.trim() ?? '',
        wanombre: '',
        wanumber: row[staticIndex['wanumber']]?.trim() ?? '',
        posicion: posicionRaw ? Number(posicionRaw) : players.length + 1,
        activo: true,
        sedeTemporadaAnterior: toBoolean(row[staticIndex['SedeTemporadaAnterior']]),
        socioFundador: false
      });

      blocks.forEach((block, blockIndex) => {
        if (block.fecha.startsWith('desconocida-')) return;
        const get = (name: string) => (name in block.colByName ? row[block.colByName[name]]?.trim() : undefined);

        weeklyRecords.push({
          id: `${id}-${block.fecha}`,
          playerId: id,
          fecha: block.fecha,
          rsvp: get('RSVP') === undefined ? null : toBoolean(get('RSVP')),
          jugo: get('Jugo') === undefined ? null : toBoolean(get('Jugo')),
          sede: get('Sede') === undefined ? null : toBoolean(get('Sede')),
          // Blocks without a Pago/Pago-Tarde column predate payment tracking: assume no sanction.
          pago: 'Pago' in block.colByName ? toBoolean(get('Pago')) : 'Pago/Tarde' in block.colByName ? toBoolean(get('Pago/Tarde')) : true,
          // Historical CSVs merged Tarde into the Pago/Tarde column; cannot be reconstructed separately.
          tarde: null
        });
      });
    });

    return { players, weeklyRecords };
  }

  private parseTdpCsv(
    rows: string[][],
    players: Player[],
    warnings: string[]
  ): { tdpHistory: TdpHistoryEntry[]; weights: TdpWeights; playerTdpPercent: Map<string, number> } {
    const headerRow = rows[1] ?? [];

    const tdpCol = headerRow.findIndex((cell) => cell?.trim() === 'TDP');
    if (tdpCol === -1) {
      throw new Error('No se encontró la columna "TDP" en el CSV de TDP.');
    }

    const categoryColumns: Array<{ category: TdpHistoryCategory; col: number; year: number }> = [];
    let col = tdpCol + 1;
    const addColumns = (widths: Array<{ category: TdpHistoryCategory; width: number }>) => {
      for (const { category, width } of widths) {
        for (let i = 0; i < width; i++, col++) {
          const yearMatch = headerRow[col]?.match(/(\d{4})/);
          if (!yearMatch) {
            warnings.push(
              `Columna ${col} (categoría "${category}") no tiene año en el encabezado ("${headerRow[col] ?? ''}"); ` +
                'se cuenta igual para el TDP pero sin año identificable.'
            );
          }
          categoryColumns.push({ category, col, year: yearMatch ? Number(yearMatch[1]) : 1900 + col });
        }
      }
    };
    addColumns(TDP_PER_YEAR_COLUMN_WIDTHS);
    const socioFundadorCol = col; // AK: single lifetime flag, not per-year - see SOCIO_FUNDADOR_WIDTH.
    col += SOCIO_FUNDADOR_WIDTH;
    addColumns(TDP_PER_YEAR_COLUMN_WIDTHS_AFTER_SOCIO_FUNDADOR);

    // Weight rows appear as plain "Nombre,Valor%" rows near the bottom of the sheet.
    const weights: TdpWeights = { ...DEFAULT_TDP_WEIGHTS };
    for (const row of rows) {
      const label = normalize(row[0] ?? '');
      const category = WEIGHT_ROW_LABELS[label];
      if (category) {
        const percentMatch = row[1]?.match(/([\d.]+)%/);
        if (percentMatch) {
          weights[category] = Number(percentMatch[1]) / 100;
        }
      }
    }
    // Team Building had no dedicated weight row historically; default to Anfitrion Gala's value.
    weights.teamBuilding = weights.teamBuilding ?? weights.anfitrionGala;

    const galacticoCol = 0;
    const tdpPercentCol = tdpCol;

    const tdpHistory: TdpHistoryEntry[] = [];
    const playerTdpPercent = new Map<string, number>();

    const dataRows = rows.slice(2);
    // Below the player rows the sheet continues with a blank separator row, then "Pesos"/weight rows,
    // "Reglas" notes and the Convocado/Jugo/Sede legend table - stop at the first fully-blank row so
    // those aren't mistaken for unmatched players (a plain `return` inside forEach only skips one row).
    const blankRowIndex = dataRows.findIndex((row) => row.every((cell) => !cell?.trim()));
    const playerRows = blankRowIndex === -1 ? dataRows : dataRows.slice(0, blankRowIndex);

    playerRows.forEach((row) => {
      const galactico = row[galacticoCol]?.trim();
      if (!galactico) return;
      const player = players.find((p) => normalize(p.galactico) === normalize(galactico));
      if (!player) {
        warnings.push(`Jugador "${galactico}" existe en TDP.csv pero no en Puntos.csv; se omite su historial.`);
        return;
      }

      const percentMatch = row[tdpPercentCol]?.match(/([\d.]+)%/);
      if (percentMatch) {
        playerTdpPercent.set(galactico, Number(percentMatch[1]) / 100);
      }

      // Single lifetime flag, applied directly to the player rather than as a per-year history entry.
      player.socioFundador = toBoolean(row[socioFundadorCol]);

      categoryColumns.forEach(({ category, col: dataCol, year }) => {
        tdpHistory.push({
          id: `${player.id}-${category}-${dataCol}`,
          playerId: player.id,
          category,
          year,
          participated: toBoolean(row[dataCol])
        });
      });
    });

    return { tdpHistory, weights, playerTdpPercent };
  }
}
