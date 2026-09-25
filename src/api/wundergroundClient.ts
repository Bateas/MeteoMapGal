/**
 * Weather Underground Personal Weather Station (PWS) client.
 *
 * Uses the publicly-exposed SUN_API_KEY from wunderground.com.
 * CORS is allowed (Access-Control-Allow-Origin: *), no proxy needed.
 * Wind speed returned in m/s when using units=s.
 */

import type { NormalizedStation, NormalizedReading } from '../types/station';
import { isWithinRadius } from '../services/geoUtils';

// WU public API key — PUBLIC, embedded by IBM in wunderground.com source code.
// Used ONLY for station discovery (location/near). Observations go via ingestor.
// NOT a credential leak: appears verbatim in any wunderground.com page source.
// Removing this fallback BROKE discovery (see commits 9f07f33 → 58ea5ca). Do NOT remove.
const WU_PUBLIC_KEY = 'e1f10a1e78da46f5b10a1e78da96f525';
const API_KEY = import.meta.env.VITE_WU_API_KEY ?? '';
const BASE_URL = 'https://api.weather.com';

// ── Types ────────────────────────────────────────────────

interface WUObservation {
  stationID: string;
  obsTimeUtc: string;
  obsTimeLocal: string;
  neighborhood: string;
  country: string;
  lat: number;
  lon: number;
  winddir: number | null;
  humidity: number | null;
  solarRadiation: number | null;
  uv: number | null;
  metric_si: {
    temp: number | null;
    windSpeed: number | null;     // m/s
    windGust: number | null;      // m/s
    pressure: number | null;      // hPa
    precipRate: number | null;    // mm/h
    precipTotal: number | null;   // mm
    elev: number | null;          // m
    dewpt: number | null;
  };
}

// ── Station discovery ────────────────────────────────────

/**
 * Find PWS stations near the map center using the v3/location/near endpoint.
 * Returns up to 10 nearest stations.
 */
export async function fetchWUNearbyStations(
  center: [number, number] = [-8.1, 42.29],
  radiusKm = 35,
): Promise<NormalizedStation[]> {
  // Discovery uses public key (IBM embeds it in wunderground.com) — NOT a secret
  const [centerLon, centerLat] = center;

  const url = new URL('/v3/location/near', BASE_URL);
  url.searchParams.set('geocode', `${centerLat},${centerLon}`);
  url.searchParams.set('product', 'pws');
  url.searchParams.set('format', 'json');
  url.searchParams.set('apiKey', WU_PUBLIC_KEY);

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      console.warn(`[WU] Near endpoint failed: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const locations = data?.location;
    if (!locations?.stationId) return [];

    const stations: NormalizedStation[] = [];

    for (let i = 0; i < locations.stationId.length; i++) {
      const lat = locations.latitude[i];
      const lon = locations.longitude[i];

      if (!isWithinRadius(centerLat, centerLon, lat, lon, radiusKm)) {
        continue;
      }

      stations.push({
        id: `wu_${locations.stationId[i]}`,
        source: 'wunderground',
        name: locations.stationName[i] || locations.neighborhood?.[i] || locations.stationId[i],
        lat,
        lon,
        altitude: locations.elev?.[i] ?? 0,
        municipality: locations.neighborhood?.[i],
      });
    }

    console.debug(`[WU] Found ${stations.length} PWS stations in radius`);
    return stations;
  } catch (err) {
    // Demoted to debug: WU PWS endpoint occasionally 503s; browser
    // already auto-logs the network failure. Silent fallback to empty list.
    console.debug('[WU] Station discovery error:', err);
    return [];
  }
}

/** How long after our discovery last returned a station it still counts. Discovery runs
 *  hourly; three hours tolerates two missed runs before a station WU stopped listing drops. */
export const WU_LIST_SEEN_MAX_MIN = 180;

interface ListedStation {
  station_id: string;
  source: string;
  name: string | null;
  lat: number;
  lon: number;
  altitude: number | null;
  seen_min_ago: number;
}

/**
 * The PWS list our own server keeps. It asks WU from the same points as the map, every hour,
 * so reading it costs a visitor one request to our API, shared at the edge, instead of one
 * per coverage point to api.weather.com (15 in the Rías) under a key every visitor shares.
 *
 * Null when the list cannot be read or holds nothing current: the caller then asks WU
 * directly, as it always did. The age comes from the server, so a phone with a wrong clock
 * cannot empty the list.
 */
export async function fetchWUStationsFromApi(): Promise<NormalizedStation[] | null> {
  try {
    const res = await fetch('/api/v1/stations/list?source=wunderground', { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { stations?: ListedStation[] };
    if (!Array.isArray(data?.stations)) return null;

    const stations: NormalizedStation[] = [];
    for (const s of data.stations) {
      if (s.source !== 'wunderground' || typeof s.station_id !== 'string' || !s.station_id.startsWith('wu_')) continue;
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon) || !(s.seen_min_ago <= WU_LIST_SEEN_MAX_MIN)) continue;
      stations.push({
        id: s.station_id,
        source: 'wunderground',
        name: s.name || s.station_id.slice(3),
        lat: s.lat,
        lon: s.lon,
        // WU's nearby search reports no elevation, so this is 0 here as it was when asked directly.
        altitude: s.altitude ?? 0,
      });
    }
    return stations.length > 0 ? stations : null;
  } catch (err) {
    console.debug('[WU] Station list from our API unavailable:', err);
    return null;
  }
}

// ── Current observations ─────────────────────────────────

/**
 * Fetch current observation for a single PWS station.
 */
async function fetchWUCurrent(stationId: string): Promise<WUObservation | null> {
  if (!API_KEY) return null; // No direct WU access without key — ingestor handles it
  const rawId = stationId.replace('wu_', '');
  const url = new URL('/v2/pws/observations/current', BASE_URL);
  url.searchParams.set('stationId', rawId);
  url.searchParams.set('format', 'json');
  url.searchParams.set('units', 's');
  url.searchParams.set('apiKey', API_KEY);

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;

    const data = await res.json();
    return data?.observations?.[0] ?? null;
  } catch (err) {
    console.debug('[Wunderground] fetch failed', err);
    return null;
  }
}

/**
 * Fetch current observations for all known WU stations.
 * Returns normalized readings.
 */
export async function fetchWUObservations(
  stationIds: string[],
): Promise<NormalizedReading[]> {
  const results = await Promise.allSettled(
    stationIds.map((id) => fetchWUCurrent(id)),
  );

  const readings: NormalizedReading[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status !== 'fulfilled' || !result.value) continue;

    const obs = result.value;
    const m = obs.metric_si;

    readings.push({
      stationId: stationIds[i],
      timestamp: new Date(obs.obsTimeUtc),
      windSpeed: m.windSpeed,           // Already m/s
      windGust: m.windGust ?? null,     // Already m/s
      windDirection: obs.winddir,       // Meteorological "from"
      temperature: m.temp,
      humidity: obs.humidity,
      precipitation: m.precipTotal,     // mm total today
      solarRadiation: obs.solarRadiation, // W/m² from PWS sensor
      pressure: m.pressure ?? null,        // hPa from PWS barometer
      dewPoint: m.dewpt ?? null,           // °C from PWS sensor
    });
  }

  return readings;
}
