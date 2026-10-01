/**
 * Puertos del Estado buoys through POEM (https://poem.puertos.es), the access
 * Puertos del Estado asked us to use instead of PORTUSSRV (1-oct-2026).
 *
 * Pure logic, no requests (those live in poemClient.ts, the cycle in
 * buoyFetcher.ts): which table and columns hold each station, the scale
 * factor, the units, the quality flags and the time.
 *
 * What the API gives (user guide of 27-jun-2025 and its public definitions):
 * - Values are integers: the real value is the integer divided by a factor
 *   that depends on the station and the column (doris/doris/estacion_param).
 * - The unit of each parameter is in doris/doris/param (`unidad`).
 * - Each variable carries a quality flag, `qc_<column>` (the waves of the
 *   moored buoys share `qc_e`, their direction `qc_d`); 1 or 2 = correct.
 * - Times are UTC. `fecha` comes as a number by default (seconds since 1970).
 *
 * Fail closed: a value whose factor, unit or quality is not known, or that
 * falls outside physical bounds once scaled, is dropped and counted, never
 * stored. A wrong factor or unit would otherwise reach the spot verdicts.
 */

import type { BuoyReadingRow } from './db.js';
import { portusFechaToIso } from '../src/api/portusTime.js';

/** The fields of a stored buoy row that POEM can fill. */
export type PoemField =
  | 'waveHeight' | 'waveHeightMax' | 'wavePeriod' | 'wavePeriodMean' | 'waveDir'
  | 'windSpeed' | 'windDir' | 'windGust'
  | 'waterTemp' | 'airTemp' | 'airPressure'
  | 'currentSpeed' | 'currentDir' | 'salinity' | 'seaLevel' | 'humidity';

/**
 * Column → field, by the column names of the real-time tables. The mareógrafo
 * tables have two gust candidates (`vv_mx`, `vv_ra`): `vv_mx` wins and `vv_ra`
 * is only used where a station has no `vv_mx`.
 */
export const POEM_COLUMN_FIELD: Readonly<Record<string, PoemField>> = {
  hm0: 'waveHeight', hmax: 'waveHeightMax', tp: 'wavePeriod', tm02: 'wavePeriodMean', dmd: 'waveDir',
  vv_md: 'windSpeed', dv_md: 'windDir', vv_mx: 'windGust', vv_ra: 'windGust',
  ts1: 'waterTemp', ts: 'waterTemp', ta: 'airTemp', ps: 'airPressure',
  vc_md: 'currentSpeed', dc_md: 'currentDir', sa1: 'salinity', sa: 'salinity',
  nivel: 'seaLevel', hr: 'humidity',
};

/**
 * The real-time tables we read, under /doris/, with their columns as the public
 * definition lists them (1-oct-2026). Also the allowlist for the table names that
 * arrive in the metadata: a name outside it is never put in a URL. The order
 * breaks ties when a station has the same number of useful columns in two.
 */
