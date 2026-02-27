/**
 * Parser for the AEMET daily history JSON (src/config/aemetDailyHistory.json).
 * Handles comma-decimal Spanish format: "19,4" → 19.4
 */

// ── Raw record shape from the JSON ──────────────────────

export interface RawAemetRecord {
  fecha: string;
  indicativo: string;
  nombre: string;
  provincia: string;
  altitud: string;
  tmed: string;
  prec: string;
  tmin: string;
  horatmin: string;
  tmax: string;
  horatmax: string;
  dir: string;
  velmedia: string;
  racha: string;
  horaracha: string;
  hrMedia: string;
  hrMax: string;
  horaHrMax: string;
  hrMin: string;
  horaHrMin: string;
}

// ── Parsed record with proper numbers ───────────────────

export interface ParsedDay {
  fecha: string;        // YYYY-MM-DD
  indicativo: string;
  nombre: string;
  tmed: number | null;
  tmin: number | null;
  tmax: number | null;
  prec: number | null;
  dir: number | null;     // 0-360 degrees
  velmedia: number | null; // m/s
  racha: number | null;    // m/s (gust)
  horaracha: string;
  hrMedia: number | null;  // %
  hrMin: number | null;
  hrMax: number | null;
  month: number;          // 1-12 extracted from fecha
}

// ── Helpers ──────────────────────────────────────────────

/** Convert Spanish comma-decimal string to number. Returns null for missing/invalid. */
function parseCommaDecimal(value: string | undefined | null): number | null {
  if (!value || value === '' || value === 'Ip' || value === 'Acum') return null;
  const n = parseFloat(value.replace(',', '.'));
  return isNaN(n) ? null : n;
}

// ── Main parser ─────────────────────────────────────────

export function parseAemetRecords(records: RawAemetRecord[]): ParsedDay[] {
  return records.map((r) => {
    const [, monthStr] = r.fecha.split('-');
    return {
      fecha: r.fecha,
      indicativo: r.indicativo,
      nombre: r.nombre,
      tmed: parseCommaDecimal(r.tmed),
      tmin: parseCommaDecimal(r.tmin),
      tmax: parseCommaDecimal(r.tmax),
      prec: parseCommaDecimal(r.prec),
      dir: parseCommaDecimal(r.dir),
      velmedia: parseCommaDecimal(r.velmedia),
      racha: parseCommaDecimal(r.racha),
      horaracha: r.horaracha ?? '',
      hrMedia: parseCommaDecimal(r.hrMedia),
      hrMin: parseCommaDecimal(r.hrMin),
      hrMax: parseCommaDecimal(r.hrMax),
      month: parseInt(monthStr, 10),
    };
  });
}

// ── Filters ─────────────────────────────────────────────

export function filterByStation(days: ParsedDay[], stationId: string): ParsedDay[] {
  return days.filter((d) => d.indicativo === stationId);
}

export function filterBySeason(days: ParsedDay[], months: number[] = [6, 7, 8, 9]): ParsedDay[] {
  return days.filter((d) => months.includes(d.month));
}

export function filterByTemp(days: ParsedDay[], minTemp: number): ParsedDay[] {
  return days.filter((d) => d.tmax !== null && d.tmax >= minTemp);
}

export function filterByHumidity(days: ParsedDay[], maxHumidity: number): ParsedDay[] {
  return days.filter((d) => d.hrMedia !== null && d.hrMedia <= maxHumidity);
}

// ── Singleton cache (lazy-loaded) ────────────────────────

let cachedParsedHistory: ParsedDay[] | null = null;
let loadingPromise: Promise<ParsedDay[]> | null = null;

/**
 * Load & parse AEMET history on demand (dynamic import keeps 719 KB JSON
 * out of the initial bundle). Resolves immediately on subsequent calls.
 */
export async function loadAemetHistory(): Promise<ParsedDay[]> {
  if (cachedParsedHistory) return cachedParsedHistory;
  if (loadingPromise) return loadingPromise;

  loadingPromise = import('../config/aemetDailyHistory.json').then((mod) => {
    const json = mod.default as { records: RawAemetRecord[] };
    cachedParsedHistory = parseAemetRecords(json.records);
    return cachedParsedHistory;
  });

  return loadingPromise;
}

/** Synchronous access — returns cached data or empty array if not yet loaded. */
export function getParsedAemetHistory(): ParsedDay[] {
  return cachedParsedHistory ?? [];
}

// ── Wind rose aggregation ───────────────────────────────

import { degreesToCardinal } from './windUtils';
import type { WindRosePoint, WindRoseData } from '../types/campo';

const CARDINALS_16 = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

export function buildWindRose(
  days: ParsedDay[],
  filters: WindRoseData['filters'] = {},
): WindRoseData {
  const counts = new Map<string, number>();
  for (const c of CARDINALS_16) counts.set(c, 0);

  let total = 0;
  for (const d of days) {
    if (d.dir === null || d.dir === 0 || d.dir === 99) continue; // 0 = calm, 99 = variable
    // AEMET dir field is in decadegrees (0-36), multiply by 10 to get real degrees
    const cardinal = degreesToCardinal(d.dir * 10);
    counts.set(cardinal, (counts.get(cardinal) ?? 0) + 1);
    total++;
  }

  const points: WindRosePoint[] = CARDINALS_16.map((dir) => ({
    direction: dir,
    count: counts.get(dir) ?? 0,
    percentage: total > 0 ? Math.round(((counts.get(dir) ?? 0) / total) * 1000) / 10 : 0,
  }));

  return { points, totalDays: total, filters };
}
