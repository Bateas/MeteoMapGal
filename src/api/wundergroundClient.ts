/**
 * Weather Underground Personal Weather Station (PWS) client.
 *
 * Uses the publicly-exposed SUN_API_KEY from wunderground.com.
 * CORS is allowed (Access-Control-Allow-Origin: *), no proxy needed.
 * Wind speed returned in m/s when using units=s.
 */

import type { NormalizedStation, NormalizedReading } from '../types/station';
import { isWithinRadius } from '../services/geoUtils';

// Public API key exposed in wunderground.com source code
const API_KEY = import.meta.env.VITE_WU_API_KEY ?? 'e1f10a1e78da46f5b10a1e78da96f525';
const BASE_URL = 'https://api.weather.com';

// ── Types ────────────────────────────────────────────────

interface WUNearbyStation {
  stationId: string;
  stationName: string | null;
  latitude: number;
  longitude: number;
  distanceKm: number;
  qcStatus: number; // -1=unchecked, 0=failed, 1=passed
}

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
  const [centerLon, centerLat] = center;

  const url = new URL('/v3/location/near', BASE_URL);
  url.searchParams.set('geocode', `${centerLat},${centerLon}`);
  url.searchParams.set('product', 'pws');
  url.searchParams.set('format', 'json');
  url.searchParams.set('apiKey', API_KEY);

  try {
    const res = await fetch(url.toString());
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
    console.error('[WU] Station discovery error:', err);
    return [];
  }
}

// ── Current observations ─────────────────────────────────

/**
 * Fetch current observation for a single PWS station.
 */
async function fetchWUCurrent(stationId: string): Promise<WUObservation | null> {
  const rawId = stationId.replace('wu_', '');
  const url = new URL('/v2/pws/observations/current', BASE_URL);
  url.searchParams.set('stationId', rawId);
  url.searchParams.set('format', 'json');
  url.searchParams.set('units', 's');
  url.searchParams.set('apiKey', API_KEY);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;

    const data = await res.json();
    return data?.observations?.[0] ?? null;
  } catch {
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
