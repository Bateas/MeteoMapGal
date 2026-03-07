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
