/**
 * MeteoSIX WRF 1km forecast fetcher for ingestor.
 *
 * Server-side equivalent of src/api/meteoSixClient.ts.
 * Calls MeteoGalicia API directly (no proxy needed server-side).
 * Caches for 60 minutes (WRF updates 2x/day).
 *
 * Used by forecastFetcher.ts as primary forecast source,
 * with Open-Meteo as fallback for convection data (CAPE/CIN/LI).
 */

import { log } from './logger.js';
import type { HourlyForecast } from '../src/types/forecast.js';

// ── Config ──────────────────────────────────────────

const METEOSIX_KEY = process.env.METEOSIX_API_KEY || '';
const BASE_URL = 'https://servizos.meteogalicia.gal/apiv5';
const CACHE_TTL_MS = 60 * 60_000; // 60 minutes (WRF updates ~2x/day)

const SECTOR_COORDS = [
  { sector: 'embalse', lat: 42.29, lon: -8.1 },
  { sector: 'rias', lat: 42.307, lon: -8.619 },
] as const;

// ── MeteoSIX response types ──

interface MeteoSIXVariable {
  name: string;
  units: string;
  values: Array<{
    timeInstant: string;
    value: string | number | null;
    moduleValue?: number | string;
    directionValue?: number | string;
  }>;
}

interface MeteoSIXFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    days: Array<{
      timePeriod: { begin: { timeInstant: string }; end: { timeInstant: string } };
      variables: MeteoSIXVariable[];
    }>;
  };
}

interface MeteoSIXResponse {
  type: 'FeatureCollection';
  features: MeteoSIXFeature[];
}

// ── WRF atmospheric variables ──

const ATMO_VARIABLES = [
  'temperature',
  'wind',
  'precipitation_amount',
  'relative_humidity',
  'cloud_area_fraction',
  'air_pressure_at_sea_level',
  'sky_state',
  'snow_level',
].join(',');

const NIGHT_STATES = new Set([
  'CLEAR_NIGHT', 'NIGHT_CLOUDS', 'NIGHT_CLOUDY',
  'NIGHT_RAIN', 'NIGHT_SHOWERS', 'NIGHT_SNOW', 'NIGHT_STORMS',
]);

// ── Helpers ──

function fixTimeOffset(timeStr: string): string {
  return timeStr.replace(/([+-]\d{2})$/, '$1:00');
}

function parseNum(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function kmhToMs(kmh: number | null): number | null {
  return kmh != null ? kmh / 3.6 : null;
}

function isDayFromSkyState(skyState: string | number | null, date: Date): boolean {
  if (typeof skyState === 'string' && NIGHT_STATES.has(skyState)) return false;
  if (typeof skyState === 'string' && !NIGHT_STATES.has(skyState)) return true;
  const h = date.getHours();
  return h >= 7 && h < 21;
}

function parseFeatureToTimeMap(feature: MeteoSIXFeature): Map<string, Record<string, string | number | null>> {
  const timeMap = new Map<string, Record<string, string | number | null>>();
  for (const day of feature.properties.days) {
    for (const variable of day.variables) {
      for (const val of variable.values) {
        const key = val.timeInstant;
        if (!timeMap.has(key)) timeMap.set(key, {});
        const record = timeMap.get(key)!;
        if (variable.name === 'wind') {
          record['wind_speed'] = val.moduleValue ?? null;
          record['wind_direction'] = val.directionValue ?? null;
        } else {
          record[variable.name] = val.value ?? null;
        }
      }
    }
  }
  return timeMap;
}

// ── Cache ──

interface CacheEntry {
  data: HourlyForecast[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

// ── Fetch ──

function buildUrl(lon: number, lat: number): string {
  const count = ATMO_VARIABLES.split(',').length;
  const models = Array(count).fill('WRF').join(',');
  const grids = Array(count).fill('1km').join(',');
  return `${BASE_URL}/getNumericForecastInfo?coords=${lon},${lat}&variables=${ATMO_VARIABLES}&models=${models}&grids=${grids}&lang=es&format=application/json&API_KEY=${METEOSIX_KEY}`;
}

async function fetchWrfForecast(lat: number, lon: number): Promise<HourlyForecast[]> {
  if (!METEOSIX_KEY) {
    log.warn('MeteoSIX: METEOSIX_API_KEY not set — skipping WRF fetch');
    return [];
  }

  const url = buildUrl(lon, lat);
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`MeteoSIX WRF ${res.status}: ${text.slice(0, 200)}`);
  }

  const data: MeteoSIXResponse = await res.json();
  if (!data.features || data.features.length === 0) {
    throw new Error('MeteoSIX: no features in response');
  }

  const timeMap = parseFeatureToTimeMap(data.features[0]);
  const result: HourlyForecast[] = [];

  for (const timeStr of [...timeMap.keys()].sort()) {
    const rec = timeMap.get(timeStr)!;
    const time = new Date(fixTimeOffset(timeStr));
    if (isNaN(time.getTime())) continue;

    const skyState = rec['sky_state'] ?? null;

    result.push({
      time,
      temperature: parseNum(rec['temperature']),
      humidity: parseNum(rec['relative_humidity']),
      windSpeed: kmhToMs(parseNum(rec['wind_speed'])),
      windDirection: parseNum(rec['wind_direction']),
      windGusts: null, // WRF doesn't provide gusts
      precipitation: parseNum(rec['precipitation_amount']),
      precipProbability: null,
      cloudCover: parseNum(rec['cloud_area_fraction']),
      pressure: parseNum(rec['air_pressure_at_sea_level']),
      solarRadiation: null,
      cape: null,
      liftedIndex: null,
      cin: null,
      boundaryLayerHeight: null,
      visibility: null,
      snowLevel: parseNum(rec['snow_level']),
      skyState: typeof skyState === 'string' ? skyState : null,
      isDay: isDayFromSkyState(skyState, time),
    });
  }

  return result;
}

// ── Public API ──

/**
 * Get WRF 1km forecast for a sector. Uses 60min cache.
 * Returns empty array if MeteoSIX key not configured or API fails.
 */
export async function getWrfForecast(sector: 'embalse' | 'rias'): Promise<HourlyForecast[]> {
  const now = Date.now();
  const cached = cache.get(sector);

  if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) {
    return cached.data;
  }

  const coords = SECTOR_COORDS.find(c => c.sector === sector);
  if (!coords) return [];

  try {
    const data = await fetchWrfForecast(coords.lat, coords.lon);
    if (data.length > 0) {
      cache.set(sector, { data, fetchedAt: now });
      log.info(`MeteoSIX WRF ${sector}: ${data.length} hours fetched`);
    }
    return data;
  } catch (err) {
    log.warn(`MeteoSIX WRF ${sector} failed: ${(err as Error).message}`);
    return cached?.data ?? [];
  }
}