export const POEM_REALTIME_TABLES: ReadonlyArray<readonly [string, string]> = [
  ['mareas/redmar_mir_tr', 'codigo fecha nivel qc_nivel hmax hm0 tm02 tp qc_hmax qc_hm0 qc_tm02 qc_tp vv_md vv_mx vv_ra qc_vv_md qc_vv_mx qc_vv_ra dv_md dv_mx dv_ra qc_dv_md qc_dv_mx qc_dv_ra ta ps qc_ta qc_ps ol qc_ol'],
  ['mareas/marinemet_tr', 'codigo fecha nivel qc_nivel hmax hm0 tm02 tp qc_hmax qc_hm0 qc_tm02 qc_tp vv_md vv_mx vv_ra qc_vv_md qc_vv_mx qc_vv_ra dv_md dv_mx dv_ra qc_dv_md qc_dv_mx qc_dv_ra ta ps qc_ta qc_ps ol qc_ol nivel2 qc_nivel2'],
  ['boyas/redext_tr', 'codigo fecha fecha_re ps qc_ps ta qc_ta vv_md qc_vv_md dv_md qc_dv_md cd1 qc_cd1 ts1 qc_ts1 sa1 qc_sa1 cd2 qc_cd2 ts2 qc_ts2 sa2 qc_sa2 vc_md qc_vc_md dc_md qc_dc_md hm0 tm02 tp dmd dmd_p iu hm0_lf tm02_lf dmd_lf hm0_mf tm02_mf dmd_mf hm0_hf tm02_hf dmd_hf qc_e qc_d bat lon lat qc_pos hmax hr qc_hr ox qc_ox vv_mx qc_vv_mx'],
  ['meteoro/rempor_tr', 'codigo fecha bat qc_bat vv_md qc_vv_md vv_mx qc_vv_mx vv_sg qc_vv_sg dv_md qc_dv_md dv_mx qc_dv_mx dv_sg qc_dv_sg ta qc_ta hr qc_hr ps qc_ps ir qc_ir pc qc_pc vs qc_vs'],
  ['meteoro/rempor2_tr', 'codigo fecha vv_md qc_vv_md vv_mx qc_vv_mx dv_md qc_dv_md dv_mx qc_dv_mx hr qc_hr ps qc_ps ir qc_ir pc qc_pc vs qc_vs vs_cause ta qc_ta'],
  ['boyas/redcosm_tr', 'codigo fecha ps qc_ps ta qc_ta vv_md qc_vv_md dv_md qc_dv_md ts qc_ts sa qc_sa vc_md qc_vc_md dc_md qc_dc_md hmax h13 h110 hm th13 th110 tm hm0 tm02 tp dmd ds qc_e qc_d bat lon lat qc_pos hr qc_hr'],
  ['boyas/redcos_tr', 'codigo fecha ts qc_ts hmax h13 h110 hm th13 th110 tm hm0 tm02 tp dmd ds qc_e qc_d bat lon lat qc_pos dmd_p'],
  ['boyas/externos_tr', 'codigo fecha ta qc_ta vv_md qc_vv_md dv_md qc_dv_md ts1 qc_ts1 sa1 qc_sa1 ps qc_ps hm0 tm02 tp dmd qc_e qc_d lon lat qc_pos hmax vc_md qc_vc_md dc_md qc_dc_md hr qc_hr'],
];

const TABLE_COLUMNS = new Map(POEM_REALTIME_TABLES.map(([t, cols]) => [t, new Set(cols.split(' '))]));
const TABLE_ORDER = POEM_REALTIME_TABLES.map(([t]) => t);

/** A row of doris/doris/estacion_param. */
export interface EstacionParamRow {
  param?: number | null;
  factor?: number | string | null;
  db_column?: string | null;
  db_table?: string | null;
}

/** A row of doris/doris/param. */
export interface ParamInfo {
  id_param?: number | null;
  descripcion?: string | null;
  unidad?: string | null;
}

export interface PoemColumnPlan {
  column: string;
  field: PoemField;
  factor: number;
  unit: string | null;
  qcColumn: string | null;
  description: string | null;
}

export interface PoemStationPlan {
  stationId: number;
  /** Path under /doris/, e.g. "mareas/redmar_mir_tr". */
  table: string;
  columns: PoemColumnPlan[];
}

/** "boyas.redcos_tr" (or "redcos_tr") → "boyas/redcos_tr" if it is a table we read, else null. */
export function poemTablePath(dbTable: string | null | undefined): string | null {
  if (!dbTable) return null;
  const t = dbTable.trim().replace('.', '/');
  if (TABLE_COLUMNS.has(t)) return t;
  const bare = t.includes('/') ? t.split('/').pop()! : t;
  return TABLE_ORDER.find((known) => known.endsWith(`/${bare}`)) ?? null;
}

