import type { NormalizedReading } from '../types/station';
import type { ForecastPoint, DailyContext, MicroZoneId, AtmosphericContext } from '../types/thermal';
import type { MicroZone } from '../types/thermal';

// ── Session cache for Open-Meteo history (avoids redundant fetches) ──
const HISTORY_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const HISTORY_CACHE_PREFIX = 'omHistory_';

function getCachedHistory(key: string): NormalizedReading[] | null {
  try {
    const raw = sessionStorage.getItem(HISTORY_CACHE_PREFIX + key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw) as { ts: number; data: NormalizedReading[] };
    if (Date.now() - ts > HISTORY_CACHE_TTL_MS) {
      sessionStorage.removeItem(HISTORY_CACHE_PREFIX + key);
      return null;
    }
    // Restore Date objects from ISO strings
    return data.map((r) => ({ ...r, timestamp: new Date(r.timestamp) }));
  } catch {
    return null;
  }
}

function setCachedHistory(key: string, data: NormalizedReading[]): void {
  try {
    sessionStorage.setItem(
      HISTORY_CACHE_PREFIX + key,
      JSON.stringify({ ts: Date.now(), data }),
    );
  } catch {
    // sessionStorage full — silently ignore
  }
}

interface OpenMeteoHourlyResponse {
  hourly: {
    time: string[];
    temperature_2m: (number | null)[];
    relative_humidity_2m: (number | null)[];
    wind_speed_10m: (number | null)[];
    wind_direction_10m: (number | null)[];
    cloud_cover?: (number | null)[];
    shortwave_radiation?: (number | null)[];
    cape?: (number | null)[];
  };
  daily?: {
    time: string[];
    temperature_2m_max: (number | null)[];
    temperature_2m_min: (number | null)[];
  };
  current?: {
    cloud_cover?: number | null;
    shortwave_radiation?: number | null;
  };
}

/**
 * Fetch 24h historical hourly data from Open-Meteo for a given location.
 * Open-Meteo is free, no API key, no CORS restrictions.
 * Returns model/reanalysis data (not station observations).
 * Wind speed is requested in m/s to match our internal units.
 */
export async function fetchOpenMeteoHistory(
  lat: number,
  lon: number,
  stationId: string,
  pastHours = 24
): Promise<NormalizedReading[]> {
  // Round coords to 2 decimals (Open-Meteo grid resolution) for cache key
  const cacheKey = `${lat.toFixed(2)}_${lon.toFixed(2)}_${pastHours}h_${stationId}`;
  const cached = getCachedHistory(cacheKey);
  if (cached) return cached;

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m&past_hours=${pastHours}&forecast_hours=0&wind_speed_unit=ms`;

  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[OpenMeteo] Failed for ${stationId}: ${res.status}`);
    return [];
  }

  const data: OpenMeteoHourlyResponse = await res.json();
  const readings: NormalizedReading[] = [];

  for (let i = 0; i < data.hourly.time.length; i++) {
    readings.push({
      stationId,
      timestamp: new Date(data.hourly.time[i] + 'Z'), // UTC
      windSpeed: data.hourly.wind_speed_10m[i],
      windGust: null,
      windDirection: data.hourly.wind_direction_10m[i],
      temperature: data.hourly.temperature_2m[i],
      humidity: data.hourly.relative_humidity_2m[i],
      precipitation: null,
      solarRadiation: null,
    });
  }

  setCachedHistory(cacheKey, readings);
  return readings;
}

/**
 * Fetch 24h history for multiple stations in parallel.
 * Uses station coordinates to query Open-Meteo grid data.
 */
export async function fetchOpenMeteoForStations(
  stations: { id: string; lat: number; lon: number }[],
  pastHours = 24
): Promise<NormalizedReading[]> {
  const results = await Promise.allSettled(
    stations.map((s) => fetchOpenMeteoHistory(s.lat, s.lon, s.id, pastHours))
  );

  const allReadings: NormalizedReading[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allReadings.push(...result.value);
    }
  }

  console.log(`[OpenMeteo] Loaded ${allReadings.length} historical readings for ${stations.length} stations`);
  return allReadings;
}

// ── Forecast functions ─────────────────────────────────

/**
 * Fetch hourly forecast from Open-Meteo for a location.
 * Includes enhanced parameters: cloud cover, solar radiation, CAPE.
 * These are FREE from Open-Meteo, no API key needed.
 */
