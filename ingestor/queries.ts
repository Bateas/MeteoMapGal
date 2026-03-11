/**
 * SQL query functions for the MeteoMapGal History API.
 * All queries are read-only (SELECT) against TimescaleDB.
 */

import { getPool } from './db.js';

// ── Types ──────────────────────────────────────────────

export interface StationInfo {
  station_id: string;
  source: string;
  last_reading: string;
  reading_count: number;
}

export interface ReadingRow {
  time: string;
  station_id: string;
  source: string;
  temperature: number | null;
  humidity: number | null;
  wind_speed: number | null;
  wind_gust: number | null;
  wind_dir: number | null;
  pressure: number | null;
  dew_point: number | null;
  precip: number | null;
  solar_rad: number | null;
}

export interface HourlyRow {
  bucket: string;
  station_id: string;
  source: string;
  avg_temp: number | null;
  avg_humidity: number | null;
  avg_wind: number | null;
  max_gust: number | null;
  avg_pressure: number | null;
  total_precip: number | null;
}

export interface StationStats {
  station_id: string;
  source: string;
  count: number;
  first_reading: string;
  last_reading: string;
  avg_temp: number | null;
  min_temp: number | null;
  max_temp: number | null;
  avg_humidity: number | null;
  avg_wind: number | null;
  max_gust: number | null;
  avg_pressure: number | null;
  total_precip: number | null;
}

export interface HealthInfo {
  status: 'ok' | 'error';
  db_connected: boolean;
  total_readings: number;
  sources: Record<string, number>;
  time_range: { first: string | null; last: string | null };
}

// ── Queries ────────────────────────────────────────────

/** List all stations with their last reading time and total count */
export async function queryStations(): Promise<StationInfo[]> {
  const db = getPool();
  const result = await db.query<StationInfo>(`
    SELECT
      station_id,
      source,
      MAX(time)::text AS last_reading,
      COUNT(*)::int AS reading_count
    FROM readings
    GROUP BY station_id, source
    ORDER BY source, station_id
  `);
  return result.rows;
}

/** Get raw readings for a station within a time range */
export async function queryReadings(
  stationId: string,
  from: string,
  to: string,
  limit = 2000
): Promise<ReadingRow[]> {
  const db = getPool();
  const result = await db.query<ReadingRow>(
    `SELECT
      time::text,
      station_id,
      source,
      temperature,
      humidity,
      wind_speed,
      wind_gust,
      wind_dir,
      pressure,
      dew_point,
      precip,
      solar_rad
    FROM readings
    WHERE station_id = $1
      AND time >= $2::timestamptz
      AND time <= $3::timestamptz
    ORDER BY time ASC
    LIMIT $4`,
    [stationId, from, to, limit]
  );
  return result.rows;
}

/** Get hourly aggregates for a station within a time range */
export async function queryHourly(
  stationId: string,
  from: string,
  to: string,
  limit = 744 // ~31 days
): Promise<HourlyRow[]> {
  const db = getPool();
  const result = await db.query<HourlyRow>(
    `SELECT
      bucket::text,
      station_id,
      source,
      avg_temp,
      avg_humidity,
      avg_wind,
      max_gust,
      avg_pressure,
      total_precip
    FROM readings_hourly
    WHERE station_id = $1
      AND bucket >= $2::timestamptz
      AND bucket <= $3::timestamptz
    ORDER BY bucket ASC
    LIMIT $4`,
    [stationId, from, to, limit]
  );
  return result.rows;
}

/** Get latest reading per station (optionally filtered) */
export async function queryLatest(stationId?: string): Promise<ReadingRow[]> {
  const db = getPool();

  if (stationId) {
    const result = await db.query<ReadingRow>(
      `SELECT
        time::text,
        station_id,
        source,
        temperature, humidity, wind_speed, wind_gust, wind_dir,
        pressure, dew_point, precip, solar_rad
      FROM readings
      WHERE station_id = $1
      ORDER BY time DESC
      LIMIT 1`,
      [stationId]
    );
    return result.rows;
  }

  // Latest reading per station using DISTINCT ON
  const result = await db.query<ReadingRow>(`
    SELECT DISTINCT ON (station_id)
      time::text,
      station_id,
      source,
      temperature, humidity, wind_speed, wind_gust, wind_dir,
      pressure, dew_point, precip, solar_rad
    FROM readings
    WHERE time > NOW() - INTERVAL '2 hours'
    ORDER BY station_id, time DESC
  `);
  return result.rows;
}

