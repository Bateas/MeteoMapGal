/**
 * MeteoGalicia's own hourly record of every station (table mg_hourly), so a frozen feed costs no hour.
 *
 * Since 28-oct its 10-min service stops updating for 40-90 min on working days. `ultimos10min` only
 * ever has the latest record, so what it did not show is gone from `readings`; the hourly service
 * still has it. One request a night brings all the stations at once (`ultimosHorariosEstacions`
 * with no idEst): `datosHorariosEstacions` takes one station per request and would be 155.
 *
 * What it does not bring: the mean wind (VV_AVG_10m) comes for 4 stations of 155 at first and appears
 * in the record weeks later (Marin: there on 1-oct, not on 20-oct, read 3-nov). Gust, direction,
 * temperature, humidity, rain and sun are there the same night.
 *
 * Values as published, -9999 as NULL, and a validation code other than 1 goes in `flags` next to the
 * value: 2 is suspect, 3 wrong. A reader that wants clean data filters on it. Nothing reads the table
 * yet and it never reaches `readings`: an hourly figure is not a 10-min one.
 *
 * Fire-and-forget from an hourly timer: it never throws and never blocks the poll. A missing table
 * (schema not applied yet) is said ONCE and the archive stops until the next restart.
 */
import { getPool } from './db.js';
import { log } from './logger.js';
import { SERVER_USER_AGENT } from '../src/config/serverIdentity.js';

const MG_BASE = 'https://servizos.meteogalicia.gal/mgrss/observacion';
const HOUR_MS = 3_600_000;
const BATCH_SIZE = 200;
/** The first full run can be about 50 MB. */
const REQUEST_TIMEOUT_MS = 180_000;
const MAX_ATTEMPTS_PER_DAY = 3;
/** Runs after this UTC hour, once the nightly INTECMAR jobs are going, far from anyone's use. */
const RUN_AFTER_UTC_HOUR = 3;
/** A record newer than this means tonight's run is done. */
const FRESH_ENOUGH_MS = 20 * HOUR_MS;
const MIN_HOURS = 26;
const MAX_HOURS = 240;
/** The day before the first freeze: where the very first run goes back to. */
const FIRST_HOUR_MS = Date.UTC(2026, 9, 27);
/** Some stations stamp hours ahead of now (O Fieitoso and Santiago-San Lazaro 12 days on 3-nov). */
const FUTURE_MARGIN_MS = HOUR_MS;

/** Code as published -> column. Asked by name: with no idParam the mean wind is left out. */
export const MG_HOURLY_PARAMS = {
  VV_AVG_10m: 'wind_avg',
  VV_RACHA_10m: 'wind_gust',
  DV_AVG_10m: 'wind_dir',
  VV_AVG_2m: 'wind_avg_2m',
  VV_RACHA_2m: 'wind_gust_2m',
  DV_AVG_2m: 'wind_dir_2m',
  'TA_AVG_1.5m': 'temp',
  'TA_MIN_1.5m': 'temp_min',
  'TA_MAX_1.5m': 'temp_max',
  'HR_AVG_1.5m': 'humidity',
  'PP_SUM_1.5m': 'precip',
  'IP_MAX_1.5m': 'rain_rate',
  'RS_AVG_1.5m': 'solar',
  'HSOL_SUM_1.5m': 'sun_h',
  'PR_AVG_1.5m': 'pressure',
  'PRED_AVG_1.5m': 'pressure_red',
  HF_SUM_2m: 'leaf_wet_h',
} as const;

type Column = (typeof MG_HOURLY_PARAMS)[keyof typeof MG_HOURLY_PARAMS];
const COLUMNS = Object.values(MG_HOURLY_PARAMS) as Column[];

export interface MgHourlyRow {
  time: string;
  stationId: string;
  values: Partial<Record<Column, number>>;
  flags: Record<string, number> | null;
}

interface RawMedida { codigoParametro?: string; lnCodigoValidacion?: number; valor?: number }
interface RawInstante { instanteLecturaUTC?: string; listaMedidas?: RawMedida[] }
interface RawEstacion { idEstacion?: number; listaInstantes?: RawInstante[] }

export function mgHourlyUrl(numHoras: number): string {
  return `${MG_BASE}/ultimosHorariosEstacions.action?numHoras=${numHoras}&idParam=${Object.keys(MG_HOURLY_PARAMS).join(',')}`;
}

/** Hours to ask: back to the last one stored and two more, so a missed night fills itself in. */
export function mgHourlyHoursToAsk(lastStoredMs: number | null, nowMs: number): number {
  const hours = Math.ceil((nowMs - (lastStoredMs ?? FIRST_HOUR_MS)) / HOUR_MS) + 2;
  return Math.min(MAX_HOURS, Math.max(MIN_HOURS, hours));
}

/** Whether tonight's run is still to do. */
export function mgHourlyDue(lastStoredMs: number | null, nowMs: number): boolean {
  if (new Date(nowMs).getUTCHours() < RUN_AFTER_UTC_HOUR) return false;
  return lastStoredMs == null || nowMs - lastStoredMs >= FRESH_ENOUGH_MS;
}

