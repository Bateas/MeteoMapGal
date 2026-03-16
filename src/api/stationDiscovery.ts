import type { NormalizedStation } from '../types/station';
import { fetchStationInventory } from './aemetClient';
import { fetchStationList } from './meteogaliciaClient';
import { fetchMeteoclimaticFeed } from './meteoclimaticClient';
import { fetchWUNearbyStations } from './wundergroundClient';
import { fetchNetatmoStations } from './netatmoClient';
import { normalizeAemetStation, normalizeMeteoGaliciaStation, normalizeMeteoclimaticStation } from '../services/normalizer';
import { isWithinRadius } from '../services/geoUtils';
import { METEOCLIMATIC_STATIONS } from '../types/meteoclimatic';
import { fetchSkyXData } from './skyxClient';

export interface DiscoveryParams {
  center: [number, number];        // [lon, lat]
  radiusKm: number;
  meteoclimaticRegions: string[];
  /** Extra coverage points outside the main radius (stations within 8km included) */
  extraCoveragePoints?: { name: string; lon: number; lat: number }[];
  /** Sector ID — used to skip dedup for Embalse and apply Rías exclusion zones */
  sectorId?: string;
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

  // Process Weather Underground PWS stations (center + extra coverage points)
  if (wuStations.status === 'fulfilled') {
    const wuCount = stations.length;
    let allWU = [...wuStations.value];

    // Also query WU from extra coverage points (WU API is geocode-based, needs multiple queries)
    if (extraPoints?.length) {
      const extraWU = await Promise.allSettled(
        extraPoints.map((p) => fetchWUNearbyStations([p.lon, p.lat], 10))
      );
      for (const r of extraWU) {
        if (r.status === 'fulfilled') allWU.push(...r.value);
      }
    }

    // Intra-WU dedup: cluster WU stations within 500m, keep closest to center
    allWU = deduplicateWUByProximity(allWU, centerLat, centerLon);

    for (const station of allWU) {
      // Accept if within main radius OR within extra coverage
      const inRadius = isWithinRadius(centerLat, centerLon, station.lat, station.lon, radiusKm);
      const inExtra = isInExtraCoverage(station.lat, station.lon, extraPoints);
      if (!inRadius && !inExtra) continue;

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

  // Post-processing: exclusion zones + proximity dedup (Rías only)
  const sectorId = params.sectorId ?? '';

  let result = stations;

  if (sectorId === 'rias') {
    result = excludeRiasInterior(result);
    result = deduplicateByProximity(result);
  }

  // Process SkyX personal station AFTER dedup (user's own — never deduped)
  // Non-blocking: race against 5s timeout to prevent blocking other sources
  try {
    const skyxResult = await Promise.race([
      fetchSkyXData(params.center, radiusKm),
      new Promise<{ station: null; reading: null }>((resolve) =>
        setTimeout(() => resolve({ station: null, reading: null }), 5_000)
      ),
    ]);
    if (skyxResult.station) {
      result.push(skyxResult.station);
    }
  } catch (err) {
    console.debug('[Discovery] SkyX fetch failed:', err);
  }

  console.debug(`[Discovery] Total stations: ${result.length}`);
  return result;
}

// ── WU intra-source proximity deduplication ───────────────────

/**
 * Dedup WU stations within ~500m of each other.
 * When multiple PWS are clustered (e.g. neighbors in the same street),
 * keep only the one closest to sector center (most representative).
 *
 * 500m ≈ 0.0045° latitude at Galician latitudes.
 * Uses simple union-find clustering: stations within threshold of ANY
 * member of a cluster get merged into that cluster.
 */
function deduplicateWUByProximity(
  wuStations: NormalizedStation[],
  centerLat: number,
  centerLon: number,
): NormalizedStation[] {
  if (wuStations.length <= 1) return wuStations;

  const THRESHOLD = 0.0045; // ~500m
  const used = new Set<number>();
  const kept: NormalizedStation[] = [];

  // Remove exact ID duplicates first (from overlapping extra coverage queries)
  const uniqueById = new Map<string, NormalizedStation>();
  for (const s of wuStations) {
    if (!uniqueById.has(s.id)) uniqueById.set(s.id, s);
  }
  const unique = [...uniqueById.values()];

  for (let i = 0; i < unique.length; i++) {
    if (used.has(i)) continue;

    // Build cluster: all stations within 500m of station[i]
    const cluster = [i];
    used.add(i);

    for (let j = i + 1; j < unique.length; j++) {
      if (used.has(j)) continue;
      // Check against any member of the cluster
      const isNear = cluster.some((k) =>
        Math.abs(unique[k].lat - unique[j].lat) < THRESHOLD &&
        Math.abs(unique[k].lon - unique[j].lon) < THRESHOLD
      );
      if (isNear) {
        cluster.push(j);
        used.add(j);
      }
    }

    if (cluster.length === 1) {
      kept.push(unique[i]);
    } else {
      // Pick the one closest to sector center
      let bestIdx = cluster[0];
      let bestDist = Infinity;
      for (const idx of cluster) {
        const dlat = unique[idx].lat - centerLat;
        const dlon = unique[idx].lon - centerLon;
        const dist = dlat * dlat + dlon * dlon;
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = idx;
        }
      }
      kept.push(unique[bestIdx]);
      console.debug(
        `[Discovery] WU cluster dedup: kept ${unique[bestIdx].id} ` +
        `(${unique[bestIdx].name}), dropped ${cluster.length - 1}: ` +
        `${cluster.filter(k => k !== bestIdx).map(k => unique[k].id).join(', ')}`
      );
    }
  }

  if (kept.length < unique.length) {
    console.debug(
      `[Discovery] WU intra-dedup: ${unique.length} → ${kept.length} ` +
      `(${unique.length - kept.length} nearby WU stations merged)`
    );
  }

  return kept;
}

// ── Rías interior exclusion zone ─────────────────────────────

/**
 * Polygon defining interior mountain area to exclude from Rías Baixas.
 * Removes inland stations (A Lama, Ponte Caldelas, Campo Lameiro,
 * Pazos de Borbén, A Granxa, Ponteareas, Fornelos, Gargamala, Meder,
 * San Nomedio) that don't contribute to coastal wind monitoring.
 *
 * Western boundary at -8.55 separates interior (lon > -8.55) from
 * coastal corridor (O Viso -8.60, Atios -8.61, Vigo -8.62).
 */
const RIAS_INTERIOR_EXCLUSION: [number, number][] = [
  [-8.55, 42.42],   // NW — captures Ponte Caldelas, Campo Lameiro, A Lama
  [-8.25, 42.42],   // NE — east of A Lama
  [-8.15, 42.25],   // E — Covelo area
  [-8.20, 42.05],   // SE — south of Mondariz
  [-8.55, 41.95],   // SW — southern interior
];

/** Point-in-polygon test (ray casting algorithm) */
function isInsidePolygon(lon: number, lat: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Remove interior mountain stations from Rías Baixas sector */
function excludeRiasInterior(stations: NormalizedStation[]): NormalizedStation[] {
  const before = stations.length;
  const filtered = stations.filter((s) => !isInsidePolygon(s.lon, s.lat, RIAS_INTERIOR_EXCLUSION));
  if (filtered.length < before) {
    console.debug(
      `[Discovery] Rías interior exclusion: ${before} → ${filtered.length} ` +
      `(${before - filtered.length} inland stations removed)`
    );
  }
  return filtered;
}

// ── Cross-source proximity deduplication (Rías only) ─────────

/** Source priority — higher value = keep over lower */
const SOURCE_PRIORITY: Record<string, number> = {
  aemet: 50,          // official national agency, calibrated
  meteogalicia: 40,   // official regional agency, calibrated
  meteoclimatic: 30,  // curated amateur network, consistent
  wunderground: 20,   // personal weather stations, variable quality
  netatmo: 10,        // consumer devices
  skyx: 5,            // personal consumer device
};

/**
 * Score a station by data richness — stations with more sensor types rank higher.
 * Wind is essential for Rías (coastal monitoring). Solar, pressure, humidity add value.
 */
function dataRichnessScore(s: NormalizedStation): number {
  if (s.tempOnly) return 0;
  let score = 10; // has wind = base 10
  // Source-specific data richness (AEMET/MG report more fields)
  if (s.source === 'aemet' || s.source === 'meteogalicia') score += 5;
  return score;
}

/**
 * Proximity dedup for Rías Baixas only.
 *
 * Rules:
 * 1. Sort by: source priority → data richness → wind over tempOnly
 * 2. When a lower-ranked station is within ~1.3km of kept station, drop it
 * 3. BUT: guarantee at least 2 wind stations per cluster (redundancy)
 * 4. tempOnly stations use wider 2km radius (less useful in Rías)
 */
function deduplicateByProximity(stations: NormalizedStation[]): NormalizedStation[] {
  const sorted = [...stations].sort((a, b) => {
    const pa = SOURCE_PRIORITY[a.source] ?? 0;
    const pb = SOURCE_PRIORITY[b.source] ?? 0;
    if (pa !== pb) return pb - pa;
    const da = dataRichnessScore(a);
    const db = dataRichnessScore(b);
    if (da !== db) return db - da;
    return (a.tempOnly ? 1 : 0) - (b.tempOnly ? 1 : 0);
  });

  const kept: NormalizedStation[] = [];

  for (const station of sorted) {
    const threshold = station.tempOnly ? 0.018 : 0.012; // ~2km / ~1.3km

    // Find how many already-kept stations are nearby
    const nearbyKept = kept.filter(
      (s) =>
        Math.abs(s.lat - station.lat) < threshold &&
        Math.abs(s.lon - station.lon) < threshold
    );

    if (nearbyKept.length === 0) {
      // No nearby stations — always keep
      kept.push(station);
    } else if (!station.tempOnly && nearbyKept.length < 2) {
      // Wind station with only 1 neighbor — keep for redundancy
      // (never leave just 1 station alone)
      kept.push(station);
    }
    // else: already 2+ nearby → skip this one
  }

  if (kept.length < sorted.length) {
    console.debug(
      `[Discovery] Proximity dedup: ${sorted.length} → ${kept.length} ` +
      `(${sorted.length - kept.length} nearby duplicates removed)`
    );
  }

  return kept;
}
