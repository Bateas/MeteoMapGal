/**
 * Aviation aircraft tracking via OpenSky Network REST API.
 * Polls Embalse de Castrelo bounding box for aircraft.
 * Anonymous: 400 credits/day. Each request = ~4 credits.
 */
import type { Aircraft } from '../types/aviation';
import { AVIATION_DISPLAY_BBOX, EMBALSE_CENTER } from '../types/aviation';
import { haversineDistance } from '../services/geoUtils';

const BASE_URL = '/opensky-api/states/all';
const CACHE_TTL_MS = 30_000; // 30s cache — prevent rapid network hits

let cache: { data: Aircraft[]; fetchedAt: number } | null = null;
let creditsUsedToday = 0;
let creditResetDate = new Date().toDateString();

function resetCreditsIfNewDay() {
  const today = new Date().toDateString();
  if (today !== creditResetDate) {
    creditsUsedToday = 0;
    creditResetDate = today;
  }
}

export function getCreditsUsed(): number {
  resetCreditsIfNewDay();
  return creditsUsedToday;
}

export async function fetchAircraft(): Promise<Aircraft[]> {
  // Return cached data if fresh
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }

  // Rate limit guard: 400 credits/day, ~4 credits per request
  resetCreditsIfNewDay();
  if (creditsUsedToday >= 350) {
    console.warn('[Aviation] Credit limit approaching, returning cached data');
    return cache?.data ?? [];
  }

  const params = new URLSearchParams({
    lamin: String(AVIATION_DISPLAY_BBOX.lamin),
    lomin: String(AVIATION_DISPLAY_BBOX.lomin),
    lamax: String(AVIATION_DISPLAY_BBOX.lamax),
    lomax: String(AVIATION_DISPLAY_BBOX.lomax),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`${BASE_URL}?${params}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    creditsUsedToday += 4;

    if (!res.ok) {
      if (res.status === 429) {
        console.warn('[Aviation] Rate limited by OpenSky');
        return cache?.data ?? [];
      }
      throw new Error(`OpenSky ${res.status}`);
    }

    const json = await res.json();
    const states: any[][] = json.states || [];

    const aircraft: Aircraft[] = states
      .filter((s) => s[6] != null && s[5] != null && !s[8]) // has lat/lon, not on ground
      .map((s) => {
        const lat = s[6] as number;
        const lon = s[5] as number;
        return {
          icao24: s[0] as string,
          callsign: (s[1] as string)?.trim() || s[0],
          lat,
          lon,
          altitude: (s[7] as number) ?? (s[13] as number) ?? 0, // baro_altitude || geo_altitude
          velocity: (s[9] as number) ?? 0,
          verticalRate: (s[11] as number) ?? 0,
          heading: (s[10] as number) ?? 0,
          onGround: s[8] as boolean,
          distanceKm: haversineDistance(
            EMBALSE_CENTER.lat, EMBALSE_CENTER.lon,
            lat, lon,
          ),
          lastUpdate: Date.now(),
        };
      });

    cache = { data: aircraft, fetchedAt: Date.now() };
    return aircraft;
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === 'AbortError') {
      console.warn('[Aviation] Request timeout');
    }
    return cache?.data ?? [];
  }
}
