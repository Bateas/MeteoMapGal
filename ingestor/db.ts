/**
 * Database module — pg Pool + batch upsert for readings.
 */

import pg from 'pg';
import type { NormalizedReading } from '../src/types/station.js';
import { applyQualityControl, summariseQualityControl, describeQualityControl, type QualityControlled } from './readingQuality.js';
import { log } from './logger.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function initPool(): pg.Pool {
  pool = new Pool({
    host: process.env.DB_HOST || 'REDACTED_DB_HOST',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'meteomapgal',
    user: process.env.DB_USER || 'meteomap_app',
    password: process.env.DB_PASSWORD || '',
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on('error', (err) => {
    log.error('Unexpected pool error:', err.message);
  });

  return pool;
}

export function getPool(): pg.Pool {
  if (!pool) throw new Error('Pool not initialized — call initPool() first');
  return pool;
}

/**
 * Whether a column exists yet. Schema changes are applied to the database separately from the
 * code that uses them, and a query naming a missing column fails whole, so code that reads or
 * writes a new column asks first. A yes is kept; a no is asked again every 30 min, so adding
 * the column after a deploy needs no restart.
 */
const columnChecks = new Map<string, { ok: boolean; at: number }>();
export async function hasColumn(table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  const known = columnChecks.get(key);
  if (known && (known.ok || Date.now() - known.at < 30 * 60_000)) return known.ok;
  const ok = await getPool()
    .query(`SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`, [table, column])
    .then((r) => (r.rowCount ?? 0) > 0)
    .catch(() => false);
  columnChecks.set(key, { ok, at: Date.now() });
  return ok;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * The DB `source` column for a station id.
 *
 * IPMA was added to the fetchers but not here, and for its first two days
 * every Portuguese row was written as `unknown` — invisible to `?source=ipma`
 * and to the per-network health count. db.test.ts now checks this against
 * the heartbeat roster (POLLED_SOURCES), so a network cannot be polled
 * without also being labelled.
 */
export function sourceLabel(stationId: string): string {
  if (stationId.startsWith('aemet_')) return 'aemet';
  if (stationId.startsWith('mg_')) return 'meteogalicia';
  if (stationId.startsWith('mc_')) return 'meteoclimatic';
  if (stationId.startsWith('wu_')) return 'wunderground';
  if (stationId.startsWith('nt_')) return 'netatmo';
  if (stationId.startsWith('skyx_')) return 'skyx';
  if (stationId.startsWith('ipma_')) return 'ipma';
  return 'unknown';
}

/** Column order of a readings row: the INSERT list, the placeholders and readingRow() all follow it. */
export const READING_COLUMNS = [
  'time', 'station_id', 'source', 'temperature', 'humidity', 'wind_speed', 'wind_gust', 'wind_dir',
  'pressure', 'dew_point', 'precip', 'solar_rad', 'visibility', 'wind_gust_raw', 'wind_speed_raw', 'qc_flag',
  'wind_dir_sd', 'wind_speed_sd', 'sun_frac', 'temp_10cm', 'soil_temp',
] as const;
const COLS = READING_COLUMNS.length;

/** One readings row, in READING_COLUMNS order. Exported so a test can check the two stay the same length. */
export function readingRow(q: QualityControlled): unknown[] {
  const { reading: r, windGustRaw, windSpeedRaw, qcFlag } = q;
  return [
    r.timestamp,           // time
    r.stationId,           // station_id
    sourceLabel(r.stationId), // source
    r.temperature,         // temperature
    r.humidity,            // humidity
    r.windSpeed,           // wind_speed
    r.windGust,            // wind_gust
    r.windDirection,       // wind_dir
    r.pressure,            // pressure
    r.dewPoint,            // dew_point
    r.precipitation,       // precip
    r.solarRadiation,      // solar_rad
    r.visibility ?? null,  // visibility  Phase 1b TIER 2 (only AEMET airport ~8 stations)
    // QC archive. The raw columns stay null when nothing was rejected —
    // the clean column already holds that value, so storing it twice buys
    // nothing. qc_flag is 0 for a row we checked and found clean, which is
    // deliberately NOT the same as the NULL older rows carry.
    windGustRaw,           // wind_gust_raw
    windSpeedRaw,          // wind_speed_raw
    qcFlag,                // qc_flag
    r.windDirSd ?? null,   // wind_dir_sd   (MeteoGalicia + AEMET only)
    r.windSpeedSd ?? null, // wind_speed_sd
    r.sunFrac ?? null,     // sun_frac
    r.temp10cm ?? null,    // temp_10cm     (MeteoGalicia only)
    r.soilTemp ?? null,    // soil_temp     (MeteoGalicia only)
  ];
}

/**
 * Stations whose anemometer is stopped, refreshed once per cycle from 24h of
 * history (findStuckAnemometers). Held here rather than passed down through
 * every caller because quality control has exactly one entry point — batchUpsert
 * — and this is the only fact it needs that a single reading cannot carry.
 *
 * Empty by default, so a cold start or a failed refresh trusts every zero: the
 * failure mode is the behaviour we had before, never a wind silently discarded.
 */
let stuckAnemometers: ReadonlySet<string> = new Set();

export function setStuckAnemometers(ids: ReadonlySet<string>): void {
  stuckAnemometers = ids;
}

/**
 * Batch upsert readings into TimescaleDB.
 * Uses multi-row INSERT with ON CONFLICT DO NOTHING for dedup.
 * Batches of up to 100 rows per query to stay within PG parameter limits.
 */
export async function batchUpsert(
  readings: NormalizedReading[]
): Promise<{ inserted: number; skipped: number }> {
  if (readings.length === 0) return { inserted: 0, skipped: 0 };

  // Quality control runs here and NOWHERE ELSE on the way in. It returns the
  // reading exactly as every existing consumer expects it — implausible values
  // nulled — plus what was rejected and why, so the archive keeps what the
  // filter throws away. See readingQuality.ts for why that distinction matters.
  const controlled = readings.map((r) => applyQualityControl(r, stuckAnemometers));

  // Say what was rejected. A nulled column is indistinguishable from a sensor
  // the station never had, so without this line the checks are invisible and a
  // filter that quietly broke would look exactly like a filter with nothing to
  // do. Silent on a clean cycle, which is most of them.
  const qcLine = describeQualityControl(summariseQualityControl(controlled));
  if (qcLine) log.info(qcLine);

  const db = getPool();
  const BATCH_SIZE = 100;
  let totalInserted = 0;

  for (let i = 0; i < readings.length; i += BATCH_SIZE) {
    const batch = controlled.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const offset = j * COLS;
      // Built from COLS so adding a column cannot leave the placeholder count behind.
      placeholders.push(`(${Array.from({ length: COLS }, (_, k) => `$${offset + k + 1}`).join(', ')})`);
      values.push(...readingRow(batch[j]));
    }

    const sql = `
      INSERT INTO readings (${READING_COLUMNS.join(', ')})
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (time, station_id) DO NOTHING
    `;

    try {
      const result = await db.query(sql, values);
      totalInserted += result.rowCount ?? 0;
    } catch (err) {
      log.error(`Batch insert failed (${batch.length} rows):`, (err as Error).message);
    }
  }

  return {
    inserted: totalInserted,
    skipped: readings.length - totalInserted,
  };
}

// ── Buoy readings ──────────────────────────────────────

export interface BuoyReadingRow {
  time: string;
  stationId: number;
  stationName: string;
  source: 'portus' | 'obscosteiro';
  waveHeight: number | null;
  waveHeightMax: number | null;
  wavePeriod: number | null;
  wavePeriodMean: number | null;
  waveDir: number | null;
  windSpeed: number | null;
  windDir: number | null;
  windGust: number | null;
  waterTemp: number | null;
  airTemp: number | null;
  airPressure: number | null;
  currentSpeed: number | null;
  currentDir: number | null;
  salinity: number | null;
  seaLevel: number | null;
  humidity: number | null;
  dewPoint: number | null;
}

const BUOY_COLS = 21;

/**
 * Batch upsert buoy readings into TimescaleDB.
 * Uses multi-row INSERT with ON CONFLICT DO NOTHING for dedup.
 */
export async function batchUpsertBuoys(
  readings: BuoyReadingRow[]
): Promise<{ inserted: number; skipped: number }> {
  if (readings.length === 0) return { inserted: 0, skipped: 0 };

  const db = getPool();
  const BATCH_SIZE = 50; // Fewer rows per batch (more columns)
  let totalInserted = 0;

  for (let i = 0; i < readings.length; i += BATCH_SIZE) {
    const batch = readings.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const r = batch[j];
      const o = j * BUOY_COLS;
      placeholders.push(
        `($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7},$${o+8},$${o+9},$${o+10},$${o+11},$${o+12},$${o+13},$${o+14},$${o+15},$${o+16},$${o+17},$${o+18},$${o+19},$${o+20},$${o+21})`
      );
      values.push(
        r.time, r.stationId, r.stationName, r.source,
        r.waveHeight, r.waveHeightMax, r.wavePeriod, r.wavePeriodMean, r.waveDir,
        r.windSpeed, r.windDir, r.windGust,
        r.waterTemp, r.airTemp, r.airPressure,
        r.currentSpeed, r.currentDir, r.salinity, r.seaLevel,
        r.humidity, r.dewPoint,
      );
    }

    const sql = `
      INSERT INTO buoy_readings (
        time, station_id, station_name, source,
        wave_height, wave_height_max, wave_period, wave_period_mean, wave_dir,
        wind_speed, wind_dir, wind_gust,
        water_temp, air_temp, air_pressure,
        current_speed, current_dir, salinity, sea_level,
        humidity, dew_point
      )
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (time, station_id) DO NOTHING
    `;

    try {
      const result = await db.query(sql, values);
      totalInserted += result.rowCount ?? 0;
    } catch (err) {
      log.error(`Buoy batch insert failed (${batch.length} rows):`, (err as Error).message);
    }
  }

  return {
    inserted: totalInserted,
    skipped: readings.length - totalInserted,
  };
}

