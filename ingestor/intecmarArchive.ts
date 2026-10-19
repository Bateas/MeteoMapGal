/**
 * INTECMAR archive: once a UTC day, the Observatorio Costeiro's own record of the five live platforms
 * (10-minute values with their quality code, the two whole days before) and the CTD casts published
 * since the last pass. Tables intecmar_platform and intecmar_ctd (schema.sql). Plan and parsing in
 * intecmarLogic.ts; requests in intecmarClient.ts.
 *
 * What it is for: it fills the holes of the live feed (Cortegada lost 35-45 % of its readings in
 * buoy_readings, measured 19-oct) without touching buoy_readings, and it starts the history of the
 * water inside the rías (Rande at 1.5, 5.5 and 14 m; weekly CTD profiles at 43 stations). Nothing in
 * the map or the alerts reads it yet.
 *
 * Cadence: checked every hour, it runs at most once per UTC day, after 01:00 UTC, when the table has
 * nothing fetched today. 39 platform requests + 1 cast list + at most 20 CTD station-days a night
 * (about 13 on an average night, two campaigns a week), with a 1.5 s pause. The history before the last two
 * days is NOT requested here: INTECMAR was asked (19-oct) how they prefer it before any big download.
 * Without credentials it stays off with one line in the log. It never throws and never blocks the poll.
 */
import { getPool } from './db.js';
import { log } from './logger.js';
import { castDaysToFetch, castRefs, ctdRows, dedupeCtdRows, dedupePlatformRows, nextDay, platformPlan, platformRows,
  platformWindow, type CtdRow, type PlatformRow } from './intecmarLogic.js';
import { IntecmarAuthError, intecmarCredentials, intecmarGet, takeRequestCount } from './intecmarClient.js';

export const INTECMAR_CHECK_MS = 60 * 60_000;
const FIRST_HOUR_UTC = 1;
const CAST_LIST_SIZE = 60;
/** At most this many station-days of CTD per night: the first pass would otherwise ask ~60 at once. */
const MAX_CAST_DAYS_PER_PASS = 20;

let running = false;
let disabled = false;
let saidNoCredentials = false;
let attemptedDay: string | null = null;

const P_COLS = 8;

async function insertPlatform(rows: PlatformRow[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const part = rows.slice(i, i + 1000);
    const values: unknown[] = [];
    const tuples = part.map((r, k) => {
      values.push(r.time, r.station, r.parameterId, r.func, r.depthM, r.parameterCode, r.value, r.qualityCode);
      return `(${Array.from({ length: P_COLS }, (_, c) => `$${k * P_COLS + c + 1}`).join(',')})`;
    });
    const res = await getPool().query(
      `INSERT INTO intecmar_platform (time, station_code, parameter_id, func, depth_m, parameter_code, value, quality_code)
       VALUES ${tuples.join(',')}
       ON CONFLICT (station_code, parameter_id, func, depth_m, time)
       DO UPDATE SET value = EXCLUDED.value, quality_code = EXCLUDED.quality_code, fetched_at = NOW()`,
      values,
    );
    written += res.rowCount ?? 0;
  }
  return written;
}

const C_COLS = 9;

async function insertCtd(rows: CtdRow[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const part = rows.slice(i, i + 1000);
    const values: unknown[] = [];
    const tuples = part.map((r, k) => {
      values.push(r.castId, r.station, r.castDate, r.configName, r.scan, r.parameter, r.value, r.qualityFlag, r.units);
      return `(${Array.from({ length: C_COLS }, (_, c) => `$${k * C_COLS + c + 1}`).join(',')})`;
    });
    const res = await getPool().query(
      `INSERT INTO intecmar_ctd (cast_id, station_code, cast_date, config_name, scan, parameter, value, quality_flag, units)
       VALUES ${tuples.join(',')}
       ON CONFLICT (cast_id, scan, parameter)
       DO UPDATE SET value = EXCLUDED.value, quality_flag = EXCLUDED.quality_flag, fetched_at = NOW()`,
      values,
    );
    written += res.rowCount ?? 0;
  }
  return written;
}

async function fetchedToday(dayStart: Date): Promise<boolean> {
  const r = await getPool().query('SELECT 1 FROM intecmar_platform WHERE fetched_at >= $1 LIMIT 1', [dayStart]);
  return (r.rowCount ?? 0) > 0;
}

