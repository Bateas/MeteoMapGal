/**
 * Netatmo public weathermap client.
 *
 * Uses the public weathermap token (no OAuth or API key needed).
 * Wind speed from Netatmo is in km/h → convert to m/s.
 * Station IDs use MAC addresses.
 */

import type { NormalizedStation, NormalizedReading } from '../types/station';
import { MAP_CENTER, DISCOVERY_RADIUS_KM } from '../config/constants';
import { isWithinRadius } from '../services/geoUtils';

const DATA_URL = '/netatmo-api/api/getpublicdata';

/** Build a bounding box from center + radius. ~0.009 lat/deg ≈ 1km at 42°N */
function buildBbox(center: [number, number], radiusKm: number) {
  const latDelta = (radiusKm / 111) * 1.1;  // 1° lat ≈ 111km, 10% margin
  const lonDelta = (radiusKm / 82) * 1.1;   // 1° lon ≈ 82km at 42°N
  return {
    lat_ne: center[1] + latDelta,
    lat_sw: center[1] - latDelta,
    lon_ne: center[0] + lonDelta,
    lon_sw: center[0] - lonDelta,
  };
}

/** Default BBOX for observation fetches (uses legacy MAP_CENTER) */
const DEFAULT_BBOX = buildBbox(MAP_CENTER, DISCOVERY_RADIUS_KM);

// ── Helpers ──────────────────────────────────────────────

/** Convert km/h to m/s */
function kmhToMs(kmh: number): number {
  return kmh / 3.6;
}

/** Short station ID from MAC address: last 4 hex chars */
function shortMac(mac: string): string {
  return mac.replace(/:/g, '').slice(-6).toUpperCase();
}

// ── Token management ─────────────────────────────────────

let cachedToken: string | null = null;
let tokenFetchedAt = 0;
let tokenPromise: Promise<string> | null = null;
const TOKEN_TTL_MS = 60 * 60 * 1000; // Refresh token every hour

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() - tokenFetchedAt < TOKEN_TTL_MS) {
    return cachedToken;
  }

  // Deduplicate concurrent token requests
  if (tokenPromise) return tokenPromise;

  tokenPromise = fetchTokenInternal().finally(() => {
    tokenPromise = null;
  });
  return tokenPromise;
}

async function fetchTokenInternal(): Promise<string> {
  // Token endpoint is at auth.netatmo.com (proxied via /netatmo-auth)
  try {
    const res = await fetch('/netatmo-auth/weathermap/token');
    if (res.ok) {
      const data = await res.json();
      cachedToken = data.body;
      tokenFetchedAt = Date.now();
      console.log('[Netatmo] Token obtained via proxy');
      return cachedToken!;
    }
    console.warn(`[Netatmo] Proxy token failed: ${res.status}`);
  } catch (e) {
    console.warn('[Netatmo] Proxy token error:', e);
  }

  // Fallback: direct URL (may have CORS issues)
  try {
    const res = await fetch('https://auth.netatmo.com/weathermap/token');
    if (res.ok) {
      const data = await res.json();
      cachedToken = data.body;
      tokenFetchedAt = Date.now();
      console.log('[Netatmo] Token obtained via direct URL');
      return cachedToken!;
    }
    console.warn(`[Netatmo] Direct token failed: ${res.status}`);
  } catch (e) {
    console.warn('[Netatmo] Direct token error:', e);
  }

  throw new Error('Could not obtain Netatmo weathermap token');
}

// ── Raw types ────────────────────────────────────────────

interface NetatmoRawStation {
  _id: string;  // MAC address
  place: {
    location: [number, number]; // [lon, lat]
    timezone: string;
    country: string;
    altitude: number;
    city: string;
    street?: string;
  };
  mark: number;
  measures: Record<string, NetatmoMeasure>;
  modules: string[];
  module_types: Record<string, string>;
}

interface NetatmoMeasure {
  // Temperature/humidity/pressure (time-keyed)
  res?: Record<string, number[]>;
  type?: string[];
  // Wind (flat fields)
  wind_strength?: number;     // km/h
  wind_angle?: number;        // degrees (-1 = calm)
  gust_strength?: number;     // km/h
  gust_angle?: number;
  wind_timeutc?: number;
  // Rain (flat fields)
  rain_60min?: number;        // mm
  rain_24h?: number;
  rain_live?: number;
  rain_timeutc?: number;
}

// ── Station discovery ────────────────────────────────────

/**
 * Discover Netatmo public stations near the map center.
 * Returns stations with at least temperature data.
 * Optionally filters to only wind-equipped stations.
 */
