/**
 * Current reading out of an Observatorio Costeiro `/ultimo/recente/{id}`
 * payload. Pure and shared: the frontend client and the ingestor both build
 * their rows from this, so the two can never read the same buoy differently.
 *
 * The payload lists, for every (codigoParametro, funcion), one entry per
 * aggregation window ('10Minutal', 'Horario', 'Diario', 'Mensual') and per
 * sensor height, in no fixed order that changes from buoy to buoy. Taking the
 * first code/function match stored an hourly mean as the wind at Cortegada, a
 * running daily mean at A Guarda, the 5.5 m water of Rande as its surface,
 * and a monthly -9999 as "no data" at Muros.
 *
 * Every measurement also carries the Xunta's own quality code. Only 1 is a
 * valid reading: 9 comes with -9999, and 3/4 mark values the platform itself
 * rejects (Cortegada's 1 m sensor reported 8.3 C and 43.9 salinity with code
 * 4 on 22-sep, and that went to the map). The declared valorMin/valorMax are
 * NOT used: the dew point range is 0..38 C, which would drop real sub-zero
 * winter dew points.
 */

export const OBS_NO_DATA = -9999;

/** The only window that is a reading of now; the rest are aggregates. */
export const OBS_CURRENT_INTERVAL = '10Minutal';

/**
 * A field whose 10-minute value is further than this from the row time
 * belongs to another moment: one sensor's series stopped while the others
 * kept publishing. Two 10-minute slots; in practice every field shares one
 * timestamp.
 */
export const OBS_MAX_FIELD_SKEW_MS = 20 * 60_000;

/** Ocean fields: the shallowest sensor down to this depth is the surface. */
export const OBS_SURFACE_MAX_DEPTH_M = 2;

/** The Xunta's quality code for a valid measurement. */
export const OBS_VALID_CODE = 1;

/** Parameters this parser returns; the row time only comes from these. */
const READ_CODES = new Set(['VV', 'DV', 'TA', 'HR', 'TO', 'TAU', 'SAL']);

export interface ObsMedicion {
  data: string;           // ISO timestamp
  valor: number;          // -9999 = no data
  // Sensor height in metres, on the measurement (the parameter has none):
  // negative = above the surface (meteorology), positive = depth (ocean).
  altura?: number;
  tipoIntervalo?: string; // '10Minutal', 'Horario', 'Diario' or 'Mensual'
  // Xunta quality code: 1 valid, 9 not recorded (-9999), 3/4 rejected.
  // Absent in trimmed fixtures; a real payload always carries it.
  codigoValidacion?: number;
}

export interface ObsParametro {
  codigoParametro: string; // VV, DV, TA, HR, TO, TAU, SAL...
  funcion: string;         // AVG, RACHA, MAX, SD...
  medicions: ObsMedicion[];
}

/** The API returns the array directly; a wrapped object is tolerated. */
export type ObsResponse = ObsParametro[] | { parametros?: ObsParametro[] };

export interface ObsCurrent {
  /** Time of the 10-minute readings the row carries. */
  time: string;
  windSpeed: number | null;
  windDir: number | null;
  windGust: number | null;
  waterTemp: number | null;
  airTemp: number | null;
  salinity: number | null;
  humidity: number | null;
  dewPoint: number | null;
}

type Layer = { kind: 'air' } | { kind: 'ocean'; maxDepth: number };
const AIR: Layer = { kind: 'air' };
const SURFACE: Layer = { kind: 'ocean', maxDepth: OBS_SURFACE_MAX_DEPTH_M };

function tenMinute(p: ObsParametro): ObsMedicion | null {
  const m = p.medicions?.[0];
  if (!m || m.tipoIntervalo !== OBS_CURRENT_INTERVAL) return null;
  if (typeof m.valor !== 'number' || !Number.isFinite(m.valor) || m.valor === OBS_NO_DATA) return null;
  if (m.codigoValidacion !== undefined && m.codigoValidacion !== OBS_VALID_CODE) return null;
  const ms = Date.parse(m.data);
  return Number.isNaN(ms) ? null : m;
}

function onLayer(m: ObsMedicion, layer: Layer): boolean {
  const h = m.altura;
  if (layer.kind === 'air') {
    // Stated height must be above the surface. A missing height is accepted:
    // the atmospheric codes (VV, DV, TA, HR, TO) never describe the water.
    return h === undefined || (typeof h === 'number' && h < 0);
  }
  return typeof h === 'number' && h >= 0 && h <= layer.maxDepth;
}

function value(
  params: ObsParametro[],
  code: string,
  func: string,
  layer: Layer,
  rowMs: number,
): number | null {
  let best: ObsMedicion | null = null;
  for (const p of params) {
    if (p.codigoParametro !== code || p.funcion !== func) continue;
    // A -9999, a rejected value, an aggregate window or another height does
    // not end the search: a later entry may hold the reading.
    const m = tenMinute(p);
    if (!m || !onLayer(m, layer)) continue;
    if (Math.abs(Date.parse(m.data) - rowMs) > OBS_MAX_FIELD_SKEW_MS) continue;
    if (layer.kind === 'air') return m.valor;
    if (!best || (m.altura as number) < (best.altura as number)) best = m;
  }
  return best ? best.valor : null;
}

/**
 * Read the current values of a payload, or null when it carries no valid
 * 10-minute reading of the parameters we use. Staleness of the row as a
 * whole is the caller's call (each side has its own window); this only
 * guarantees that every field is a valid 10-minute value from the same
 * moment as `time`.
 */
export function readObsCurrent(data: ObsResponse | null | undefined): ObsCurrent | null {
  const params = Array.isArray(data) ? data : data?.parametros;
  if (!params?.length) return null;

  // The row time is the time of the 10-minute readings we use, so a buoy
  // whose weather and water sensors stopped is stale even while its daily
  // aggregates, or its current profiler, keep being published.
  let time: string | null = null;
  let rowMs = -Infinity;
  for (const p of params) {
    if (!READ_CODES.has(p.codigoParametro)) continue;
    const m = tenMinute(p);
    if (!m) continue;
    const ms = Date.parse(m.data);
    if (ms > rowMs) { rowMs = ms; time = m.data; }
  }
  if (!time) return null;

  const v = (code: string, func: string, layer: Layer) => value(params, code, func, layer, rowMs);
  const cur: ObsCurrent = {
    time,
    windSpeed: v('VV', 'AVG', AIR),
    windDir: v('DV', 'AVG', AIR),
    windGust: v('VV', 'RACHA', AIR) ?? v('VV', 'MAX', AIR),
    waterTemp: v('TAU', 'AVG', SURFACE),
    airTemp: v('TA', 'AVG', AIR),
    salinity: v('SAL', 'AVG', SURFACE),
    humidity: v('HR', 'AVG', AIR),
    dewPoint: v('TO', 'AVG', AIR),
  };
  // A row with nothing in it says nothing, and merged over a PORTUS row it
  // would blank the fields that one does have.
  const hasAny = [cur.windSpeed, cur.windDir, cur.windGust, cur.waterTemp, cur.airTemp,
    cur.salinity, cur.humidity, cur.dewPoint].some((x) => x !== null);
  return hasAny ? cur : null;
}
