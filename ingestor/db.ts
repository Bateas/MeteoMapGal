/**
 * Database module — pg Pool + batch upsert for readings.
 */

import pg from 'pg';
import type { NormalizedReading } from '../src/types/station.js';
import { log } from './logger.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function initPool(): pg.Pool {
  pool = new Pool({
    host: process.env.DB_HOST || '192.168.10.121',
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

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Map a source string from NormalizedStation format to DB source column */
function sourceLabel(stationId: string): string {
  if (stationId.startsWith('aemet_')) return 'aemet';
  if (stationId.startsWith('mg_')) return 'meteogalicia';
  if (stationId.startsWith('mc_')) return 'meteoclimatic';
  if (stationId.startsWith('wu_')) return 'wunderground';
  if (stationId.startsWith('nt_')) return 'netatmo';
  if (stationId.startsWith('skyx_')) return 'skyx';
  return 'unknown';
}

/** Number of columns per reading row */
const COLS = 12;

/**
 * Batch upsert readings into TimescaleDB.
 * Uses multi-row INSERT with ON CONFLICT DO NOTHING for dedup.
 * Batches of up to 100 rows per query to stay within PG parameter limits.
 */
export async function batchUpsert(
  readings: NormalizedReading[]
): Promise<{ inserted: number; skipped: number }> {
  if (readings.length === 0) return { inserted: 0, skipped: 0 };

  const db = getPool();
  const BATCH_SIZE = 100;
  let totalInserted = 0;

  for (let i = 0; i < readings.length; i += BATCH_SIZE) {
    const batch = readings.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const r = batch[j];
      const offset = j * COLS;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12})`
      );
      values.push(
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
      );
    }

    const sql = `
      INSERT INTO readings (time, station_id, source, temperature, humidity, wind_speed, wind_gust, wind_dir, pressure, dew_point, precip, solar_rad)
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
  const COLS = 6;
  let total = 0;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const s = batch[j];
      const o = j * COLS;
      placeholders.push(
        `($${o+1},$${o+2},$${o+3},$${o+4},$${o+5},$${o+6})`
      );
      values.push(
        s.id,
        sourceLabel(s.id),
        s.name || null,
        s.lat,
        s.lon,
        s.altitude ?? null,
      );
    }

    const sql = `
      INSERT INTO stations (station_id, source, name, latitude, longitude, altitude)
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (station_id) DO UPDATE SET
        name = EXCLUDED.name,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        altitude = EXCLUDED.altitude,
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