export async function fetchNetatmoStations(
  center: [number, number] = MAP_CENTER,
  radiusKm: number = DISCOVERY_RADIUS_KM,
  requireWind = false,
): Promise<NormalizedStation[]> {
  const [centerLon, centerLat] = center;
  const bbox = buildBbox(center, radiusKm);
  const token = await getToken();

  const body = {
    lat_ne: bbox.lat_ne,
    lat_sw: bbox.lat_sw,
    lon_ne: bbox.lon_ne,
    lon_sw: bbox.lon_sw,
    required_data: requireWind ? 'wind' : 'temperature',
    filter: false,
  };

  const res = await fetch(DATA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.warn(`[Netatmo] Station fetch failed: ${res.status}`);
    return [];
  }

  const data = await res.json();
  const rawStations: NetatmoRawStation[] = data?.body ?? [];
  const stations: NormalizedStation[] = [];

  for (const raw of rawStations) {
    const [lon, lat] = raw.place.location;
    if (!isWithinRadius(centerLat, centerLon, lat, lon, radiusKm)) {
      continue;
    }

    // Check if this station has a wind module
    const hasWind = Object.values(raw.module_types || {}).includes('NAModule2');
    if (requireWind && !hasWind) continue;

    const cityName = raw.place.city || 'Desconocida';

    stations.push({
      id: `netatmo_${shortMac(raw._id)}`,
      source: 'netatmo',
      name: cityName,
      lat,
      lon,
      altitude: raw.place.altitude || 0,
      municipality: raw.place.city,
      tempOnly: !hasWind,
    });
  }

  console.log(`[Netatmo] Found ${stations.length} stations in radius (${requireWind ? 'wind only' : 'all'})`);
  return stations;
}

// ── Current observations ─────────────────────────────────

/**
 * Fetch current observations from all Netatmo stations in the area.
 * Returns readings for stations with wind data.
 * Stations without wind still contribute temperature/humidity.
 */
export async function fetchNetatmoObservations(): Promise<{
  stations: NormalizedStation[];
  readings: NormalizedReading[];
}> {
  const [centerLon, centerLat] = MAP_CENTER;
  const token = await getToken();

  // Fetch all stations (not just wind) to get temp/humidity too
  const body = {
    lat_ne: DEFAULT_BBOX.lat_ne,
    lat_sw: DEFAULT_BBOX.lat_sw,
    lon_ne: DEFAULT_BBOX.lon_ne,
    lon_sw: DEFAULT_BBOX.lon_sw,
    required_data: 'temperature',
    filter: false,
  };

  const res = await fetch(DATA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.warn(`[Netatmo] Observation fetch failed: ${res.status}`);
    return { stations: [], readings: [] };
  }

  const data = await res.json();
  const rawStations: NetatmoRawStation[] = data?.body ?? [];
  const stations: NormalizedStation[] = [];
  const readings: NormalizedReading[] = [];

  for (const raw of rawStations) {
    const [lon, lat] = raw.place.location;
    if (!isWithinRadius(centerLat, centerLon, lat, lon, DISCOVERY_RADIUS_KM)) {
      continue;
    }

    const stationId = `netatmo_${shortMac(raw._id)}`;
    const hasWind = Object.values(raw.module_types || {}).includes('NAModule2');
    const cityName = raw.place.city || 'Desconocida';

    stations.push({
      id: stationId,
      source: 'netatmo',
      name: cityName,
      lat,
      lon,
      altitude: raw.place.altitude || 0,
      municipality: raw.place.city,
      tempOnly: !hasWind,
    });

    // Extract readings from measures
    let temperature: number | null = null;
    let humidity: number | null = null;
    let windSpeed: number | null = null;
    let windGust: number | null = null;
    let windDirection: number | null = null;
    let precipitation: number | null = null;
    let timestamp = new Date();

    for (const measure of Object.values(raw.measures)) {
      // Temperature/humidity (time-keyed data)
      if (measure.res && measure.type) {
        const entries = Object.entries(measure.res);
        if (entries.length > 0) {
          const [ts, values] = entries[0];
          timestamp = new Date(parseInt(ts, 10) * 1000);

          const tempIdx = measure.type.indexOf('temperature');
          const humIdx = measure.type.indexOf('humidity');
          const pressIdx = measure.type.indexOf('pressure');

          if (tempIdx !== -1) temperature = values[tempIdx] ?? null;
          if (humIdx !== -1) humidity = values[humIdx] ?? null;
          // Pressure available but not in our NormalizedReading
          void pressIdx;
        }
      }

      // Wind data (flat fields)
      if (measure.wind_strength !== undefined) {
        windSpeed = kmhToMs(measure.wind_strength);
        windGust = measure.gust_strength !== undefined ? kmhToMs(measure.gust_strength) : null;
        windDirection = measure.wind_angle === -1 ? null : (measure.wind_angle ?? null);
        if (measure.wind_timeutc) {
          timestamp = new Date(measure.wind_timeutc * 1000);
        }
      }

      // Rain data (flat fields)
      if (measure.rain_60min !== undefined) {
        precipitation = measure.rain_60min;
      }
    }

    readings.push({
      stationId,
      timestamp,
      windSpeed,
      windGust,
      windDirection,
      temperature,
      humidity,
      precipitation,
    });
  }

  return { stations, readings };
}
