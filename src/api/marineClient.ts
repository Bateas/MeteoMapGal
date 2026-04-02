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

let cache: Map<string, MarineData> = new Map();

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
