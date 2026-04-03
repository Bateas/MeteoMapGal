/**
 * Open-Meteo Marine API client.
 * Provides wave height, SST, swell data for any coastal coordinate.
 * Free, no API key needed. Used as fallback when buoy data unavailable.
 */

const BASE_URL = 'https://marine-api.open-meteo.com/v1/marine';
const CACHE_TTL_MS = 10 * 60_000; // 10 min cache

export interface MarineData {
  waveHeight: number | null;       // meters
  wavePeriod: number | null;       // seconds
  waveDirection: number | null;    // degrees
  swellHeight: number | null;      // meters
  seaSurfaceTemp: number | null;   // °C
  fetchedAt: number;
}

/** Hourly marine forecast point */
export interface MarineForecastHour {
  time: Date;
  waveHeight: number | null;       // Hm0 (m)
  wavePeriod: number | null;       // Tp (s)
  waveDirection: number | null;    // degrees
  swellHeight: number | null;      // swell Hs (m)
  swellPeriod: number | null;      // swell Tp (s)
  swellDirection: number | null;   // swell dir (degrees)
}

let cache: Map<string, MarineData> = new Map();
let forecastCache: Map<string, { data: MarineForecastHour[]; fetchedAt: number }> = new Map();
const FORECAST_CACHE_TTL = 30 * 60_000; // 30 min — forecast changes slowly

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

export async function fetchMarineData(lat: number, lon: number): Promise<MarineData | null> {
  const key = cacheKey(lat, lon);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached;

  try {
    const params = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      current: 'wave_height,wave_period,wave_direction,swell_wave_height,sea_surface_temperature',
      timezone: 'auto',
    });

    const res = await fetch(`${BASE_URL}?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return cached || null;

    const json = await res.json();
    const c = json.current;
    if (!c) return cached || null;

    const data: MarineData = {
      waveHeight: c.wave_height ?? null,
      wavePeriod: c.wave_period ?? null,
      waveDirection: c.wave_direction ?? null,
      swellHeight: c.swell_wave_height ?? null,
      seaSurfaceTemp: c.sea_surface_temperature ?? null,
      fetchedAt: Date.now(),
    };

    cache.set(key, data);
    return data;
  } catch {
    return cached || null;
  }
}

/**
 * Fetch 24h hourly marine forecast from Open-Meteo Marine API.
 * Returns wave height, period, direction + swell separation for each hour.
 * Cached 30 min (forecast updates slowly).
 */
export async function fetchMarineForecast(lat: number, lon: number): Promise<MarineForecastHour[]> {
  const key = cacheKey(lat, lon);
  const cached = forecastCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < FORECAST_CACHE_TTL) return cached.data;

  try {
    const params = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      hourly: 'wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction',
      forecast_days: '2', // 48h — show 24h from now
      timezone: 'auto',
    });

    const res = await fetch(`${BASE_URL}?${params}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return cached?.data ?? [];

    const json = await res.json();
    const h = json.hourly;
    if (!h?.time?.length) return cached?.data ?? [];

    const now = Date.now();
    const hours: MarineForecastHour[] = [];
    for (let i = 0; i < h.time.length; i++) {
      const t = new Date(h.time[i]);
      // Only next 24h from now
      const dt = t.getTime() - now;
      if (dt < -3_600_000 || dt > 24 * 3_600_000) continue;

      hours.push({
        time: t,
        waveHeight: h.wave_height?.[i] ?? null,
        wavePeriod: h.wave_period?.[i] ?? null,
        waveDirection: h.wave_direction?.[i] ?? null,
        swellHeight: h.swell_wave_height?.[i] ?? null,
        swellPeriod: h.swell_wave_period?.[i] ?? null,
        swellDirection: h.swell_wave_direction?.[i] ?? null,
      });
    }

    forecastCache.set(key, { data: hours, fetchedAt: Date.now() });
    return hours;
  } catch {
    return cached?.data ?? [];
  }
}