export async function fetchOpenMeteoForecast(
  lat: number,
  lon: number,
  forecastHours = 12
): Promise<ForecastPoint[]> {
  const hourlyParams = [
    'temperature_2m', 'relative_humidity_2m',
    'wind_speed_10m', 'wind_direction_10m',
    'cloud_cover', 'shortwave_radiation', 'cape',
  ].join(',');

  const url = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=${hourlyParams}` +
    `&forecast_hours=${forecastHours}&past_hours=0` +
    `&wind_speed_unit=ms` +
    `&timezone=Europe%2FMadrid`;

  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`[OpenMeteo Forecast] Failed: ${res.status}`);
    return [];
  }

  const data: OpenMeteoHourlyResponse = await res.json();
  const points: ForecastPoint[] = [];

  for (let i = 0; i < data.hourly.time.length; i++) {
    points.push({
      timestamp: new Date(data.hourly.time[i]),
      temperature: data.hourly.temperature_2m[i],
      humidity: data.hourly.relative_humidity_2m[i],
      windSpeed: data.hourly.wind_speed_10m[i],
      windDirection: data.hourly.wind_direction_10m[i],
      cloudCover: data.hourly.cloud_cover?.[i] ?? null,
      solarRadiation: data.hourly.shortwave_radiation?.[i] ?? null,
      cape: data.hourly.cape?.[i] ?? null,
    });
  }

  return points;
}

/**
 * Fetch forecast data for all micro-zones in parallel.
 * Uses zone center coordinates.
 */
export async function fetchForecastForZones(
  zones: MicroZone[],
  forecastHours = 12
): Promise<Map<MicroZoneId, ForecastPoint[]>> {
  const results = new Map<MicroZoneId, ForecastPoint[]>();

  const settled = await Promise.allSettled(
    zones.map(async (zone) => {
      const data = await fetchOpenMeteoForecast(
        zone.center.lat, zone.center.lon, forecastHours
      );
      return { id: zone.id, data };
    })
  );

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      results.set(result.value.id, result.value.data);
    }
  }

  console.log(`[OpenMeteo Forecast] Loaded forecasts for ${results.size}/${zones.length} zones`);
  return results;
}

// ── Daily context (ΔT) ───────────────────────────────

/**
 * Fetch today's daily Tmin/Tmax from Open-Meteo for ΔT scoring.
 * AEMET analysis shows ΔT > 20°C → 42% thermal probability.
 */
export async function fetchDailyContext(
  lat: number,
  lon: number
): Promise<DailyContext> {
  const url = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,temperature_2m_min` +
    `&forecast_days=1` +
    `&timezone=Europe%2FMadrid`;

  try {
    const res = await fetch(url);
    if (!res.ok) return { tempMax: null, tempMin: null, deltaT: null };

    const data: OpenMeteoHourlyResponse = await res.json();
    if (!data.daily || data.daily.time.length === 0) {
      return { tempMax: null, tempMin: null, deltaT: null };
    }

    const tempMax = data.daily.temperature_2m_max[0];
    const tempMin = data.daily.temperature_2m_min[0];
    const deltaT = tempMax !== null && tempMin !== null ? tempMax - tempMin : null;

    return { tempMax, tempMin, deltaT };
  } catch {
    return { tempMax: null, tempMin: null, deltaT: null };
  }
}

/**
 * Fetch daily context for the embalse zone (primary sailing location).
 */
export async function fetchDailyContextForEmbalse(): Promise<DailyContext> {
  return fetchDailyContext(42.295, -8.115);
}

// ── Atmospheric context (cloud, radiation, CAPE) ──────────

/**
 * Fetch current atmospheric context from Open-Meteo.
 * Provides cloud cover, solar radiation, and CAPE for thermal prediction.
 * CAPE > 500 J/kg indicates moderate convection potential.
 * CAPE > 1000 J/kg indicates strong convection potential.
 */
export async function fetchAtmosphericContext(
  lat: number,
  lon: number
): Promise<AtmosphericContext> {
  // Fetch current hour + next 2 hours for immediate context
  const url = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=cloud_cover,shortwave_radiation,cape` +
    `&forecast_hours=1&past_hours=0` +
    `&timezone=Europe%2FMadrid`;

  try {
    const res = await fetch(url);
    if (!res.ok) return { cloudCover: null, solarRadiation: null, cape: null, fetchedAt: new Date() };

    const data: OpenMeteoHourlyResponse = await res.json();
    if (!data.hourly || data.hourly.time.length === 0) {
      return { cloudCover: null, solarRadiation: null, cape: null, fetchedAt: new Date() };
    }

    return {
      cloudCover: data.hourly.cloud_cover?.[0] ?? null,
      solarRadiation: data.hourly.shortwave_radiation?.[0] ?? null,
      cape: data.hourly.cape?.[0] ?? null,
      fetchedAt: new Date(),
    };
  } catch {
    return { cloudCover: null, solarRadiation: null, cape: null, fetchedAt: new Date() };
  }
}

/**
 * Fetch atmospheric context for the embalse zone.
 */
export async function fetchAtmosphericContextForEmbalse(): Promise<AtmosphericContext> {
  return fetchAtmosphericContext(42.295, -8.115);
}
