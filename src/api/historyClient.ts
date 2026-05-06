/**
 * History API client — fetches historical weather data from TimescaleDB.
 *
 * In dev: Vite proxy → http://REDACTED_APP_HOST:3001
 * In prod: nginx → http://127.0.0.1:3001
 *
 * All endpoints return JSON with consistent structure.
 */

const BASE = '/api/v1';
const TIMEOUT = 15_000;

// ── Types ──────────────────────────────────────────────

export interface HistoryStation {
  station_id: string;
  source: string;
  last_reading: string;
  reading_count: number;
}

export interface HistoryReading {
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

export interface HourlyReading {
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

// ── Helpers ────────────────────────────────────────────

async function fetchJson<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== '') {
        url.searchParams.set(key, value);
      }
    }
  }

  // S131: retry on 502/503/504 (transient gateway/server hiccups). Reduces F12
  // noise from "GET ... 503" entries the browser auto-logs even when our catch
  // handles the error gracefully. Backoff: 800ms, 2400ms (jittered).
  const RETRY_STATUSES = new Set([502, 503, 504]);
  const MAX_RETRIES = 2;
  let lastErrorMsg = '';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(TIMEOUT),
    });

    if (res.ok) return res.json();

    if (RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
      const baseDelay = 800 * Math.pow(3, attempt); // 800, 2400
      const jitter = baseDelay * (0.7 + Math.random() * 0.6); // ±30%
      await new Promise((r) => setTimeout(r, jitter));
      continue;
    }

    const body = await res.json().catch(() => ({ error: res.statusText }));
    lastErrorMsg = body.error || `API error ${res.status}`;
    // 404 = station not yet in DB (new station, no accumulated data)
    // 500 = DB query failed (station exists but query error)
    // Both are non-critical for user — show friendly message
    if (res.status === 404) throw new Error('Sin datos históricos para esta estación');
    if (res.status === 500) throw new Error('Error temporal del servidor de datos');
    throw new Error(lastErrorMsg);
  }

  throw new Error(lastErrorMsg || 'API: reintentos agotados');
}

// ── API Functions ──────────────────────────────────────

/** Health check — DB status and row counts */
export async function fetchHealth(): Promise<HealthInfo> {
  return fetchJson<HealthInfo>(`${BASE}/health`);
}

/** List all stations with last reading time and count */
export async function fetchHistoryStations(): Promise<HistoryStation[]> {
  const data = await fetchJson<{ count: number; stations: HistoryStation[] }>(
    `${BASE}/stations`
  );
  return data.stations;
}

/**
 * Get time series for a station.
 * @param stationId  - e.g. "aemet_1387"
 * @param from       - ISO date string (default: 24h ago)
 * @param to         - ISO date string (default: now)
 * @param interval   - "raw" (5-min) or "hourly" (aggregated)
 */
export async function fetchReadings(
  stationId: string,
  from?: string,
  to?: string,
  interval: 'raw' | 'hourly' = 'raw'
): Promise<HistoryReading[] | HourlyReading[]> {
  const data = await fetchJson<{ readings: HistoryReading[] | HourlyReading[] }>(
    `${BASE}/readings`,
    {
      station_id: stationId,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      interval,
    }
  );
  return data.readings;
}

/**
 * Circuit-breaker: when a source's `/readings/latest` endpoint is failing
 * (5xx after retries), block re-attempts for SOURCE_COOLDOWN_MS to stop
 * the browser from auto-logging another wave of 503s on the next poll.
 * Cleared when a request succeeds.
 */
const sourceCooldownUntil = new Map<string, number>();
const SOURCE_COOLDOWN_MS = 5 * 60 * 1000; // 5 min

/** Get latest reading for all stations (or a specific one), optionally filtered by source */
export async function fetchLatestReadings(
  stationId?: string,
  source?: string
): Promise<HistoryReading[]> {
  const cooldownKey = source ?? '__all__';
  const cooldownUntil = sourceCooldownUntil.get(cooldownKey);
  if (cooldownUntil != null && Date.now() < cooldownUntil) {
    // Skip silently — recent failure, give the server a break.
    return [];
  }

  const params: Record<string, string> = {};
  if (stationId) params.station_id = stationId;
  if (source) params.source = source;
  try {
    const data = await fetchJson<{ readings: HistoryReading[] }>(
      `${BASE}/readings/latest`,
      Object.keys(params).length > 0 ? params : {}
    );
    sourceCooldownUntil.delete(cooldownKey); // success — clear cooldown
    return data.readings;
  } catch (err) {
    // After fetchJson exhausts its 502/503/504 retries we land here.
    // Trip the breaker so the next poll skips this source quickly.
    sourceCooldownUntil.set(cooldownKey, Date.now() + SOURCE_COOLDOWN_MS);
    throw err;
  }
}

/** Convert DB HistoryReading → NormalizedReading (for consolidated source fetches) */
export function historyToNormalized(rows: HistoryReading[]): import('../types/station').NormalizedReading[] {
  return rows.map((r) => ({
    stationId: r.station_id,
    timestamp: new Date(r.time),
    windSpeed: r.wind_speed,
    windGust: r.wind_gust,
    windDirection: r.wind_dir,
    temperature: r.temperature,
    humidity: r.humidity,
    precipitation: r.precip,
    solarRadiation: r.solar_rad,
    pressure: r.pressure,
    dewPoint: r.dew_point,
  }));
}

/**
 * Compare multiple stations side by side.
 * @param stationIds - Array of station IDs (max 10)
 * @param interval   - "raw" or "hourly"
 */
export async function fetchCompare(
  stationIds: string[],
  from?: string,
  to?: string,
  interval: 'raw' | 'hourly' = 'raw'
): Promise<HistoryReading[] | HourlyReading[]> {
  const data = await fetchJson<{ readings: HistoryReading[] | HourlyReading[] }>(
    `${BASE}/readings/compare`,
    {
      station_ids: stationIds.join(','),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      interval,
    }
  );
  return data.readings;
}

// ── Buoy History ──────────────────────────────────────

export interface BuoyStation {
  station_id: number;
  station_name: string;
  source: string;
  last_reading: string;
  reading_count: number;
}

export interface BuoyHistoryReading {
  time: string;
  station_id: number;
  station_name: string;
  source: string;
  wave_height: number | null;
  wave_height_max: number | null;
  wave_period: number | null;
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

/** List all buoy stations with reading counts */
export async function fetchBuoyStations(): Promise<BuoyStation[]> {
  const data = await fetchJson<{ count: number; stations: BuoyStation[] }>(
    `${BASE}/buoys`
  );
  return data.stations;
}

/** Get buoy readings for a station within a time range */
export async function fetchBuoyReadings(
  stationId: number,
  from?: string,
  to?: string,
): Promise<BuoyHistoryReading[]> {
  const data = await fetchJson<{ readings: BuoyHistoryReading[] }>(
    `${BASE}/buoys/readings`,
    {
      station_id: String(stationId),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    }
  );
  return data.readings;
}

/** Get aggregate statistics for a station over a period */
export async function fetchStationStats(
  stationId: string,
  from?: string,
  to?: string
): Promise<StationStats | null> {
  try {
    const data = await fetchJson<{ stats: StationStats }>(
      `${BASE}/stats`,
      {
        station_id: stationId,
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }
    );
    return data.stats;
  } catch (err) {
    console.debug('[History] stats fetch failed', err);
    return null;
  }
}
