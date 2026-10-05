/**
 * Stores what the weather model said the day before at the five buoys of the wind model and at every
 * spot (nwpPreviousLogic.ts has the why and the measured gain) in nwp_previous_hourly.
 *
 * Cost, every 6 h: one request with the default model for the buoys, the spots and the 47 stations of
 * the overnight-minimum model (66 coordinates), and one per extra model for the five buoys (3 x 5): ~324
 * coordinate-calls a day against the Open-Meteo free tier. Points without their history get it once, in
 * chunks (nwpFetchPlan). Goes through the same breaker as every other Open-Meteo call: the daily quota is
 * shared with the forecast and the convection grid.
 *
 * Temperature and cloud need two columns (schema.sql, 6-oct). Until they exist the fetcher keeps storing
 * the wind as before and leaves the station points out, with a warning once a day.
 */
import { getPool } from './db.js';
import { log } from './logger.js';
import {
  isOpen as isOpenMeteoBreakerOpen,
  reportRateLimit as reportOpenMeteoRateLimit,
  reportSuccess as reportOpenMeteoSuccess,
} from './openMeteoBreaker.js';
import {
  buildPreviousRunsUrl,
  nwpAllPoints,
  nwpFetchPlan,
  nwpModelPoints,
  nwpStationPoints,
  parsePreviousRuns,
  NWP_LEAD_DAYS,
  NWP_TMIN_STATIONS,
  type NwpPoint,
  type NwpPreviousRow,
  type NwpRequest,
} from './nwpPreviousLogic.js';

export const NWP_PREVIOUS_INTERVAL_MS = 6 * 60 * 60_000;
const FETCH_TIMEOUT_MS = 30_000;
const BACKFILL_TIMEOUT_MS = 90_000;    // seven months for every new point in one reply
const CHUNK = 500;

/** Oldest stored hour per point: a point missing here has no history yet. */
async function oldestByPoint(): Promise<Map<string, number>> {
  const r = await getPool().query<{ point: string; oldest: Date }>(
    'SELECT point, min(valid_time) AS oldest FROM nwp_previous_hourly WHERE lead_days = $1 GROUP BY point',
    [NWP_LEAD_DAYS],
  );
  return new Map(r.rows.map((row) => [row.point, new Date(row.oldest).getTime()]));
}

/** Whether temp_c and cloud_pct exist yet (schema.sql of 6-oct). Asked every cycle until they do. */
let weatherColumns = false;
let lastColumnsWarn = 0;
async function hasWeatherColumns(): Promise<boolean> {
  if (weatherColumns) return true;
  const r = await getPool().query<{ n: string }>(
    `SELECT count(*) AS n FROM information_schema.columns
      WHERE table_name = 'nwp_previous_hourly' AND column_name IN ('temp_c', 'cloud_pct')`,
  );
  weatherColumns = Number(r.rows[0]?.n) === 2;
  if (!weatherColumns && Date.now() - lastColumnsWarn > 24 * 3_600_000) {
    lastColumnsWarn = Date.now();
    log.warn('[NWP] faltan las columnas temp_c y cloud_pct en nwp_previous_hourly: aplica el schema; guardo solo el viento y dejo fuera las estaciones');
  }
  return weatherColumns;
}

/** The overnight-minimum stations with the coordinates the stations table has for them. */
async function stationPoints(): Promise<NwpPoint[]> {
  const r = await getPool().query<{ station_id: string; latitude: number | null; longitude: number | null }>(
    'SELECT station_id, latitude, longitude FROM stations WHERE station_id = ANY($1)',
    [[...NWP_TMIN_STATIONS]],
  );
  return nwpStationPoints(r.rows);
}

async function persist(rows: NwpPreviousRow[], withWeather: boolean): Promise<number> {
  let written = 0;
  const n = withWeather ? 8 : 6;
  // Column names are fixed literals here, never input: only the values go as parameters.
  const cols = withWeather ? ['wind_kt', 'wind_dir', 'gust_kt', 'temp_c', 'cloud_pct'] : ['wind_kt', 'wind_dir', 'gust_kt'];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    for (const r of part) {
      values.push(`(${Array.from({ length: n }, () => `$${p++}`).join(', ')})`);
      params.push(r.validTime, r.point, r.leadDays, r.windKt, r.windDir, r.gustKt);
      if (withWeather) params.push(r.tempC, r.cloudPct);
    }
    // A value that differs updates: the archive can still settle an hour whose day-before run arrived late.
    // Identical values are not rewritten, so the count below is what actually changed.
    const res = await getPool().query(
      `INSERT INTO nwp_previous_hourly (valid_time, point, lead_days, ${cols.join(', ')})
       VALUES ${values.join(', ')}
       ON CONFLICT (valid_time, point, lead_days) DO UPDATE
         SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, fetched_at = NOW()
         WHERE (${cols.map((c) => `nwp_previous_hourly.${c}`).join(', ')})
               IS DISTINCT FROM (${cols.map((c) => `EXCLUDED.${c}`).join(', ')})`,
      params,
    );
    written += res.rowCount ?? 0;
  }
  return written;
}

export async function runNwpPreviousCycle(): Promise<void> {
  if (isOpenMeteoBreakerOpen()) {
    log.info('[NWP] Open-Meteo en pausa (cuota): la prevision de la vispera espera al siguiente ciclo');
    return;
  }
  try {
    const now = Date.now();
    const withWeather = await hasWeatherColumns();
    const points = [...nwpAllPoints(), ...nwpModelPoints(), ...(withWeather ? await stationPoints() : [])];
    const plan = nwpFetchPlan(points, await oldestByPoint(), now);
    for (const req of plan) {
      if (!(await runRequest(req, now, withWeather))) return;   // a 429 or an error: the next cycle retries
    }
  } catch (err) {
    // Never fatal: a missing forecast only means the wind model predicts without it.
    log.warn(`[NWP] ciclo fallido: ${(err as Error).message}`);
  }
}

async function runRequest(req: NwpRequest, now: number, withWeather: boolean): Promise<boolean> {
  const res = await fetch(buildPreviousRunsUrl(req.points, req.start, req.end), {
    signal: AbortSignal.timeout(req.backfill ? BACKFILL_TIMEOUT_MS : FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    if (res.status === 429) reportOpenMeteoRateLimit('nwp-previous');
    log.warn(`[NWP] Open-Meteo previous runs ${res.status} (${req.model}${req.backfill ? ', historico' : ''})`);
    return false;
  }
  reportOpenMeteoSuccess();
  const rows = parsePreviousRuns(await res.json(), req.points, now);
  const written = await persist(rows, withWeather);
  const last = rows.reduce((m, r) => Math.max(m, r.validTime.getTime()), 0);
  const kinds = ([['boyas', /^(\w+@)?boya:/], ['spots', /^spot:/], ['estaciones', /^est:/]] as const)
    .map(([name, re]) => [name, req.points.filter((p) => re.test(p.id)).length] as const)
    .filter(([, n]) => n > 0).map(([name, n]) => `${n} ${name}`).join(' + ');
  // Heartbeat on every request: silence would read as "not running".
  log.ok(`[NWP] prevision de la vispera (${req.model}): ${rows.length} horas recibidas, ${written} nuevas o cambiadas `
    + `(${kinds}, ${req.start} a `
    + `${last ? new Date(last).toISOString().slice(0, 13) + 'h' : '-'}${req.backfill ? ', historico' : ''})`);
  return true;
}
