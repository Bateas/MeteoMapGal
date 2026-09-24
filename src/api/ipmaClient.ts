/**
 * IPMA (Instituto Português do Mar e da Atmosfera) Client.
 *
 * Fetches surface weather observations and stations for Northern Portugal
 * from the official, open IPMA API.
 *
 * Endpoint: https://api.ipma.pt/open-data/observation/meteorology/stations/obs-surface.geojson
 * - Public, no API key required, CORS-enabled (*).
 * - Delivers observations for the last 3 hours.
 * - Each station appears multiple times (one per hour: T-1h, T-2h, T-3h).
 *   The parser groups by `idEstacao` and keeps the most recent reading.
 */

import type { NormalizedStation, NormalizedReading } from '../types/station';
import {
  normalizeIpmaStation,
  normalizeIpmaReading,
  parseIpmaTimestamp,
  type IpmaFeature,
} from '../services/normalizer';
import { isWithinRadius } from '../services/geoUtils';

const IPMA_GEOJSON_URL = 'https://api.ipma.pt/open-data/observation/meteorology/stations/obs-surface.geojson';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min cache (IPMA updates hourly)
const TIMEOUT_MS = 12_000;

interface CachedIpmaData {
  ts: number;
  stations: NormalizedStation[];
  readings: NormalizedReading[];
}

let memoryCache: CachedIpmaData | null = null;

/**
 * Bounding box for Northern Portugal relevant to Galicia borders:
 * Lat: 41.30°N to 42.25°N
 * Lon: -9.00°W to -6.50°W
 */
export const NORTH_PORTUGAL_BBOX = {
  minLat: 41.30,
  maxLat: 42.25,
  minLon: -9.00,
  maxLon: -6.50,
};

export function isInsideNorthPortugal(lat: number, lon: number): boolean {
  return (
    lat >= NORTH_PORTUGAL_BBOX.minLat &&
    lat <= NORTH_PORTUGAL_BBOX.maxLat &&
    lon >= NORTH_PORTUGAL_BBOX.minLon &&
    lon <= NORTH_PORTUGAL_BBOX.maxLon
  );
}

/**
 * Fetch and process IPMA surface observations.
 * Returns only the latest reading per station in Northern Portugal.
 */
type IpmaData = { stations: NormalizedStation[]; readings: NormalizedReading[] };

/** The fetch already under way, shared by every caller that arrives meanwhile
 *  (discovery of two sectors plus the readings fallback asked for the same
 *  feed three times at once on a cold load). */
let inFlight: Promise<IpmaData> | null = null;

export async function fetchIpmaData(): Promise<IpmaData> {
  if (memoryCache && Date.now() - memoryCache.ts < CACHE_TTL_MS) {
    return { stations: memoryCache.stations, readings: memoryCache.readings };
  }
  if (inFlight) return inFlight;
  inFlight = fetchIpmaFresh().finally(() => { inFlight = null; });
  return inFlight;
}

async function fetchIpmaFresh(): Promise<IpmaData> {
  try {
    const res = await fetch(IPMA_GEOJSON_URL, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/json, text/plain, */*' },
    });

    if (!res.ok) {
      console.warn(`[IPMA] HTTP error ${res.status}`);
      return memoryCache ? { stations: memoryCache.stations, readings: memoryCache.readings } : { stations: [], readings: [] };
    }

    const geojson: { type: string; features: IpmaFeature[] } = await res.json();
    if (!geojson || !Array.isArray(geojson.features)) {
      console.warn('[IPMA] Invalid GeoJSON structure received');
      return { stations: [], readings: [] };
    }

    // 1. Group features by idEstacao and find the latest timestamp for each
    const latestByStation = new Map<number, IpmaFeature>();

    for (const feat of geojson.features) {
      if (!feat?.geometry?.coordinates || !feat?.properties?.idEstacao) continue;

      const [lon, lat] = feat.geometry.coordinates;
      // Filter: only stations located in Northern Portugal
      if (!isInsideNorthPortugal(lat, lon)) continue;

      const id = feat.properties.idEstacao;
      const current = latestByStation.get(id);

      if (!current) {
        latestByStation.set(id, feat);
      } else {
        const currentTime = parseIpmaTimestamp(current.properties.time).getTime();
        const featTime = parseIpmaTimestamp(feat.properties.time).getTime();
        if (featTime > currentTime) {
          latestByStation.set(id, feat);
        }
      }
    }

    // 2. Normalize stations and readings
    const stations: NormalizedStation[] = [];
    const readings: NormalizedReading[] = [];

    for (const feat of latestByStation.values()) {
      stations.push(normalizeIpmaStation(feat));
      const reading = normalizeIpmaReading(feat.properties);
      // A reading of unknown age would compare as fresh against every stale
      // gate (NaN > gate is false), so it is dropped, as the ingestor does.
      if (Number.isFinite(reading.timestamp.getTime())) readings.push(reading);
    }

    memoryCache = {
      ts: Date.now(),
      stations,
      readings,
    };

    console.debug(`[IPMA] Loaded ${stations.length} surface stations from Northern Portugal`);
    return { stations, readings };
  } catch (err) {
    console.warn('[IPMA] Fetch failed:', (err as Error).message);
    return memoryCache ? { stations: memoryCache.stations, readings: memoryCache.readings } : { stations: [], readings: [] };
  }
}

/**
 * Filter IPMA stations and readings within sector radius or extra points.
 */
export async function fetchIpmaNearby(
  center: [number, number],
  radiusKm: number,
  extraPoints?: { name: string; lon: number; lat: number }[]
): Promise<{
  stations: NormalizedStation[];
  readings: NormalizedReading[];
}> {
  const { stations, readings } = await fetchIpmaData();
  const [centerLon, centerLat] = center;

  const readingMap = new Map(readings.map((r) => [r.stationId, r]));

  const filteredStations = stations.filter((s) => {
    // Check main radius
    if (isWithinRadius(centerLat, centerLon, s.lat, s.lon, radiusKm)) return true;
    // Check extra coverage points (within 15km of any point)
    if (extraPoints?.length) {
      return extraPoints.some((p) => isWithinRadius(p.lat, p.lon, s.lat, s.lon, 15));
    }
    return false;
  });

  const filteredReadings = filteredStations
    .map((s) => readingMap.get(s.id))
    .filter((r): r is NormalizedReading => r !== undefined);

  return {
    stations: filteredStations,
    readings: filteredReadings,
  };
}

/** Reset in-memory cache (for testing or forced refresh) */
export function clearIpmaCache(): void {
  memoryCache = null;
}
