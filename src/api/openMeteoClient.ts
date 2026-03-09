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
    boundary_layer_height?: (number | null)[];
    lifted_index?: (number | null)[];
    convective_inhibition?: (number | null)[];
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
  // Cache by grid cell (2 decimal ≈ 1.1km resolution) — stationId excluded so
  // stations in the same grid cell share one API call via the grid-level cache.
  const gridKey = `${lat.toFixed(2)}_${lon.toFixed(2)}_${pastHours}h`;
  const cached = getCachedHistory(gridKey);
  if (cached) {
    // Re-stamp readings with the requesting stationId
    return cached.map((r) => ({ ...r, stationId }));
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m&past_hours=${pastHours}&forecast_hours=0&wind_speed_unit=ms`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    console.warn(`[OpenMeteo] Failed for ${stationId}: ${res.status}`);
    return [];
  }

  const data: OpenMeteoHourlyResponse = await res.json();
  const readings: NormalizedReading[] = [];

  for (let i = 0; i < data.hourly.time.length; i++) {
    readings.push({
      stationId: '__grid__',  // placeholder — caller re-stamps with actual stationId
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

  setCachedHistory(gridKey, readings);
  // Return with the requesting stationId
  return readings.map((r) => ({ ...r, stationId }));
}

/**
 * Fetch 24h history for multiple stations, de-duplicated by Open-Meteo grid cell.
 *
 * Open-Meteo has ~0.01° resolution. Stations within the same grid cell (lat/lon
 * rounded to 2 decimals) share identical model data, so we fetch each unique cell
 * only once and distribute the readings to all stations in that cell.
 *
 * Additionally, requests are batched (max 8 concurrent) to avoid 429 rate-limiting.
 * Open-Meteo free tier allows ~60 requests/minute.
 */
export async function fetchOpenMeteoForStations(
  stations: { id: string; lat: number; lon: number }[],
  pastHours = 24
): Promise<NormalizedReading[]> {
  // Group stations by grid cell (2 decimal places ≈ 1.1km)
  const gridMap = new Map<string, { lat: number; lon: number; stationIds: string[] }>();
  for (const s of stations) {
    const key = `${s.lat.toFixed(2)}_${s.lon.toFixed(2)}`;
    const existing = gridMap.get(key);
    if (existing) {
      existing.stationIds.push(s.id);
    } else {
      gridMap.set(key, { lat: s.lat, lon: s.lon, stationIds: [s.id] });
    }
  }

  const uniqueCells = Array.from(gridMap.values());
  const allReadings: NormalizedReading[] = [];
  const BATCH_SIZE = 8;

  // Fetch in batches to respect rate limits
  for (let i = 0; i < uniqueCells.length; i += BATCH_SIZE) {
    const batch = uniqueCells.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((cell) =>
        fetchOpenMeteoHistory(cell.lat, cell.lon, cell.stationIds[0], pastHours)
      )
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status !== 'fulfilled' || result.value.length === 0) continue;
      const cell = batch[j];
      // Distribute readings to all stations in this grid cell
      for (const sid of cell.stationIds) {
        allReadings.push(...result.value.map((r) => ({ ...r, stationId: sid })));
      }
    }

    // Small delay between batches to avoid bursts
    if (i + BATCH_SIZE < uniqueCells.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  console.debug(
    `[OpenMeteo] Loaded ${allReadings.length} readings — ${uniqueCells.length} grid cells for ${stations.length} stations`
  );
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
    'boundary_layer_height', 'lifted_index', 'convective_inhibition',
  ].join(',');

  const url = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=${hourlyParams}` +
    `&forecast_hours=${forecastHours}&past_hours=0` +
    `&wind_speed_unit=ms` +
    `&timezone=Europe%2FMadrid`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
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
      boundaryLayerHeight: data.hourly.boundary_layer_height?.[i] ?? null,
      liftedIndex: data.hourly.lifted_index?.[i] ?? null,
      convectiveInhibition: data.hourly.convective_inhibition?.[i] ?? null,
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

  console.debug(`[OpenMeteo Forecast] Loaded forecasts for ${results.size}/${zones.length} zones`);
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
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
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
 * Provides cloud cover, solar radiation, CAPE, PBL height, lifted index, CIN
 * for thermal prediction.
 *
 * Key thresholds:
 * - CAPE > 500 J/kg = moderate convection, > 1000 = strong
 * - PBL > 1500m = deep mixing layer, excellent thermals
 * - Lifted Index < -2 = unstable, < -6 = strongly unstable
 * - CIN < 50 J/kg = low inhibition, thermals develop freely
 */
export async function fetchAtmosphericContext(
  lat: number,
  lon: number
): Promise<AtmosphericContext> {
  const hourlyParams = [
    'cloud_cover', 'shortwave_radiation', 'cape',
    'boundary_layer_height', 'lifted_index', 'convective_inhibition',
  ].join(',');

  const url = `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=${hourlyParams}` +
    `&forecast_hours=1&past_hours=0` +
    `&timezone=Europe%2FMadrid`;

  const nullContext: AtmosphericContext = {
    cloudCover: null, solarRadiation: null, cape: null,
    boundaryLayerHeight: null, liftedIndex: null, convectiveInhibition: null,
    fetchedAt: new Date(),
  };

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return nullContext;

    const data: OpenMeteoHourlyResponse = await res.json();
    if (!data.hourly || data.hourly.time.length === 0) {
      return nullContext;
    }

    return {
      cloudCover: data.hourly.cloud_cover?.[0] ?? null,
      solarRadiation: data.hourly.shortwave_radiation?.[0] ?? null,
      cape: data.hourly.cape?.[0] ?? null,
      boundaryLayerHeight: data.hourly.boundary_layer_height?.[0] ?? null,
      liftedIndex: data.hourly.lifted_index?.[0] ?? null,
      convectiveInhibition: data.hourly.convective_inhibition?.[0] ?? null,
      fetchedAt: new Date(),
    };
  } catch {
    return nullContext;
  }
}

/**
 * Fetch atmospheric context for the embalse zone.
 */
export async function fetchAtmosphericContextForEmbalse(): Promise<AtmosphericContext> {
  return fetchAtmosphericContext(42.295, -8.115);
}
