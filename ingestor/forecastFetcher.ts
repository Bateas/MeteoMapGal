/**
 * Open-Meteo forecast fetcher for the ingestor.
 *
 * Fetches hourly forecast for both sectors (Embalse + Rías).
 * Caches for 30 minutes to avoid rate limits.
 * Returns HourlyForecast[] compatible with thermalForecastDetector.
 */

import { log } from './logger.js';
import { getWrfForecast, isMeteoSixConfigured } from './meteoSixFetcher.js';
import type { HourlyForecast } from '../src/types/forecast.js';

export type { HourlyForecast };

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
 * Get forecast for a sector. Tries MeteoSIX WRF 1km first (more accurate
 * for Galicia), falls back to Open-Meteo. Merges CAPE/CIN/visibility/solar
 * from Open-Meteo into WRF data (WRF doesn't provide these).
 */
export async function getForecast(sector: 'embalse' | 'rias'): Promise<HourlyForecast[]> {
  const now = Date.now();
  const cached = cache.get(sector);

  if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
    return cached.data;
  }

  const coords = FORECAST_COORDS.find(c => c.sector === sector);
  if (!coords) return [];

  let data: HourlyForecast[] = [];

  // Try MeteoSIX WRF 1km first (primary — 1km resolution, best for Galicia)
  if (isMeteoSixConfigured()) {
    try {
      data = await getWrfForecast(sector);
    } catch (err) {
      log.warn(`WRF primary failed for ${sector}: ${(err as Error).message}`);
    }
  }

  // Always fetch Open-Meteo for CAPE/CIN/solar/visibility/gusts (WRF lacks these)
  try {
    const omData = await fetchForecast(coords.lat, coords.lon);

    if (data.length > 0 && omData.length > 0) {
      // Merge convection data from Open-Meteo into WRF forecast
      const omMap = new Map(omData.map(h => [h.time.getTime(), h]));
      for (const h of data) {
        const om = omMap.get(h.time.getTime());
        if (om) {
          h.cape = om.cape;
          h.cin = om.cin;
          h.liftedIndex = om.liftedIndex;
          h.solarRadiation = om.solarRadiation;
          h.visibility = om.visibility;
          h.windGusts = om.windGusts;
          h.boundaryLayerHeight = om.boundaryLayerHeight;
          h.precipProbability = om.precipProbability;
        }
      }
      log.info(`Forecast ${sector}: WRF primary + Open-Meteo convection merged`);
    } else if (data.length === 0) {
      // WRF failed or not configured — use Open-Meteo as fallback
      data = omData;
      log.info(`Forecast ${sector}: Open-Meteo fallback, ${data.length} hours`);
    }
  } catch (err) {
    log.warn(`Open-Meteo fallback for ${sector} failed: ${(err as Error).message}`);
    // If both failed, return stale cache
    if (data.length === 0) return cached?.data ?? [];
  }

  if (data.length > 0) {
    cache.set(sector, { data, fetchedAt: now });
  }

  return data;
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

// ── Marine Forecast (surf spots) ──────────────────────

const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';

/** Surf spot coordinates for marine forecast */
const SURF_COORDS = [
  { id: 'surf-patos',     lat: 42.1548, lon: -8.8243 },
  { id: 'surf-lanzada',   lat: 42.448,  lon: -8.876 },
  { id: 'surf-corrubedo', lat: 42.556,  lon: -9.033 },
] as const;

export interface MarineForecastHour {
  time: Date;
  waveHeight: number | null;
  wavePeriod: number | null;
  waveDirection: number | null;
  swellHeight: number | null;
  swellPeriod: number | null;
}

const marineCache = new Map<string, { data: MarineForecastHour[]; fetchedAt: number }>();

async function fetchMarine(lat: number, lon: number): Promise<MarineForecastHour[]> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    hourly: 'wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period',
    forecast_hours: '48',
    timezone: 'Europe/Madrid',
  });

  const res = await fetch(`${MARINE_URL}?${params}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Marine API ${res.status}`);

  const json = await res.json() as {
    hourly: {
      time: string[];
      wave_height: (number | null)[];
      wave_period: (number | null)[];
      wave_direction: (number | null)[];
      swell_wave_height: (number | null)[];
      swell_wave_period: (number | null)[];
    };
  };

  const h = json.hourly;
  if (!h?.time) return [];

  return h.time.map((t, i) => ({
    time: new Date(t),
    waveHeight: h.wave_height?.[i] ?? null,
    wavePeriod: h.wave_period?.[i] ?? null,
    waveDirection: h.wave_direction?.[i] ?? null,
    swellHeight: h.swell_wave_height?.[i] ?? null,
    swellPeriod: h.swell_wave_period?.[i] ?? null,
  }));
}

/**
 * Get marine forecast for a surf spot. Uses 30min cache.
 */
export async function getMarineForecast(spotId: string): Promise<MarineForecastHour[]> {
  const now = Date.now();
  const cached = marineCache.get(spotId);
  if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) return cached.data;

  const coords = SURF_COORDS.find(c => c.id === spotId);
  if (!coords) return [];

  try {
    const data = await fetchMarine(coords.lat, coords.lon);
    marineCache.set(spotId, { data, fetchedAt: now });
    log.info(`Marine forecast ${spotId}: ${data.length} hours`);
    return data;
  } catch (err) {
    log.warn(`Marine ${spotId} failed: ${(err as Error).message}`);
    return cached?.data ?? [];
  }
}

/**
 * Fetch marine forecasts for all surf spots. Sequential with 1s delay.
 */
export async function getAllMarineForecasts(): Promise<Map<string, MarineForecastHour[]>> {
  const result = new Map<string, MarineForecastHour[]>();
  for (const { id } of SURF_COORDS) {
    const data = await getMarineForecast(id);
    result.set(id, data);
    await new Promise(r => setTimeout(r, 1000));
  }
  return result;
}
