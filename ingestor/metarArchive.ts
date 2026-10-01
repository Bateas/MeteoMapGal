/**
 * METAR archive: the reports of the three Galician airports (Vigo LEVX, Santiago LEST, A Coruña
 * LECO), stored as published, every 30 minutes.
 *
 * Why: fog has no measured label in the Rías. Of the AEMET visibility sensors, Pontevedra saw
 * 9 days of fog from April to September and the others are far away; the airport reports
 * (present weather FG/BR plus visibility) were read live by the map and thrown away. Kept,
 * they are the label a fog model needs, starting now.
 *
 * The API keeps the last ~400 reports (about 3 days for these three), so the first pass after
 * a start asks for 72 h and fills what a stop left out; later passes ask for 3 h. Repeats are
 * absorbed by the primary key. The pass never throws and never blocks the poll.
 */
import { getPool } from './db.js';
import { log } from './logger.js';
import { metarRows, type MetarRow } from './metarRows.js';

const METAR_URL = 'https://aviationweather.gov/api/data/metar?ids=LEVX,LEST,LECO&format=json';
export const METAR_ARCHIVE_INTERVAL_MS = 30 * 60_000;

let filledAfterStart = false;
let running = false;
let disabled = false;

const COLS = 14;

async function insert(rows: MetarRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const values: unknown[] = [];
  const tuples = rows.map((r, i) => {
    values.push(r.obsTime, r.icao, r.visibilityKm, r.wx, r.tempC, r.dewpointC, r.windDir, r.windKt, r.gustKt,
      r.pressureHpa, r.cover, r.clouds, r.rawOb, new Date());
    return `(${Array.from({ length: COLS }, (_, k) => `$${i * COLS + k + 1}`).join(',')})`;
  });
  const res = await getPool().query(
    `INSERT INTO metar_reports (obs_time, icao, visibility_km, wx, temp_c, dewpoint_c, wind_dir, wind_kt, gust_kt,
       pressure_hpa, cover, clouds, raw_ob, fetched_at)
     VALUES ${tuples.join(',')}
     ON CONFLICT (icao, obs_time) DO NOTHING`,
    values,
  );
  return res.rowCount ?? 0;
}

export async function runMetarArchive(): Promise<void> {
  if (running || disabled) return;
  running = true;
  const hours = filledAfterStart ? 3 : 72;
  try {
    const res = await fetch(`${METAR_URL}&hours=${hours}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      log.warn(`[METAR] HTTP ${res.status}`);
      return;
    }
    const rows = metarRows(await res.json());
    const added = await insert(rows);
    filledAfterStart = true;
    const fog = rows.filter((r) => r.wx != null && /FG|BR/.test(r.wx)).length;
    log.info(`[METAR] ${added} partes nuevos de ${rows.length} leidos (${hours} h)${fog > 0 ? `, ${fog} con niebla o neblina` : ''}`);
  } catch (err) {
    const e = err as { code?: string; message: string };
    if (e.code === '42P01') {
      disabled = true;
      log.warn('[METAR] falta la tabla metar_reports: aplicar ingestor/schema.sql en la base; el archivo queda parado hasta el proximo reinicio');
    } else {
      log.warn(`[METAR] fallo: ${e.message}`);
    }
  } finally {
    running = false;
  }
}
