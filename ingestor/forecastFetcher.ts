/**
 * Open-Meteo forecast fetcher for the ingestor.
 *
 * Fetches hourly forecast for both sectors (Embalse + Rías).
 * Caches for 30 minutes to avoid rate limits.
 * Returns HourlyForecast[] compatible with thermalForecastDetector.
 */

import { log } from './logger.js';

// ── Types (mirror frontend HourlyForecast) ──────────

export interface HourlyForecast {
  time: Date;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;    // m/s
  windDirection: number | null;
  windGusts: number | null;    // m/s
  cloudCover: number | null;   // %
  precipitation: number | null; // mm
  precipProbability: number | null; // %
  pressure: number | null;     // hPa
  solarRadiation: number | null; // W/m²
  cape: number | null;         // J/kg
  boundaryLayerHeight: number | null; // m
  visibility: number | null;   // m
  isDay: boolean;
}

// ── Config ──────────────────────────────────────────

const FORECAST_COORDS = [
  { sector: 'embalse', lat: 42.29, lon: -8.1 },
  { sector: 'rias', lat: 42.307, lon: -8.619 },
] as const;

const CACHE_TTL_MS = 30 * 60_000; // 30 minutes
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

// ── Cache ───────────────────────────────────────────

interface CacheEntry {
  data: HourlyForecast[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

// ── Fetch ───────────────────────────────────────────

async function fetchForecast(lat: number, lon: number): Promise<HourlyForecast[]> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    hourly: [
      'temperature_2m', 'relative_humidity_2m',
      'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
      'precipitation', 'precipitation_probability',
      'cloud_cover', 'surface_pressure',
      'shortwave_radiation', 'cape', 'boundary_layer_height', 'is_day', 'visibility',
    ].join(','),
    past_hours: '6',
    forecast_hours: '48',
    wind_speed_unit: 'ms',
    timezone: 'Europe/Madrid',
  });

  const res = await fetch(`${OPEN_METEO_URL}?${params}`, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Open-Meteo ${res.status}: ${res.statusText}`);
  }

  const json = await res.json() as {
    hourly: {
      time: string[];
      temperature_2m: (number | null)[];
      relative_humidity_2m: (number | null)[];
      wind_speed_10m: (number | null)[];
      wind_direction_10m: (number | null)[];
      wind_gusts_10m: (number | null)[];
      cloud_cover: (number | null)[];
      precipitation: (number | null)[];
      precipitation_probability: (number | null)[];
      surface_pressure: (number | null)[];
      shortwave_radiation: (number | null)[];
      cape: (number | null)[];
      boundary_layer_height: (number | null)[];
      is_day: (number | null)[];
      visibility: (number | null)[];
    };
  };

  const h = json.hourly;
  if (!h || !h.time) return [];

  return h.time.map((t, i) => ({
    time: new Date(t),
    temperature: h.temperature_2m?.[i] ?? null,
    humidity: h.relative_humidity_2m?.[i] ?? null,
    windSpeed: h.wind_speed_10m?.[i] ?? null, // already m/s with wind_speed_unit=ms
    windDirection: h.wind_direction_10m?.[i] ?? null,
    windGusts: h.wind_gusts_10m?.[i] ?? null, // already m/s
    cloudCover: h.cloud_cover?.[i] ?? null,
    precipitation: h.precipitation?.[i] ?? null,
    precipProbability: h.precipitation_probability?.[i] ?? null,
    pressure: h.surface_pressure?.[i] ?? null,
    solarRadiation: h.shortwave_radiation?.[i] ?? null,
    cape: h.cape?.[i] ?? null,
    boundaryLayerHeight: h.boundary_layer_height?.[i] ?? null,
    visibility: h.visibility?.[i] ?? null,
    isDay: h.is_day?.[i] === 1,
  }));
}

// ── Public API ──────────────────────────────────────

/**
 * Get forecast for a sector. Uses 30min cache.
 */
export async function getForecast(sector: 'embalse' | 'rias'): Promise<HourlyForecast[]> {
  const now = Date.now();
  const cached = cache.get(sector);

  if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
    return cached.data;
  }

  const coords = FORECAST_COORDS.find(c => c.sector === sector);
  if (!coords) return [];

  try {
    const data = await fetchForecast(coords.lat, coords.lon);
    cache.set(sector, { data, fetchedAt: now });
    log.info(`Forecast ${sector}: ${data.length} hours fetched`);
    return data;
  } catch (err) {
    log.warn(`Forecast ${sector} failed: ${(err as Error).message}`);
    // Return stale cache if available
    return cached?.data ?? [];
  }
}

/**
 * Get forecast for ALL sectors. Sequential to respect rate limits.
 */
export async function getAllForecasts(): Promise<Map<string, HourlyForecast[]>> {
  const result = new Map<string, HourlyForecast[]>();

  for (const { sector } of FORECAST_COORDS) {
    const data = await getForecast(sector);
    result.set(sector, data);
    // 1s delay between requests to be polite
    await new Promise(r => setTimeout(r, 1000));
  }

  return result;
}
