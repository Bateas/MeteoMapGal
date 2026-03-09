import type { NormalizedStation } from '../types/station';
import { fetchStationInventory } from './aemetClient';
import { fetchStationList } from './meteogaliciaClient';
import { fetchMeteoclimaticFeed } from './meteoclimaticClient';
import { fetchWUNearbyStations } from './wundergroundClient';
import { fetchNetatmoStations } from './netatmoClient';
import { normalizeAemetStation, normalizeMeteoGaliciaStation, normalizeMeteoclimaticStation } from '../services/normalizer';
import { isWithinRadius } from '../services/geoUtils';
import { METEOCLIMATIC_STATIONS } from '../types/meteoclimatic';

export interface DiscoveryParams {
  center: [number, number];        // [lon, lat]
  radiusKm: number;
  meteoclimaticRegions: string[];
  /** Extra coverage points outside the main radius (stations within 8km included) */
  extraCoveragePoints?: { name: string; lon: number; lat: number }[];
}

/** Check if a station falls within any extra coverage point (8km mini-radius) */
function isInExtraCoverage(
  lat: number,
  lon: number,
  extraPoints?: { name: string; lon: number; lat: number }[]
): boolean {
  if (!extraPoints?.length) return false;
  return extraPoints.some((p) => isWithinRadius(p.lat, p.lon, lat, lon, 8));
}

/** Retry a fetch function after a delay */
async function retryAfterDelay<T>(fn: () => Promise<T>, delayMs: number): Promise<T> {
  await new Promise((r) => setTimeout(r, delayMs));
  return fn();
}

/**
 * Discover all weather stations within the given sector params
 * from AEMET, MeteoGalicia, Meteoclimatic, Weather Underground, and Netatmo.
 * Auto-retries failed critical sources (MeteoGalicia, Netatmo) after 5s.
 */
export async function discoverStations(params: DiscoveryParams): Promise<NormalizedStation[]> {
  const [centerLon, centerLat] = params.center;
  const radiusKm = params.radiusKm;
  const extraPoints = params.extraCoveragePoints;

  let [aemetStations, mgStations, mcStations, wuStations, netatmoStations] =
    await Promise.allSettled([
      fetchStationInventory(),
      fetchStationList(),
      fetchMeteoclimaticFeed(params.meteoclimaticRegions),
      fetchWUNearbyStations(params.center, radiusKm),
      fetchNetatmoStations(params.center, radiusKm, false),
    ]);

  // Auto-retry failed critical sources (MeteoGalicia = ~38 stations, Netatmo = ~42 stations)
  const retryTargets: Promise<void>[] = [];
  if (mgStations.status === 'rejected') {
    console.warn('[Discovery] MeteoGalicia failed — retrying in 5s...');
    retryTargets.push(
      retryAfterDelay(() => fetchStationList(), 5000)
        .then((v) => { mgStations = { status: 'fulfilled', value: v }; })
        .catch((e) => { console.error('[Discovery] MeteoGalicia retry failed:', e); })
    );
  }
  if (netatmoStations.status === 'rejected') {
    console.warn('[Discovery] Netatmo failed — retrying in 5s...');
    retryTargets.push(
      retryAfterDelay(() => fetchNetatmoStations(params.center, radiusKm, false), 5000)
        .then((v) => { netatmoStations = { status: 'fulfilled', value: v }; })
        .catch((e) => { console.error('[Discovery] Netatmo retry failed:', e); })
    );
  }
  if (retryTargets.length > 0) {
    await Promise.allSettled(retryTargets);
  }

  const stations: NormalizedStation[] = [];

  // Process AEMET stations
  if (aemetStations.status === 'fulfilled') {
    for (const raw of aemetStations.value) {
      const station = normalizeAemetStation(raw);
      if (isWithinRadius(centerLat, centerLon, station.lat, station.lon, radiusKm) ||
          isInExtraCoverage(station.lat, station.lon, extraPoints)) {
        stations.push(station);
      }
    }
    console.debug(`[Discovery] Found ${stations.length} AEMET stations in radius`);
  } else {
    console.error('[Discovery] AEMET station fetch failed:', aemetStations.reason);
  }

  // Process MeteoGalicia stations
  if (mgStations.status === 'fulfilled') {
    const mgCount = stations.length;
    for (const raw of mgStations.value) {
      const station = normalizeMeteoGaliciaStation(raw);
      if (isWithinRadius(centerLat, centerLon, station.lat, station.lon, radiusKm) ||
          isInExtraCoverage(station.lat, station.lon, extraPoints)) {
        const isDuplicate = stations.some(
          (s) => s.source === 'aemet' &&
            Math.abs(s.lat - station.lat) < 0.005 &&
            Math.abs(s.lon - station.lon) < 0.005
        );
        if (!isDuplicate) {
          stations.push(station);
        }
      }
    }
    console.debug(`[Discovery] Found ${stations.length - mgCount} MeteoGalicia stations in radius`);
  } else {
    console.error('[Discovery] MeteoGalicia station fetch failed:', mgStations.reason);
  }

  // Process Meteoclimatic stations
  if (mcStations.status === 'fulfilled') {
    const mcCount = stations.length;
    const metaMap = new Map(METEOCLIMATIC_STATIONS.map((m) => [m.id, m]));

    for (const raw of mcStations.value) {
      const meta = metaMap.get(raw.id);
      if (!meta) continue;

      if (isWithinRadius(centerLat, centerLon, meta.lat, meta.lon, radiusKm) ||
          isInExtraCoverage(meta.lat, meta.lon, extraPoints)) {
        const isDuplicate = stations.some(
          (s) =>
            Math.abs(s.lat - meta.lat) < 0.005 &&
            Math.abs(s.lon - meta.lon) < 0.005
        );
        if (!isDuplicate) {
          stations.push(normalizeMeteoclimaticStation(raw, meta));
        }
      }
    }
    console.debug(`[Discovery] Found ${stations.length - mcCount} Meteoclimatic stations in radius`);
  } else {
    console.error('[Discovery] Meteoclimatic feed fetch failed:', mcStations.reason);
  }

  // Process Weather Underground PWS stations
  if (wuStations.status === 'fulfilled') {
    const wuCount = stations.length;
    for (const station of wuStations.value) {
      const isDuplicate = stations.some(
        (s) =>
          Math.abs(s.lat - station.lat) < 0.005 &&
          Math.abs(s.lon - station.lon) < 0.005
      );
      if (!isDuplicate) {
        stations.push(station);
      }
    }
    console.debug(`[Discovery] Found ${stations.length - wuCount} Weather Underground stations in radius`);
  } else {
    console.error('[Discovery] WU station fetch failed:', wuStations.reason);
  }

  // Process Netatmo stations
  if (netatmoStations.status === 'fulfilled') {
    const ntCount = stations.length;
    let windCount = 0;
    let tempOnlyCount = 0;
    for (const station of netatmoStations.value) {
      const isDuplicate = stations.some(
        (s) =>
          !s.tempOnly &&
          Math.abs(s.lat - station.lat) < 0.005 &&
          Math.abs(s.lon - station.lon) < 0.005
      );
      if (!isDuplicate) {
        stations.push(station);
        if (station.tempOnly) tempOnlyCount++;
        else windCount++;
      }
    }
    console.debug(`[Discovery] Found ${windCount} Netatmo wind + ${tempOnlyCount} temp-only stations in radius`);
  } else {
    console.error('[Discovery] Netatmo station fetch failed:', netatmoStations.reason);
  }

  console.debug(`[Discovery] Total stations: ${stations.length}`);
  return stations;
}
