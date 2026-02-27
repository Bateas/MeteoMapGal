/**
 * Weather Underground Personal Weather Station (PWS) client.
 *
 * Uses the publicly-exposed SUN_API_KEY from wunderground.com.
 * CORS is allowed (Access-Control-Allow-Origin: *), no proxy needed.
 * Wind speed returned in m/s when using units=s.
 */

import type { NormalizedStation, NormalizedReading } from '../types/station';
import { MAP_CENTER, DISCOVERY_RADIUS_KM } from '../config/constants';
import { isWithinRadius } from '../services/geoUtils';

// Public API key exposed in wunderground.com source code
const API_KEY = 'e1f10a1e78da46f5b10a1e78da96f525';
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
export async function fetchWUNearbyStations(): Promise<NormalizedStation[]> {
  const [centerLon, centerLat] = MAP_CENTER;

  const url = `${BASE_URL}/v3/location/near?geocode=${centerLat},${centerLon}&product=pws&format=json&apiKey=${API_KEY}`;

  try {
    const res = await fetch(url);
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

      if (!isWithinRadius(centerLat, centerLon, lat, lon, DISCOVERY_RADIUS_KM)) {
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

    console.log(`[WU] Found ${stations.length} PWS stations in radius`);
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
  const url = `${BASE_URL}/v2/pws/observations/current?stationId=${rawId}&format=json&units=s&apiKey=${API_KEY}`;

  try {
    const res = await fetch(url);
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
    });
  }

  return readings;
}
