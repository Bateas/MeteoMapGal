/**
 * What AEMET's observation answer carries and `readings` does not keep (table aemet_aux): the real
 * minimum and maximum of the hour, ground and soil temperature, spread of the wind, height of 925 hPa.
 * No extra request: it is the answer the poll already downloads, once an hour, with the last 12 hours.
 * For the models (frost, stability); nothing else reads it.
 *
 * Fire-and-forget from the poll: it never throws. A missing table is said ONCE and the archive stops
 * until the next restart.
 */
import { getPool } from './db.js';
import { log } from './logger.js';
import type { AemetRawObservation } from '../src/types/aemet.js';

export interface AemetAuxRow {
  time: Date;
  stationId: string;
  taMin: number | null;      // C, minimum of the hour
  taMax: number | null;      // C, maximum of the hour
  groundTemp: number | null; // C, at the surface (ts)
  soil5: number | null;      // C at 5 cm (tss5cm)
  soil20: number | null;     // C at 20 cm (tss20cm)
  windSd: number | null;     // m/s (stdvv)
  dirSd: number | null;      // degrees (stddv)
  geo925: number | null;     // geopotential height of 925 hPa, as AEMET gives it
}

const COLS = 10;
const BATCH_SIZE = 200;

const within = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;

/** One AEMET observation to a row, or null when its time does not parse or it has none of these (pure). */
export function aemetAuxRow(o: AemetRawObservation): AemetAuxRow | null {
  const time = new Date(o.fint);
  if (typeof o.idema !== 'string' || !o.idema || Number.isNaN(time.getTime())) return null;
  const row: AemetAuxRow = {
    time,
    stationId: `aemet_${o.idema}`,
    taMin: within(o.tamin, -40, 60),
    taMax: within(o.tamax, -40, 60),
    groundTemp: within(o.ts, -40, 80),
    soil5: within(o.tss5cm, -30, 70),
    soil20: within(o.tss20cm, -30, 70),
    windSd: within(o.stdvv, 0, 30),
    dirSd: within(o.stddv, 0, 180),
    geo925: within(o.geo925, 0, 2000),
  };
  const { time: _t, stationId: _s, ...fields } = row;
  return Object.values(fields).some((v) => v != null) ? row : null;
}

/** Positional parameters and VALUES tuples for one batch (pure, tested). */
export function aemetAuxInsertParts(rows: AemetAuxRow[]): { tuples: string[]; values: unknown[] } {
  const values: unknown[] = [];
  const tuples = rows.map((r, i) => {
    values.push(r.time, r.stationId, r.taMin, r.taMax, r.groundTemp, r.soil5, r.soil20, r.windSd, r.dirSd, r.geo925);
    return `(${Array.from({ length: COLS }, (_, k) => `$${i * COLS + k + 1}`).join(',')})`;
  });
  return { tuples, values };
}

let disabled = false;

/** Testing only. */
export function __resetAemetAuxForTests(): void {
  disabled = false;
}

/** Keeps the observations of the stations we follow. */
export async function archiveAemetAux(obs: AemetRawObservation[], stationIds: ReadonlySet<string>): Promise<void> {
  if (disabled) return;
  const rows = obs.map(aemetAuxRow).filter((r): r is AemetAuxRow => r != null && stationIds.has(r.stationId));
  if (rows.length === 0) return;
  let added = 0;
  try {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const { tuples, values } = aemetAuxInsertParts(rows.slice(i, i + BATCH_SIZE));
      const res = await getPool().query(
        `INSERT INTO aemet_aux (time, station_id, ta_min, ta_max, ground_temp, soil_5, soil_20, wind_sd, dir_sd, geo925)
         VALUES ${tuples.join(',')}
         ON CONFLICT (station_id, time) DO NOTHING`,
        values,
      );
      added += res.rowCount ?? 0;
    }
    log.info(`[AEMET aux] ${added} filas nuevas de ${rows.length}`);
  } catch (err) {
    const e = err as { code?: string; message: string };
    if (e.code === '42P01') {
      disabled = true;
      log.warn('[AEMET aux] falta la tabla aemet_aux: aplicar ingestor/schema.sql en la base; parado hasta el proximo reinicio');
    } else {
      log.warn(`[AEMET aux] fallo al guardar (${added} guardadas): ${e.message}`);
    }
  }
}