/** The quality flag that judges a column in a table, or null if the table has none for it. */
export function qcColumnFor(table: string, column: string): string | null {
  const cols = TABLE_COLUMNS.get(table);
  if (!cols) return null;
  if (cols.has(`qc_${column}`)) return `qc_${column}`;
  if (['hm0', 'hmax', 'tp', 'tm02'].includes(column) && cols.has('qc_e')) return 'qc_e';
  if (column === 'dmd' && cols.has('qc_d')) return 'qc_d';
  return null;
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * The plan for one station: the real-time table with the most columns we use,
 * and for each of those columns its field, factor, unit and quality flag.
 * Columns without a valid factor are left out (logged by the caller as missing).
 */
export function buildStationPlan(
  stationId: number,
  rows: readonly EstacionParamRow[],
  params: ReadonlyMap<number, ParamInfo>,
): PoemStationPlan | null {
  const byTable = new Map<string, PoemColumnPlan[]>();
  for (const r of rows) {
    const table = poemTablePath(r.db_table);
    const column = r.db_column?.trim();
    if (!table || !column) continue;
    const field = POEM_COLUMN_FIELD[column];
    if (!field || !TABLE_COLUMNS.get(table)?.has(column)) continue;
    const factor = toNumber(r.factor);
    if (factor == null || factor <= 0) continue;
    const info = r.param != null ? params.get(r.param) : undefined;
    const list = byTable.get(table) ?? [];
    if (list.some((c) => c.column === column)) continue;
    list.push({
      column,
      field,
      factor,
      unit: info?.unidad?.trim() || null,
      qcColumn: qcColumnFor(table, column),
      description: info?.descripcion?.trim() || null,
    });
    byTable.set(table, list);
  }
  if (byTable.size === 0) return null;
  const usefulFields = (cols: PoemColumnPlan[]) => new Set(cols.map((c) => c.field)).size;
  const [table, columns] = [...byTable.entries()].sort(
    ([ta, a], [tb, b]) => usefulFields(b) - usefulFields(a) || TABLE_ORDER.indexOf(ta) - TABLE_ORDER.indexOf(tb),
  )[0];
  // One column per field. The gust: vv_mx over vv_ra.
  const chosen = new Map<PoemField, PoemColumnPlan>();
  for (const c of columns) {
    const prev = chosen.get(c.field);
    if (!prev || (c.field === 'windGust' && c.column === 'vv_mx')) chosen.set(c.field, c);
  }
  return { stationId, table, columns: [...chosen.values()] };
}

/** The columns to ask for: the data, their quality flags, the station code and the time. */
export function planRequestColumns(plan: PoemStationPlan): string[] {
  const cols = new Set(['codigo', 'fecha']);
  for (const c of plan.columns) {
    cols.add(c.column);
    if (c.qcColumn) cols.add(c.qcColumn);
  }
  return [...cols];
}

// ── Units ──────────────────────────────────────────────

function normUnit(u: string): string {
  return u.toLowerCase().replace(/º/g, '°').replace(/\s+/g, '').replace(/\.$/, '');
}

const SPEED_FIELDS = new Set<PoemField>(['windSpeed', 'windGust', 'currentSpeed']);

/**
 * The value, already divided by its factor, in our units: m/s, m, s, degrees,
 * °C, hPa, %, PSU. null = unit not understood (the value is dropped). A speed
 * without a unit is dropped too: km/h read as m/s would pass every bound.
 */
export function toInternalUnit(field: PoemField, value: number, unit: string | null): number | null {
  const u = unit ? normUnit(unit) : '';
  if (!u) return SPEED_FIELDS.has(field) ? null : value;
  switch (field) {
    case 'windSpeed':
    case 'windGust':
    case 'currentSpeed':
      if (['m/s', 'ms-1', 'm·s-1', 'm.s-1', 'ms^-1', 'mps'].includes(u)) return value;
      if (u === 'cm/s' || u === 'cms-1') return value / 100;
      if (u === 'mm/s') return value / 1000;
      if (u === 'km/h' || u === 'kmh') return value / 3.6;
      if (['kt', 'kn', 'knots', 'nudos', 'nudo'].includes(u)) return value * 0.514444;
      return null;
    case 'seaLevel':
    case 'waveHeight':
    case 'waveHeightMax':
      if (u === 'm' || u === 'metros') return value;
      if (u === 'cm') return value / 100;
      if (u === 'mm') return value / 1000;
      return null;
    case 'wavePeriod':
    case 'wavePeriodMean':
      return ['s', 'seg', 'segundos', 'sec'].includes(u) ? value : null;
    case 'waveDir':
    case 'windDir':
    case 'currentDir':
      return ['°', 'grados', 'grado', 'deg', 'degrees', 'grad', '°n', 'gradosn'].includes(u) ? value : null;
    case 'waterTemp':
    case 'airTemp':
      return ['°c', 'c', '°', 'celsius', 'gradoscelsius', 'gradoscentígrados', 'gradoscentigrados'].includes(u) ? value : null;
    case 'airPressure':
      if (['hpa', 'mb', 'mbar', 'milibares', 'milibar'].includes(u)) return value;
      if (u === 'pa') return value / 100;
      if (u === 'kpa') return value * 10;
      return null;
    case 'humidity':
      return u === '%' ? value : null;
    case 'salinity':
      return ['psu', 'ups', 'pss', 'pss-78', '‰', 'g/kg', 'ppt'].includes(u) ? value : null;
  }
}

/** Physical bounds in our units. Outside = a wrong factor or unit, or a broken sensor. */
const BOUNDS: Readonly<Record<PoemField, readonly [number, number]>> = {
  waveHeight: [0, 25], waveHeightMax: [0, 40], wavePeriod: [0, 30], wavePeriodMean: [0, 30], waveDir: [0, 360],
  windSpeed: [0, 75], windDir: [0, 360], windGust: [0, 90],
  waterTemp: [-2, 35], airTemp: [-15, 48], airPressure: [900, 1090],
  currentSpeed: [0, 5], currentDir: [0, 360], salinity: [0, 45], seaLevel: [-10, 10], humidity: [0, 100],
};

// ── Rows ───────────────────────────────────────────────

/** `fecha` as POEM sends it (seconds, milliseconds or a UTC wall-clock string) → epoch ms. */
export function poemFechaMs(fecha: unknown): number | null {
  const n = toNumber(fecha);
  if (n != null && /^\s*-?\d+(\.\d+)?\s*$/.test(String(fecha))) {
    return n > 1e12 ? n : n * 1000;
  }
  if (typeof fecha === 'string') {
    const iso = portusFechaToIso(fecha);
    return iso ? Date.parse(iso) : null;
  }
  return null;
}

/** A Limit=1 answer is an object, any other an array; an empty one may be {} or null. */
export function poemRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((r): r is Record<string, unknown> => r != null && typeof r === 'object');
  if (data != null && typeof data === 'object' && Object.keys(data).length > 0) return [data as Record<string, unknown>];
  return [];
}