/** Rows of one answer (pure). Hours stamped ahead of now are counted and left out. */
export function parseMgHourly(body: unknown, nowMs: number): { rows: MgHourlyRow[]; futureHours: number } {
  const stations = (body as { listHorarios?: RawEstacion[] } | null)?.listHorarios;
  const rows: MgHourlyRow[] = [];
  let futureHours = 0;
  if (!Array.isArray(stations)) return { rows, futureHours };
  const known = MG_HOURLY_PARAMS as Record<string, Column>;
  for (const station of stations) {
    if (station.idEstacion == null) continue;
    const seen = new Set<string>(); // one insert cannot touch the same row twice
    for (const instant of station.listaInstantes ?? []) {
      const stamp = instant.instanteLecturaUTC;
      if (!stamp || seen.has(stamp)) continue;
      const ms = Date.parse(`${stamp}Z`);
      if (!Number.isFinite(ms)) continue;
      if (ms > nowMs + FUTURE_MARGIN_MS) { futureHours++; continue; }
      seen.add(stamp);
      const values: MgHourlyRow['values'] = {};
      const flags: Record<string, number> = {};
      for (const m of instant.listaMedidas ?? []) {
        const code = m.codigoParametro;
        const column = code ? known[code] : undefined;
        if (!code || !column || typeof m.valor !== 'number' || m.valor === -9999) continue;
        values[column] = m.valor;
        if (m.lnCodigoValidacion != null && m.lnCodigoValidacion !== 1) flags[code] = m.lnCodigoValidacion;
      }
      if (Object.keys(values).length === 0) continue;
      rows.push({
        time: new Date(ms).toISOString(),
        stationId: `mg_${station.idEstacion}`,
        values,
        flags: Object.keys(flags).length > 0 ? flags : null,
      });
    }
  }
  return { rows, futureHours };
}

/** Positional parameters and VALUES tuples for one batch (pure, tested). */
export function mgHourlyInsertParts(rows: MgHourlyRow[]): { tuples: string[]; values: unknown[] } {
  const width = COLUMNS.length + 3;
  const values: unknown[] = [];
  const tuples = rows.map((r, i) => {
    values.push(r.time, r.stationId, ...COLUMNS.map((c) => r.values[c] ?? null), r.flags ? JSON.stringify(r.flags) : null);
    return `(${Array.from({ length: width }, (_, k) => `$${i * width + k + 1}`).join(',')})`;
  });
  return { tuples, values };
}

// A later answer completes a row and never empties it: the mean wind arrives weeks after the rest.
const UPSERT_COLUMNS = ['time', 'station_id', ...COLUMNS, 'flags'].join(', ');
const UPSERT_SET = [...COLUMNS, 'flags'].map((c) => `${c} = COALESCE(EXCLUDED.${c}, mg_hourly.${c})`).join(', ');

let disabled = false;
let running = false;
let attemptsDay = '';
let attempts = 0;

/** Testing only: forget the state between tests. */
export function __resetMgHourlyForTests(): void {
  disabled = false;
  running = false;
  attemptsDay = '';
  attempts = 0;
}

export async function runMgHourlyArchive(nowMs = Date.now()): Promise<void> {
  if (disabled || running) return;
  running = true;
  try {
    const res = await getPool().query('SELECT max(time) AS last FROM mg_hourly');
    const last: Date | null = res.rows[0]?.last ?? null;
    const lastMs = last ? new Date(last).getTime() : null;
    if (!mgHourlyDue(lastMs, nowMs)) return;

    const day = new Date(nowMs).toISOString().slice(0, 10);
    if (day !== attemptsDay) { attemptsDay = day; attempts = 0; }
    if (attempts >= MAX_ATTEMPTS_PER_DAY) return;
    attempts++;

    const hours = mgHourlyHoursToAsk(lastMs, nowMs);
    const answer = await fetch(mgHourlyUrl(hours), {
      headers: { 'User-Agent': SERVER_USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!answer.ok) throw new Error(`HTTP ${answer.status}`);
    const { rows, futureHours } = parseMgHourly(await answer.json(), nowMs);

    let written = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const { tuples, values } = mgHourlyInsertParts(rows.slice(i, i + BATCH_SIZE));
      const r = await getPool().query(
        `INSERT INTO mg_hourly (${UPSERT_COLUMNS}) VALUES ${tuples.join(',')}
         ON CONFLICT (station_id, time) DO UPDATE SET ${UPSERT_SET}`,
        values,
      );
      written += r.rowCount ?? 0;
    }
    const stations = new Set(rows.map((r) => r.stationId)).size;
    const future = futureHours > 0 ? `, ${futureHours} horas con fecha futura fuera` : '';
    log.info(`[MG horario] ${written} filas de ${stations} estaciones (${hours} h pedidas${future})`);
  } catch (err) {
    const e = err as { code?: string; message: string };
    if (e.code === '42P01' || e.code === '42703') {
      disabled = true;
      log.warn('[MG horario] falta la tabla mg_hourly o sus columnas: aplicar ingestor/schema.sql en la base; el archivo se para hasta reiniciar');
    } else {
      log.warn(`[MG horario] fallo: ${e.message}`);
    }
  } finally {
    running = false;
  }
}