/**
 * Check if MeteoSIX API key is configured.
 */
export function isMeteoSixConfigured(): boolean {
  return METEOSIX_KEY.length > 0;
}

// ── USWAN nearshore wave forecast ──

const MARINE_VARIABLES = 'significative_wave_height,mean_wave_direction,relative_peak_period';

export interface UswanHour {
  time: Date;
  waveHeight: number | null;
  wavePeriod: number | null;
  waveDirection: number | null;
}

function buildMarineUrl(lon: number, lat: number): string {
  const count = MARINE_VARIABLES.split(',').length;
  const models = Array(count).fill('USWAN').join(',');
  const grids = Array(count).fill('Galicia').join(',');
  return `${BASE_URL}/getNumericForecastInfo?coords=${lon},${lat}&variables=${MARINE_VARIABLES}&models=${models}&grids=${grids}&lang=es&format=application/json&API_KEY=${METEOSIX_KEY}`;
}

const marineWrfCache = new Map<string, { data: UswanHour[]; fetchedAt: number }>();

/**
 * Fetch USWAN nearshore wave forecast for a spot.
 * Better resolution than Open-Meteo Marine for Galician coast.
 */
export async function getUswanForecast(spotId: string, lat: number, lon: number): Promise<UswanHour[]> {
  if (!METEOSIX_KEY) return [];

  const now = Date.now();
  const cached = marineWrfCache.get(spotId);
  if (cached && (now - cached.fetchedAt) < CACHE_TTL_MS) return cached.data;

  try {
    const url = buildMarineUrl(lon, lat);
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`USWAN ${res.status}`);

    const data: MeteoSIXResponse = await res.json();
    if (!data.features?.length) return [];

    const timeMap = parseFeatureToTimeMap(data.features[0]);
    const result: UswanHour[] = [];

    for (const timeStr of [...timeMap.keys()].sort()) {
      const rec = timeMap.get(timeStr)!;
      const time = new Date(fixTimeOffset(timeStr));
      if (isNaN(time.getTime())) continue;

      result.push({
        time,
        waveHeight: parseNum(rec['significative_wave_height']),
        wavePeriod: parseNum(rec['relative_peak_period']),
        waveDirection: parseNum(rec['mean_wave_direction']),
      });
    }

    if (result.length > 0) {
      marineWrfCache.set(spotId, { data: result, fetchedAt: now });
      log.info(`USWAN ${spotId}: ${result.length} hours fetched`);
    }
    return result;
  } catch (err) {
    log.warn(`USWAN ${spotId} failed: ${(err as Error).message}`);
    return cached?.data ?? [];
  }
}