export interface PoemRowResult {
  reading: BuoyReadingRow | null;
  /** Why there is no reading at all. */
  skip?: 'empty' | 'no-time' | 'stale' | 'future' | 'no-values';
  /** Values dropped from the row, as "column:reason" (reason = qc=N, unit, range, nan). */
  dropped: string[];
}

const ACCEPTED_QC = new Set([1, 2]);
const FUTURE_SLACK_MS = 10 * 60_000;

export function poemRowToReading(
  plan: PoemStationPlan,
  stationName: string,
  row: Record<string, unknown> | null | undefined,
  nowMs: number,
  maxAgeMs: number,
): PoemRowResult {
  const dropped: string[] = [];
  if (!row || Object.keys(row).length === 0) return { reading: null, skip: 'empty', dropped };
  const t = poemFechaMs(row.fecha);
  if (t == null) return { reading: null, skip: 'no-time', dropped };
  if (nowMs - t > maxAgeMs) return { reading: null, skip: 'stale', dropped };
  if (t - nowMs > FUTURE_SLACK_MS) return { reading: null, skip: 'future', dropped };

  const reading: BuoyReadingRow = {
    time: new Date(t).toISOString(),
    stationId: plan.stationId,
    stationName,
    source: 'portus',
    waveHeight: null, waveHeightMax: null, wavePeriod: null,
    wavePeriodMean: null, waveDir: null,
    windSpeed: null, windDir: null, windGust: null,
    waterTemp: null, airTemp: null, airPressure: null,
    currentSpeed: null, currentDir: null,
    salinity: null, seaLevel: null,
    humidity: null, dewPoint: null,
  };

  let filled = 0;
  for (const c of plan.columns) {
    const raw = row[c.column];
    if (raw == null || raw === '') continue;
    const n = toNumber(raw);
    if (n == null) { dropped.push(`${c.column}:nan`); continue; }
    if (c.qcColumn) {
      const qc = toNumber(row[c.qcColumn]);
      if (qc != null && !ACCEPTED_QC.has(qc)) { dropped.push(`${c.column}:qc=${qc}`); continue; }
    }
    const value = toInternalUnit(c.field, n / c.factor, c.unit);
    if (value == null) { dropped.push(`${c.column}:unit`); continue; }
    const [lo, hi] = BOUNDS[c.field];
    if (value < lo || value > hi) { dropped.push(`${c.column}:range`); continue; }
    reading[c.field] = Math.round(value * 1000) / 1000;
    filled++;
  }
  if (filled === 0) return { reading: null, skip: 'no-values', dropped };
  return { reading, dropped };
}

/** When a token stops working, from its own `exp` claim (no signature check: we only read the date). */
export function jwtExpiryMs(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const exp = toNumber(json?.exp);
    return exp != null ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** "2026-10-01T06:00:00+00:00", the form the guide uses in its date filters. */
export function poemIsoUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+00:00');
}
