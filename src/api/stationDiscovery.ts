import type { NormalizedStation } from '../types/station';
import { fetchStationInventory } from './aemetClient';
import { fetchStationList } from './meteogaliciaClient';
import { fetchMeteoclimaticFeed } from './meteoclimaticClient';
import { fetchWUNearbyStations } from './wundergroundClient';
import { fetchNetatmoStations } from './netatmoClient';
import { normalizeAemetStation, normalizeMeteoGaliciaStation, normalizeMeteoclimaticStation } from '../services/normalizer';
import { isWithinRadius } from '../services/geoUtils';
import { MAP_CENTER, DISCOVERY_RADIUS_KM } from '../config/constants';
import { METEOCLIMATIC_STATIONS } from '../types/meteoclimatic';

/**
 * Discover all weather stations within the configured radius
 * from AEMET, MeteoGalicia, Meteoclimatic, Weather Underground, and Netatmo.
 */
export async function discoverStations(): Promise<NormalizedStation[]> {
  const [centerLon, centerLat] = MAP_CENTER;

  const [aemetStations, mgStations, mcStations, wuStations, netatmoStations] =
    await Promise.allSettled([
      fetchStationInventory(),
      fetchStationList(),
      fetchMeteoclimaticFeed(),
      fetchWUNearbyStations(),
      fetchNetatmoStations(false), // All stations (not just wind)
    ]);

  const stations: NormalizedStation[] = [];

  // Process AEMET stations
  if (aemetStations.status === 'fulfilled') {
    for (const raw of aemetStations.value) {
      const station = normalizeAemetStation(raw);
      if (isWithinRadius(centerLat, centerLon, station.lat, station.lon, DISCOVERY_RADIUS_KM)) {
        stations.push(station);
      }
    }
    console.log(`[Discovery] Found ${stations.length} AEMET stations in radius`);
  } else {
    console.error('[Discovery] AEMET station fetch failed:', aemetStations.reason);
  }

  // Process MeteoGalicia stations
  if (mgStations.status === 'fulfilled') {
    const mgCount = stations.length;
    for (const raw of mgStations.value) {
      const station = normalizeMeteoGaliciaStation(raw);
      if (isWithinRadius(centerLat, centerLon, station.lat, station.lon, DISCOVERY_RADIUS_KM)) {
        // Avoid duplicates: check if there's already an AEMET station very close
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
    console.log(`[Discovery] Found ${stations.length - mgCount} MeteoGalicia stations in radius`);
  } else {
    console.error('[Discovery] MeteoGalicia station fetch failed:', mgStations.reason);
  }

  // Process Meteoclimatic stations
  if (mcStations.status === 'fulfilled') {
    const mcCount = stations.length;
    const metaMap = new Map(METEOCLIMATIC_STATIONS.map((m) => [m.id, m]));

    for (const raw of mcStations.value) {
      const meta = metaMap.get(raw.id);
      if (!meta) continue; // Skip stations without known coordinates

      if (isWithinRadius(centerLat, centerLon, meta.lat, meta.lon, DISCOVERY_RADIUS_KM)) {
        // Avoid duplicates: check if there's already a station very close
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
    console.log(`[Discovery] Found ${stations.length - mcCount} Meteoclimatic stations in radius`);
  } else {
    console.error('[Discovery] Meteoclimatic feed fetch failed:', mcStations.reason);
  }

  // Process Weather Underground PWS stations
  if (wuStations.status === 'fulfilled') {
    const wuCount = stations.length;
    for (const station of wuStations.value) {
      // Avoid duplicates: check if there's already a station very close
      const isDuplicate = stations.some(
        (s) =>
          Math.abs(s.lat - station.lat) < 0.005 &&
          Math.abs(s.lon - station.lon) < 0.005
      );
      if (!isDuplicate) {
        stations.push(station);
      }
    }
    console.log(`[Discovery] Found ${stations.length - wuCount} Weather Underground stations in radius`);
  } else {
    console.error('[Discovery] WU station fetch failed:', wuStations.reason);
  }

  // Process Netatmo stations (only wind-equipped ones for map display)
  if (netatmoStations.status === 'fulfilled') {
    const ntCount = stations.length;
    for (const station of netatmoStations.value) {
      // Only add Netatmo stations that have wind data
      // (too many temp-only stations would clutter the map)
      if (station.name.includes('sin viento')) continue;

      // Avoid duplicates
      const isDuplicate = stations.some(
        (s) =>
          Math.abs(s.lat - station.lat) < 0.005 &&
          Math.abs(s.lon - station.lon) < 0.005
      );
      if (!isDuplicate) {
        stations.push(station);
      }
    }
    console.log(`[Discovery] Found ${stations.length - ntCount} Netatmo stations in radius`);
  } else {
    console.error('[Discovery] Netatmo station fetch failed:', netatmoStations.reason);
  }

  console.log(`[Discovery] Total stations: ${stations.length}`);
  return stations;
}