/** Get aggregate statistics for a station over a period */
export async function queryStats(
  stationId: string,
  from: string,
  to: string
): Promise<StationStats | null> {
  const db = getPool();
  const result = await db.query<StationStats>(
    `SELECT
      station_id,
      source,
      COUNT(*)::int AS count,
      MIN(time)::text AS first_reading,
      MAX(time)::text AS last_reading,
      ROUND(AVG(temperature)::numeric, 1) AS avg_temp,
      ROUND(MIN(temperature)::numeric, 1) AS min_temp,
      ROUND(MAX(temperature)::numeric, 1) AS max_temp,
      ROUND(AVG(humidity)::numeric, 1) AS avg_humidity,
      ROUND(AVG(wind_speed)::numeric, 2) AS avg_wind,
      ROUND(MAX(wind_gust)::numeric, 2) AS max_gust,
      ROUND(AVG(pressure)::numeric, 1) AS avg_pressure,
      ROUND(SUM(precip)::numeric, 1) AS total_precip
    FROM readings
    WHERE station_id = $1
      AND time >= $2::timestamptz
      AND time <= $3::timestamptz
    GROUP BY station_id, source`,
    [stationId, from, to]
  );
  return result.rows[0] ?? null;
}

/** Health check: DB status + basic counts */
export async function queryHealth(): Promise<HealthInfo> {
  const db = getPool();
  try {
    const [countRes, sourceRes, rangeRes] = await Promise.all([
      db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM readings'),
      db.query<{ source: string; count: number }>(
        'SELECT source, COUNT(*)::int AS count FROM readings GROUP BY source ORDER BY source'
      ),
      db.query<{ first: string | null; last: string | null }>(
        'SELECT MIN(time)::text AS first, MAX(time)::text AS last FROM readings'
      ),
    ]);

    const sources: Record<string, number> = {};
    for (const row of sourceRes.rows) {
      sources[row.source] = row.count;
    }

    return {
      status: 'ok',
      db_connected: true,
      total_readings: countRes.rows[0]?.count ?? 0,
      sources,
      time_range: rangeRes.rows[0] ?? { first: null, last: null },
    };
  } catch {
    return {
      status: 'error',
      db_connected: false,
      total_readings: 0,
      sources: {},
      time_range: { first: null, last: null },
    };
  }
}

// ── Buoy Queries ──────────────────────────────────────

export interface BuoyReadingRow {
  time: string;
  station_id: number;
  station_name: string;
  source: string;
  wave_height: number | null;
  wave_height_max: number | null;
  wave_period: number | null;
  wave_period_mean: number | null;
  wave_dir: number | null;
  wind_speed: number | null;
  wind_dir: number | null;
  wind_gust: number | null;
  water_temp: number | null;
  air_temp: number | null;
  air_pressure: number | null;
  current_speed: number | null;
  current_dir: number | null;
  salinity: number | null;
  sea_level: number | null;
  humidity: number | null;
  dew_point: number | null;
}

export interface BuoyStationInfo {
  station_id: number;
  station_name: string;
  source: string;
  last_reading: string;
  reading_count: number;
}

/** List all buoy stations with their last reading time */
export async function queryBuoyStations(): Promise<BuoyStationInfo[]> {
  const db = getPool();
  const result = await db.query<BuoyStationInfo>(`
    SELECT
      station_id,
      station_name,
      source,
      MAX(time)::text AS last_reading,
      COUNT(*)::int AS reading_count
    FROM buoy_readings
    GROUP BY station_id, station_name, source
    ORDER BY station_id
  `);
  return result.rows;
}

/** Get buoy readings for a station within a time range */
export async function queryBuoyReadings(
  stationId: number,
  from: string,
  to: string,
  limit = 2000
): Promise<BuoyReadingRow[]> {
  const db = getPool();
  const result = await db.query<BuoyReadingRow>(
    `SELECT
      time::text,
      station_id, station_name, source,
      wave_height, wave_height_max, wave_period, wave_period_mean, wave_dir,
      wind_speed, wind_dir, wind_gust,
      water_temp, air_temp, air_pressure,
      current_speed, current_dir,
      salinity, sea_level, humidity, dew_point
    FROM buoy_readings
    WHERE station_id = $1
      AND time >= $2::timestamptz
      AND time <= $3::timestamptz
    ORDER BY time ASC
    LIMIT $4`,
    [stationId, from, to, limit]
  );
  return result.rows;
}

