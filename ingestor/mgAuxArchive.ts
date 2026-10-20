/**
 * SHADOW archive of MeteoGalicia's 2 m wind and leaf wetness (table mg_aux_readings).
 *
 * The rows come from the `ultimos10min` answer the MeteoGalicia poll already downloads
 * (`fetchMeteoGalicia` keeps them aside): no extra request to MeteoGalicia. Nothing reads the table:
 * the 2 m wind among vines reads about a quarter of the wind on the water, so it stays out of
 * `readings`, the engine and the map until an exam against field truths validates it
 * (see src/api/mgAux2m.ts).
 *
 * Fire-and-forget from the poll loop: it never throws and never blocks it. A missing table (schema
 * not applied yet) is said ONCE and the archive stops until the next restart.
 */
import { getPool } from './db.js';
import { log } from './logger.js';
import type { MgAuxReading } from '../src/api/mgAux2m.js';

const COLS = 8;
const BATCH_SIZE = 200;

let disabled = false;
let running = false;

/** Testing only: forget a disabled state. */
export function __resetMgAuxArchiveForTests(): void {
  disabled = false;
  running = false;
}

/** Positional parameters and VALUES tuples for one batch (pure, tested). */
export function mgAuxInsertParts(rows: MgAuxReading[]): { tuples: string[]; values: unknown[] } {
  const values: unknown[] = [];
  const tuples = rows.map((r, i) => {
    values.push(r.time, r.stationId, r.wind2m, r.gust2m, r.dir2m, r.windSd2m, r.dirSd2m, r.leafWetMin);
    return `(${Array.from({ length: COLS }, (_, k) => `$${i * COLS + k + 1}`).join(',')})`;
  });
  return { tuples, values };
}

export async function archiveMgAux(rows: MgAuxReading[]): Promise<void> {
  if (disabled || running || rows.length === 0) return;
  running = true;
  let added = 0;
  try {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const { tuples, values } = mgAuxInsertParts(rows.slice(i, i + BATCH_SIZE));
      const res = await getPool().query(
        `INSERT INTO mg_aux_readings (time, station_id, wind_2m, gust_2m, dir_2m, wind_sd_2m, dir_sd_2m, leaf_wet_min)
         VALUES ${tuples.join(',')}
         ON CONFLICT (station_id, time) DO NOTHING`,
        values,
      );
      added += res.rowCount ?? 0;
    }
    const stations = new Set(rows.map((r) => r.stationId)).size;
    log.info(`[MG 2 m sombra] ${added} filas nuevas de ${rows.length} (${stations} estaciones)`);
  } catch (err) {
    const e = err as { code?: string; message: string };
    if (e.code === '42P01') {
      disabled = true;
      log.warn('[MG 2 m sombra] falta la tabla mg_aux_readings: aplicar ingestor/schema.sql en la base; el archivo queda parado hasta el proximo reinicio');
    } else {
      log.warn(`[MG 2 m sombra] fallo al guardar (${added} guardadas): ${e.message}`);
    }
  } finally {
    running = false;
  }
}
