/**
 * Forecast archive: every sector forecast the ingestor already downloads, kept
 * with the hour it was ISSUED.
 *
 * The live cache replaces each hour's forecast with the newest one, and the
 * convection grid keeps one row per hour written mostly after that hour. So
 * nothing in the database could say what we knew in the morning about the
 * afternoon, and a model meant to warn hours ahead can only be trained on that.
 *
 * No extra provider requests: rows come from the refresh that already happens.
 * Fire-and-forget from the caller; a failed write is logged, never thrown.
 */
import { getPool } from './db.js';
import { log } from './logger.js';
import type { HourlyForecast } from '../src/types/forecast.js';

/** Longest lead worth keeping. Past three days the forecast carries little for a warning. */
export const MAX_LEAD_H = 72;
const HOUR_MS = 3_600_000;

export interface ArchiveRow {
  issuedAt: Date;
  validTime: Date;
  sector: string;
  model: string;
  values: (number | string | null)[];
}

const num = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Rows to archive from one refresh. The issue time is truncated to the hour so
 * a second refresh in the same hour collides on the primary key and is dropped
 * instead of duplicating. Only hours from the issue hour to MAX_LEAD_H ahead:
 * past hours in the payload are what the model already knows happened.
 */
export function buildArchiveRows(
  sector: string,
  model: string,
  fetchedAt: Date,
  hours: HourlyForecast[],
): ArchiveRow[] {
  const issued = Math.floor(fetchedAt.getTime() / HOUR_MS) * HOUR_MS;
  const rows: ArchiveRow[] = [];
  for (const h of hours) {
    const t = h.time instanceof Date ? h.time.getTime() : NaN;
    if (!Number.isFinite(t)) continue;
    const valid = Math.floor(t / HOUR_MS) * HOUR_MS;
    if (valid < issued || valid - issued > MAX_LEAD_H * HOUR_MS) continue;
    rows.push({
      issuedAt: new Date(issued),
      validTime: new Date(valid),
      sector,
      model,
      values: [
        num(h.windSpeed), num(h.windDirection), num(h.windGusts), num(h.temperature), num(h.humidity),
        num(h.precipitation), num(h.precipProbability), num(h.cloudCover), num(h.pressure), num(h.solarRadiation),
        num(h.cape), num(h.cin), num(h.liftedIndex), num(h.boundaryLayerHeight), num(h.temperature500hPa),
        h.skyState ?? null,
      ],
    });
  }
  return rows;
}

const COLUMNS = [
  'issued_at', 'valid_time', 'sector', 'model',
  'wind_ms', 'wind_dir', 'gust_ms', 'temp_c', 'humidity',
  'precip_mm', 'precip_prob', 'cloud_pct', 'pressure', 'solar_wm2',
  'cape', 'cin', 'lifted_index', 'pbl_m', 't500_c', 'sky_state',
];

/** Writes the rows; returns how many were new. Duplicate issue hours are ignored. */
export async function writeArchiveRows(rows: ArchiveRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const params: unknown[] = [];
  const tuples: string[] = [];
  for (const r of rows) {
    const vals = [r.issuedAt, r.validTime, r.sector, r.model, ...r.values];
    if (vals.length !== COLUMNS.length) throw new Error(`forecast archive: ${vals.length} values for ${COLUMNS.length} columns`);
    const base = params.length;
    tuples.push(`(${vals.map((_, i) => `$${base + i + 1}`).join(', ')})`);
    params.push(...vals);
  }
  const sql = `INSERT INTO forecast_archive (${COLUMNS.join(', ')}) VALUES ${tuples.join(', ')}
    ON CONFLICT (issued_at, sector, valid_time) DO NOTHING`;
  const res = await getPool().query(sql, params);
  return res.rowCount ?? 0;
}

/** Called after a successful refresh. Never throws, never blocks the caller. */
export function archiveForecast(sector: string, model: string, fetchedAt: Date, hours: HourlyForecast[]): void {
  let rows: ArchiveRow[];
  try {
    rows = buildArchiveRows(sector, model, fetchedAt, hours);
  } catch (err) {
    log.warn(`[ForecastArchive] ${sector}: could not build rows: ${(err as Error).message}`);
    return;
  }
  writeArchiveRows(rows)
    .then((n) => {
      if (n > 0) log.info(`[ForecastArchive] ${sector} (${model}): ${n} of ${rows.length} hours archived`);
    })
    .catch((err) => log.warn(`[ForecastArchive] ${sector}: write failed: ${(err as Error).message}`));
}
