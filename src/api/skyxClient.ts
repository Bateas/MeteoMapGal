import type { NormalizedStation, NormalizedReading } from '../types/station';
import { isWithinRadius } from '../services/geoUtils';

const SKYX_SN = 'SKY-100A0B765294EA4';
const SKYX_AUTH = 'a21bd737-a714-4a5c-9b08-e7d3d2693a51';
const SKYX_STATION_ID = 'skyx_SKY100';
const SKYX_STATION_NAME = 'SkyX1';
const TIMEOUT_MS = 5_000;

interface SkyXReport {
  sn: string;
  ts: string;
  t: number;
  h: number;
  p: number;
  wmax: number;
  wmin: number;
  wav: number;
  wl: number;
  state: { bat: number; rssi: number; wifi_interval: number };
  extra: { gps: string };
}

interface SkyXResponse {
  code: number;
  message: string;
  data: SkyXReport;
}

/** Filter sentinel value 9999 → null */
function clean(v: number): number | null {
  return v === 9999 ? null : v;
}

/** Parse "lat,lon" string from extra.gps */
function parseGps(gps: string): { lat: number; lon: number } | null {
  const parts = gps.split(',');
  if (parts.length !== 2) return null;
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);
  if (isNaN(lat) || isNaN(lon)) return null;
  return { lat, lon };
}

/**
 * Fetch the user's personal SkyX station data.
 * Returns both station metadata and current reading from a single API call.
 * Returns null station/reading if out of sector radius or sensor offline.
 */
export async function fetchSkyXData(
  center: [number, number],
  radiusKm: number
): Promise<{ station: NormalizedStation | null; reading: NormalizedReading | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`/skyx-api/api/v1/pub/device/last/report/${SKYX_SN}`, {
      headers: { 'X-Auth': SKYX_AUTH },
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[SkyX] HTTP ${res.status}`);
      return { station: null, reading: null };
    }

    const json: SkyXResponse = await res.json();
    if (json.code !== 200 || !json.data) {
      console.warn(`[SkyX] API error: ${json.message}`);
      return { station: null, reading: null };
    }

    const report = json.data;
    const coords = parseGps(report.extra?.gps ?? '');
    if (!coords) {
      console.warn('[SkyX] No GPS data');
      return { station: null, reading: null };
    }

    // Check if station is within active sector radius
    const [centerLon, centerLat] = center;
    if (!isWithinRadius(centerLat, centerLon, coords.lat, coords.lon, radiusKm)) {
      console.debug(`[Discovery] SkyX station out of range (${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)})`);
      return { station: null, reading: null };
    }

    // Check if sensor is offline (all values 9999)
    if (report.t === 9999) {
      console.warn('[SkyX] Station offline (sentinel 9999)');
      return { station: null, reading: null };
    }

    const station: NormalizedStation = {
      id: SKYX_STATION_ID,
      source: 'skyx',
      name: SKYX_STATION_NAME,
      lat: coords.lat,
      lon: coords.lon,
      altitude: 0, // SKY-100 has no altimeter — use 0
    };

    const reading: NormalizedReading = {
      stationId: SKYX_STATION_ID,
      timestamp: new Date(report.ts),
      temperature: clean(report.t),
      humidity: clean(report.h),
      windSpeed: clean(report.wav),
      windGust: clean(report.wmax),
      windDirection: null, // SKY-100 has no wind vane
      precipitation: null,
      pressure: clean(report.p),
      dewPoint: null,
      solarRadiation: null,
    };

    console.debug(`[Discovery] SkyX station: ${SKYX_STATION_NAME} at ${coords.lat.toFixed(4)},${coords.lon.toFixed(4)}`);
    return { station, reading };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      console.warn('[SkyX] Request timeout');
    } else {
      console.error('[SkyX] Fetch error:', err);
    }
    return { station: null, reading: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch only the reading for SkyX station (used in refresh loop).
 * Skips radius check — station was already discovered.
 */
export async function fetchSkyXReading(): Promise<NormalizedReading | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`/skyx-api/api/v1/pub/device/last/report/${SKYX_SN}`, {
      headers: { 'X-Auth': SKYX_AUTH },
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const json: SkyXResponse = await res.json();
    if (json.code !== 200 || !json.data || json.data.t === 9999) return null;

    const report = json.data;
    return {
      stationId: SKYX_STATION_ID,
      timestamp: new Date(report.ts),
      temperature: clean(report.t),
      humidity: clean(report.h),
      windSpeed: clean(report.wav),
      windGust: clean(report.wmax),
      windDirection: null,
      precipitation: null,
      pressure: clean(report.p),
      dewPoint: null,
      solarRadiation: null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
