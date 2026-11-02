/**
 * Archive of what POEM sends for the port stations and the map does not use (table poem_aux):
 * visibility, irradiance and precipitation. No extra request: three more columns in the rows the
 * buoy fetch already asks for. Fire-and-forget: it never throws. A missing table is said ONCE and the
 * archive stops until the next restart.
 */
import { getPool } from './db.js';
import { log } from './logger.js';
import type { PoemAuxRow } from './poemLogic.js';

const COLS = 10;
const BATCH_SIZE = 200;

let disabled = false;
const unitsSaid = new Set<string>();

/** Testing only. */
export function __resetPoemAuxForTests(): void {
  disabled = false;
  unitsSaid.clear();
}

/** Positional parameters and VALUES tuples for one batch (pure, tested). */
export function poemAuxInsertParts(rows: PoemAuxRow[]): { tuples: string[]; values: unknown[] } {
  const values: unknown[] = [];
  const tuples = rows.map((r, i) => {
    values.push(r.time, r.stationId, r.visibility, r.visibilityQc, r.visibilityCause, r.irradiance, r.irradianceQc, r.precip, r.precipQc, r.units);
    return `(${Array.from({ length: COLS }, (_, k) => `$${i * COLS + k + 1}`).join(',')})`;
  });
  return { tuples, values };
}

export async function archivePoemAux(rows: PoemAuxRow[]): Promise<void> {
  if (disabled || rows.length === 0) return;
  for (const r of rows) {
    const key = `${r.stationId}|${r.units}`;
    if (!unitsSaid.has(key)) {
      unitsSaid.add(key);
      log.info(`[POEM aux] estacion ${r.stationId}: ${r.units}`);
    }
  }
  try {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const { tuples, values } = poemAuxInsertParts(rows.slice(i, i + BATCH_SIZE));
      await getPool().query(
        `INSERT INTO poem_aux (time, station_id, visibility, visibility_qc, visibility_cause, irradiance, irradiance_qc, precip, precip_qc, units)
         VALUES ${tuples.join(',')}
         ON CONFLICT (station_id, time) DO NOTHING`,
        values,
      );
    }
  } catch (err) {
    const e = err as { code?: string; message: string };
    if (e.code === '42P01') {
      disabled = true;
      log.warn('[POEM aux] falta la tabla poem_aux: aplicar ingestor/schema.sql en la base; parado hasta el proximo reinicio');
    } else {
      log.warn(`[POEM aux] fallo al guardar: ${e.message}`);
    }
  }
}
