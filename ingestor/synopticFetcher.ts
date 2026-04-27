/**
 * Synoptic (upper-air + convection) fetcher — S125 Phase 1b TIER 1.
 *
 * Pulls Open-Meteo hourly data for two sector centers and persists:
 *   1. Upper-air winds + temperature at 850 / 700 / 500 hPa
 *   2. CAPE / CIN / LI / PWAT / boundary-layer height
 *
 * These are the SYNOPTIC drivers that surface observations alone can't
 * explain. Without them we can only describe weather; with them we can
 * correlate, classify and eventually predict.
 *
 * Why a separate fetcher (not extending forecastFetcher.ts):
 *   - Different cadence (hourly anchor, not 30min cache TTL)
 *   - Different table (long-term storage, not display cache)
 *   - Different lifecycle (kept forever, append-only)
 *
 * Volume:
 *   - upper_air_hourly: 24h × 2 sectors × 3 levels = 144 rows/day ≈ 53K/year
 *   - convection_hourly: 24h × 2 sectors = 48 rows/day ≈ 18K/year
 *   ≈ 5MB/year combined. Trivial.
 */

import { getPool } from './db.js';
import { log } from './logger.js';

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const FETCH_TIMEOUT_MS = 12_000;

// Sector centers — same as forecastFetcher.ts to keep correlations clean
const SECTOR_COORDS = [
  { sector: 'embalse', lat: 42.29, lon: -8.10 },
  { sector: 'rias',    lat: 42.307, lon: -8.619 },
] as const;

const PRESSURE_LEVELS = [850, 700, 500] as const;

// ── Types ─────────────────────────────────────────────

export interface UpperAirRow {
  time: Date;
  sector: string;
  pressureHpa: number;
  windDirDeg: number | null;
  windSpeedMs: number | null;
  temperatureC: number | null;
  geopotentialM: number | null;
}

export interface ConvectionRow {
  time: Date;
  sector: string;
  cape: number | null;
  cin: number | null;
  liftedIndex: number | null;
  /** ALWAYS NULL — Open-Meteo doesn't expose precipitable_water in this endpoint
   *  (validated S125 returned 400). Column kept for future fill-in from another source. */
  precipitableWater: number | null;
  boundaryLayerM: number | null;
}

interface OpenMeteoResponse {
  hourly: {
    time: string[];
    cape?: (number | null)[];
    convective_inhibition?: (number | null)[];
    lifted_index?: (number | null)[];
    boundary_layer_height?: (number | null)[];
    [k: string]: unknown;
  };
}

// ── Pure parsing ─────────────────────────────────────

/**
 * Convert the multi-array hourly response into one row per (time, level) for
 * upper-air + one row per time for convection.
 *
 * This split-from-the-payload step is pure — no I/O. Tests cover the index
 * arithmetic and the null-tolerance.
 */
export function parseSynopticPayload(
  json: OpenMeteoResponse,
  sector: string,
): { upperAir: UpperAirRow[]; convection: ConvectionRow[] } {
  const h = json?.hourly;
  if (!h || !Array.isArray(h.time)) return { upperAir: [], convection: [] };

  const upperAir: UpperAirRow[] = [];
  const convection: ConvectionRow[] = [];

  const getArr = (key: string): (number | null)[] => {
    const v = h[key];
    return Array.isArray(v) ? (v as (number | null)[]) : [];
  };

  for (let i = 0; i < h.time.length; i++) {
    const t = new Date(h.time[i]);
    if (Number.isNaN(t.getTime())) continue;

    // Upper-air at each pressure level
    for (const p of PRESSURE_LEVELS) {
      const dir = getArr(`wind_direction_${p}hPa`)[i];
      const spd = getArr(`wind_speed_${p}hPa`)[i];
      const tmp = getArr(`temperature_${p}hPa`)[i];
      const gph = getArr(`geopotential_height_${p}hPa`)[i];
      // Skip if we have absolutely nothing useful at this level for this hour
      if (dir == null && spd == null && tmp == null && gph == null) continue;
      upperAir.push({
        time: t,
        sector,
        pressureHpa: p,
        windDirDeg: dir ?? null,
        windSpeedMs: spd ?? null,
        temperatureC: tmp ?? null,
        geopotentialM: gph ?? null,
      });
    }

    // Convection bundle (one row per time)
    const cape = h.cape?.[i] ?? null;
    const cin = h.convective_inhibition?.[i] ?? null;
    const li = h.lifted_index?.[i] ?? null;
    const blh = h.boundary_layer_height?.[i] ?? null;
    if (cape != null || cin != null || li != null || blh != null) {
      convection.push({
        time: t,
        sector,
        cape, cin, liftedIndex: li,
        precipitableWater: null, // Open-Meteo doesn't provide it in this endpoint
        boundaryLayerM: blh,
      });
    }
  }

  return { upperAir, convection };
}