/** Get latest buoy reading per station */
export async function queryBuoyLatest(stationId?: number): Promise<BuoyReadingRow[]> {
  const db = getPool();

  if (stationId) {
    const result = await db.query<BuoyReadingRow>(
      `SELECT
        time::text,
        station_id, station_name, source,
        wave_height, wave_height_max, wave_period, wave_period_mean, wave_dir,
        wind_speed, wind_dir, wind_gust,
        water_temp, air_temp, air_pressure,
        current_speed, current_dir,
        salinity, sea_level, humidity, dew_point
      FROM buoy_readings
      WHERE station_id = $1
      ORDER BY time DESC
      LIMIT 1`,
      [stationId]
    );
    return result.rows;
  }

  const result = await db.query<BuoyReadingRow>(`
    SELECT DISTINCT ON (station_id)
      time::text,
      station_id, station_name, source,
      wave_height, wave_height_max, wave_period, wave_period_mean, wave_dir,
      wind_speed, wind_dir, wind_gust,
      water_temp, air_temp, air_pressure,
      current_speed, current_dir,
      salinity, sea_level, humidity, dew_point
    FROM buoy_readings
    WHERE time > NOW() - INTERVAL '3 hours'
    ORDER BY station_id, time DESC
  `);
  return result.rows;
}

/** Get hourly buoy aggregates for a station */
export async function queryBuoyHourly(
  stationId: number,
  from: string,
  to: string,
  limit = 744
): Promise<any[]> {
  const db = getPool();
  const result = await db.query(
    `SELECT
      bucket::text,
      station_id, source,
      avg_wave_height, max_wave_height, avg_wave_period,
      avg_wind, max_gust,
      avg_water_temp, avg_air_temp, avg_pressure,
      avg_current, avg_humidity, avg_sea_level
    FROM buoy_readings_hourly
    WHERE station_id = $1
      AND bucket >= $2::timestamptz
      AND bucket <= $3::timestamptz
    ORDER BY bucket ASC
    LIMIT $4`,
    [stationId, from, to, limit]
  );
  return result.rows;
}

/**
 * Get readings for multiple stations (comparison view).
 * Returns interleaved readings sorted by time.
 */
export async function queryMultiStation(
  stationIds: string[],
  from: string,
  to: string,
  interval: 'raw' | 'hourly' = 'raw',
  limit = 5000
): Promise<ReadingRow[] | HourlyRow[]> {
  const db = getPool();

  if (stationIds.length === 0) return [];

  // Build $1, $2, ... for station_ids
  const placeholders = stationIds.map((_, i) => `$${i + 1}`).join(', ');
  const fromIdx = stationIds.length + 1;
  const toIdx = stationIds.length + 2;
  const limitIdx = stationIds.length + 3;

  if (interval === 'hourly') {
    const result = await db.query<HourlyRow>(
      `SELECT
        bucket::text, station_id, source,
        avg_temp, avg_humidity, avg_wind, max_gust, avg_pressure, total_precip
      FROM readings_hourly
      WHERE station_id IN (${placeholders})
        AND bucket >= $${fromIdx}::timestamptz
        AND bucket <= $${toIdx}::timestamptz
      ORDER BY bucket ASC, station_id
      LIMIT $${limitIdx}`,
      [...stationIds, from, to, limit]
    );
    return result.rows;
  }

  const result = await db.query<ReadingRow>(
    `SELECT
      time::text, station_id, source,
      temperature, humidity, wind_speed, wind_gust, wind_dir,
      pressure, dew_point, precip, solar_rad
    FROM readings
    WHERE station_id IN (${placeholders})
      AND time >= $${fromIdx}::timestamptz
      AND time <= $${toIdx}::timestamptz
    ORDER BY time ASC, station_id
    LIMIT $${limitIdx}`,
    [...stationIds, from, to, limit]
  );
  return result.rows;
}