// ── Station metadata ──────────────────────────────────

/**
 * Persist station coordinates on discovery.
 * Uses ON CONFLICT to upsert (update coords + timestamp if station already exists).
 */
export async function batchUpsertStations(
  stations: Map<string, import('../src/types/station.js').NormalizedStation>
): Promise<number> {
  const db = getPool();
  const entries = Array.from(stations.values());
  if (entries.length === 0) return 0;

  const BATCH_SIZE = 100;
  // Must match BOTH the column list and the values pushed below. Getting this
  // wrong misaligns every row's parameter indices and Postgres rejects the
  // whole batch — which is how the province column shipped empty.
  const COLS = 7;
  let total = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const s = batch[j];
      const o = j * COLS;
      placeholders.push(
        `($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6},$${o+7})`
      );
      values.push(
        s.id,
        sourceLabel(s.id),
        s.name || null,
        s.lat,
        s.lon,
        s.altitude ?? null,
        s.province ?? null,
      );
    }

    // `source` is refreshed on conflict too, so a row first written with the
    // wrong label (IPMA went in as unknown for two days) corrects itself on
    // the next discovery instead of needing a manual UPDATE.
    const sql = `
      INSERT INTO stations (station_id, source, name, latitude, longitude, altitude, province)
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (station_id) DO UPDATE SET
        source = EXCLUDED.source,
        name = EXCLUDED.name,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        altitude = EXCLUDED.altitude,
        province = EXCLUDED.province,
        updated_at = NOW()
    `;

    try {
      const result = await db.query(sql, values);
      total += result.rowCount ?? 0;
    } catch (err) {
      log.error(`Station upsert failed: ${(err as Error).message}`);
    }
  }

  return total;
}

/** Persist webcam vision analysis results to webcam_readings table */
export async function batchUpsertWebcamReadings(
  readings: {
    time: Date; webcamId: string; spotId: string | null;
    beaufort: number; confidence: string; fog: boolean;
    visibility: string; sky: string; description: string;
    provider: string; latencyMs: number;
  }[],
): Promise<number> {
  if (readings.length === 0) return 0;
  const db = getPool();
  let total = 0;

  for (const r of readings) {
    try {
      const result = await db.query(
        `INSERT INTO webcam_readings (time, webcam_id, spot_id, beaufort, confidence, fog, visibility, sky, description, provider, latency_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (time, webcam_id) DO NOTHING`,
        [r.time, r.webcamId, r.spotId, r.beaufort, r.confidence, r.fog, r.visibility, r.sky, r.description, r.provider, r.latencyMs],
      );
      total += result.rowCount ?? 0;
    } catch (err) {
      log.error(`Webcam upsert failed (${r.webcamId}): ${(err as Error).message}`);
    }
  }

  return total;
}

/** Quick connectivity check */
export async function pingDb(): Promise<boolean> {
  try {
    const db = getPool();
    await db.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