// ── Fetcher ──────────────────────────────────────────

async function fetchSector(lat: number, lon: number): Promise<OpenMeteoResponse | null> {
  const upperVars = PRESSURE_LEVELS.flatMap((p) => [
    `wind_direction_${p}hPa`,
    `wind_speed_${p}hPa`,
    `temperature_${p}hPa`,
    `geopotential_height_${p}hPa`,
  ]);
  // S125 hotfix: precipitable_water removed — Open-Meteo /v1/forecast returns
  // 400 "Cannot initialize ... from invalid String value precipitable_water".
  // The DB column stays (nullable) for future fill-in from another source.
  const convectionVars = ['cape', 'convective_inhibition', 'lifted_index', 'boundary_layer_height'];

  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    hourly: [...upperVars, ...convectionVars].join(','),
    past_hours: '6',
    forecast_hours: '12',
    wind_speed_unit: 'ms',
    timezone: 'UTC',
  });

  try {
    const res = await fetch(`${OPEN_METEO_URL}?${params}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      log.warn(`[Synoptic] Open-Meteo ${res.status} for ${lat},${lon}`);
      return null;
    }
    return await res.json() as OpenMeteoResponse;
  } catch (err) {
    log.warn(`[Synoptic] fetch failed: ${(err as Error).message}`);
    return null;
  }
}

// ── DB persist ───────────────────────────────────────

async function batchInsertUpperAir(rows: UpperAirRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const db = getPool();
  const values: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  for (const r of rows) {
    values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
    params.push(r.time, r.sector, r.pressureHpa, r.windDirDeg, r.windSpeedMs, r.temperatureC, r.geopotentialM);
  }
  const sql = `
    INSERT INTO upper_air_hourly
      (time, sector, pressure_hpa, wind_dir_deg, wind_speed_ms, temperature_c, geopotential_m)
    VALUES ${values.join(', ')}
    ON CONFLICT (time, sector, pressure_hpa) DO UPDATE
      SET wind_dir_deg   = EXCLUDED.wind_dir_deg,
          wind_speed_ms  = EXCLUDED.wind_speed_ms,
          temperature_c  = EXCLUDED.temperature_c,
          geopotential_m = EXCLUDED.geopotential_m
  `;
  try {
    const r = await db.query(sql, params);
    return r.rowCount ?? 0;
  } catch (err) {
    log.error(`[Synoptic] upper_air insert: ${(err as Error).message}`);
    return 0;
  }
}

async function batchInsertConvection(rows: ConvectionRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const db = getPool();
  const values: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  for (const r of rows) {
    values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
    params.push(r.time, r.sector, r.cape, r.cin, r.liftedIndex, r.precipitableWater, r.boundaryLayerM);
  }
  const sql = `
    INSERT INTO convection_hourly
      (time, sector, cape, cin, lifted_index, precipitable_water, boundary_layer_m)
    VALUES ${values.join(', ')}
    ON CONFLICT (time, sector) DO UPDATE
      SET cape               = EXCLUDED.cape,
          cin                = EXCLUDED.cin,
          lifted_index       = EXCLUDED.lifted_index,
          precipitable_water = EXCLUDED.precipitable_water,
          boundary_layer_m   = EXCLUDED.boundary_layer_m
  `;
  try {
    const r = await db.query(sql, params);
    return r.rowCount ?? 0;
  } catch (err) {
    log.error(`[Synoptic] convection insert: ${(err as Error).message}`);
    return 0;
  }
}

// ── Public entry ─────────────────────────────────────

/**
 * One synoptic cycle: hit Open-Meteo for each sector, persist upper-air +
 * convection. ON CONFLICT DO UPDATE because the same hour gets refined as
 * the model run progresses (e.g. forecast → analysis), and we want the
 * latest authoritative value.
 *
 * The past_hours=6 + forecast_hours=12 window means each poll covers
 * ±6h around the present so we capture the model's most recent re-analysis
 * of recent past hours (where the data is most accurate).
 */
export async function runSynopticCycle(): Promise<void> {
  let totalUpper = 0;
  let totalConv = 0;

  for (const c of SECTOR_COORDS) {
    const json = await fetchSector(c.lat, c.lon);
    if (!json) continue;

    const { upperAir, convection } = parseSynopticPayload(json, c.sector);
    const upperInserted = await batchInsertUpperAir(upperAir);
    const convInserted = await batchInsertConvection(convection);
    totalUpper += upperInserted;
    totalConv += convInserted;

    log.info(
      `[Synoptic] ${c.sector}: upper-air ${upperAir.length} parsed (${upperInserted} written), ` +
      `convection ${convection.length} parsed (${convInserted} written)`,
    );
  }

  if (totalUpper === 0 && totalConv === 0) {
    log.warn('[Synoptic] cycle ok but 0 rows written (Open-Meteo silent or network)');
  }
}