async function platformPass(nowMs: number): Promise<string> {
  const { begin, end } = platformWindow(nowMs);
  const rows: PlatformRow[] = [];
  let failed = 0;
  for (const req of platformPlan()) {
    try {
      const payload = await intecmarGet(`/moorings/data/${req.station}/${req.parameterId}/10minute`,
        { begin_date: begin, end_date: end, function: req.func, format: 'JSON' });
      rows.push(...platformRows(payload));
    } catch (err) {
      if (err instanceof IntecmarAuthError) throw err;
      failed++;
      log.warn(`[INTECMAR] ${req.station}/${req.parameterId}/${req.func}: ${(err as Error).message}`);
    }
  }
  const { rows: unique, repeated } = dedupePlatformRows(rows);
  const written = await insertPlatform(unique);
  const good = unique.filter((r) => r.qualityCode === 1).length;
  if (written < unique.length) log.warn(`[INTECMAR] plataformas: ${written} filas escritas de ${unique.length} leidas`);
  return `plataformas ${begin}..${end}: ${written} filas (${good} con codigo 1)${repeated > 0 ? `, ${repeated} repetidas` : ''}${failed > 0 ? `, ${failed} series fallaron` : ''}`;
}

async function ctdPass(): Promise<string> {
  const refs = castRefs(await intecmarGet('/ctd/cast/lasts', { top: CAST_LIST_SIZE }));
  if (refs.length === 0) return 'CTD: lista vacia';
  const ids = refs.map((r) => r.castId);
  const stored = await getPool().query('SELECT DISTINCT cast_id FROM intecmar_ctd WHERE cast_id = ANY($1::int[])', [ids]);
  const have = new Set<number>(stored.rows.map((r: { cast_id: number }) => r.cast_id));
  const pending = castDaysToFetch(refs, have);
  const todo = pending.slice(0, MAX_CAST_DAYS_PER_PASS);
  let written = 0;
  let casts = 0;
  for (const { station, day } of todo) {
    try {
      const rows = dedupeCtdRows(ctdRows(await intecmarGet(`/ctd/data/${encodeURIComponent(station)}`, { begin_date: day, end_date: nextDay(day), format: 'JSON' })));
      casts += new Set(rows.map((r) => r.castId)).size;
      written += await insertCtd(rows);
    } catch (err) {
      if (err instanceof IntecmarAuthError) throw err;
      log.warn(`[INTECMAR] CTD ${station} ${day}: ${(err as Error).message}`);
    }
  }
  const left = pending.length - todo.length;
  return `CTD: ${casts} perfiles nuevos (${written} filas) de ${refs.length} listados${left > 0 ? `, ${left} estacion-dia para la proxima noche` : ''}`;
}

export async function runIntecmarArchive(nowMs = Date.now()): Promise<void> {
  if (running || disabled) return;
  if (!intecmarCredentials()) {
    if (!saidNoCredentials) log.info('[INTECMAR] sin INTECMAR_USER / INTECMAR_PASSWORD en ingestor/.env: archivo apagado');
    saidNoCredentials = true;
    return;
  }
  const now = new Date(nowMs);
  const day = now.toISOString().slice(0, 10);
  if (now.getUTCHours() < FIRST_HOUR_UTC || attemptedDay === day) return;
  running = true;
  try {
    if (await fetchedToday(new Date(`${day}T00:00:00Z`))) {
      attemptedDay = day;
      return;
    }
    attemptedDay = day;
    const a = await platformPass(nowMs);
    const b = await ctdPass();
    log.info(`[INTECMAR] ${a}; ${b}; ${takeRequestCount()} peticiones`);
  } catch (err) {
    const e = err as { code?: string; message: string };
    if (e.code === '42P01') {
      disabled = true;
      log.warn('[INTECMAR] faltan las tablas intecmar_platform / intecmar_ctd: aplicar ingestor/schema.sql en la base; el archivo queda parado hasta el proximo reinicio');
    } else if (err instanceof IntecmarAuthError) {
      disabled = true;
      log.warn(`[INTECMAR] ${e.message}: revisar INTECMAR_USER / INTECMAR_PASSWORD; el archivo queda parado hasta el proximo reinicio (no se insiste para no bloquear la cuenta)`);
    } else {
      log.warn(`[INTECMAR] fallo: ${e.message}`);
    }
    takeRequestCount();
  } finally {
    running = false;
  }
}
