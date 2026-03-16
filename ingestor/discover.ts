/**
 * Station discovery — fetches station lists from all 6 sources,
 * filters by sector radius, and deduplicates.
 * Runs once at startup and every ~1 hour to pick up new stations.
 */

import type { NormalizedStation } from '../src/types/station.js';
import type { AemetApiResponse, AemetRawStation } from '../src/types/aemet.js';
import type { MeteoGaliciaStation } from '../src/types/meteogalicia.js';
import { METEOCLIMATIC_STATIONS } from '../src/types/meteoclimatic.js';
import { SECTORS } from '../src/config/sectors.js';
import { normalizeAemetStation, normalizeMeteoGaliciaStation } from '../src/services/normalizer.js';
import { isWithinRadius } from '../src/services/geoUtils.js';
import { log } from './logger.js';

const AEMET_BASE = 'https://opendata.aemet.es/opendata';
const MG_BASE = 'https://servizos.meteogalicia.gal';
const WU_BASE = 'https://api.weather.com';
const NETATMO_AUTH = 'https://auth.netatmo.com';
const NETATMO_API = 'https://app.netatmo.net';

const TIMEOUT = 15_000;

/** Check if a point is within ANY sector */
function inAnySector(lat: number, lon: number): boolean {
  return SECTORS.some((s) =>
    isWithinRadius(s.center[1], s.center[0], lat, lon, s.radiusKm)
  );
}

// ── AEMET ─────────────────────────────────────────────

async function discoverAemet(): Promise<NormalizedStation[]> {
  const apiKey = process.env.AEMET_API_KEY;
  if (!apiKey) {
    log.warn('AEMET_API_KEY not set — skipping AEMET discovery');
    return [];
  }

  try {
    // Step 1: Get metadata URL
    const metaRes = await fetch(
      `${AEMET_BASE}/api/valores/climatologicos/inventarioestaciones/todasestaciones?api_key=${apiKey}`,
      { signal: AbortSignal.timeout(TIMEOUT) }
    );
    const meta: AemetApiResponse = await metaRes.json();
    if (meta.estado !== 200 || !meta.datos) {
      log.warn('AEMET inventory: unexpected status', meta.estado);
      return [];
    }

    // Step 2: Fetch actual data (ISO-8859-1)
    const dataRes = await fetch(meta.datos, { signal: AbortSignal.timeout(TIMEOUT) });
    const buf = await dataRes.arrayBuffer();
    const charset = dataRes.headers.get('content-type')?.match(/charset=([^\s;]+)/i)?.[1] ?? 'iso-8859-1';
    const text = new TextDecoder(charset).decode(buf);
    const rawStations: AemetRawStation[] = JSON.parse(text);

    const stations = rawStations
      .map(normalizeAemetStation)
      .filter((s) => inAnySector(s.lat, s.lon));

    log.info(`AEMET: ${stations.length} stations in range`);
    return stations;
  } catch (err) {
    log.error('AEMET discovery failed:', (err as Error).message);
    return [];
  }
}

// ── MeteoGalicia ──────────────────────────────────────

async function discoverMeteoGalicia(): Promise<NormalizedStation[]> {
  try {
    const res = await fetch(
      `${MG_BASE}/mgrss/observacion/listaEstacionsMeteo.action`,
      { signal: AbortSignal.timeout(TIMEOUT) }
    );
    const data = await res.json();
    const rawStations: MeteoGaliciaStation[] = data.listaEstacionsMeteo ?? [];

    const stations = rawStations
      .map(normalizeMeteoGaliciaStation)
      .filter((s) => inAnySector(s.lat, s.lon));

    log.info(`MeteoGalicia: ${stations.length} stations in range`);
    return stations;
  } catch (err) {
    log.error('MeteoGalicia discovery failed:', (err as Error).message);
    return [];
  }
}

// ── Meteoclimatic ─────────────────────────────────────

function discoverMeteoclimatic(): NormalizedStation[] {
  // Coordinates are hardcoded — no API call needed for discovery
  const stations = METEOCLIMATIC_STATIONS
    .filter((m) => inAnySector(m.lat, m.lon))
    .map((m): NormalizedStation => ({
      id: `mc_${m.id}`,
      source: 'meteoclimatic',
      name: m.id, // Real name comes from XML feed during fetch
      lat: m.lat,
      lon: m.lon,
      altitude: m.altitude,
    }));

  log.info(`Meteoclimatic: ${stations.length} stations (hardcoded coords)`);
  return stations;
}

// ── Weather Underground ───────────────────────────────

async function discoverWunderground(): Promise<NormalizedStation[]> {
  const apiKey = process.env.WU_API_KEY || 'e1f10a1e78da46f5b10a1e78da96f525';
  const allStations: NormalizedStation[] = [];

  /** Fetch WU stations near a geocode point and add unique ones to allStations */
  async function fetchWUNear(lat: number, lon: number, label: string): Promise<void> {
    try {
      const res = await fetch(
        `${WU_BASE}/v3/location/near?geocode=${lat},${lon}&product=pws&format=json&apiKey=${apiKey}`,
        { signal: AbortSignal.timeout(TIMEOUT) }
      );
      const data = await res.json();
      const loc = data?.location;
      if (!loc?.stationId) return;

      for (let i = 0; i < loc.stationId.length; i++) {
        const sLat = loc.latitude[i];
        const sLon = loc.longitude[i];
        if (!inAnySector(sLat, sLon)) continue;

        const id = `wu_${loc.stationId[i]}`;
        if (allStations.some((s) => s.id === id)) continue;

        allStations.push({
          id,
          source: 'wunderground',
          name: loc.stationName?.[i] ?? loc.stationId[i],
          lat: sLat,
          lon: sLon,
          altitude: loc.elevation?.[i] ?? 0,
        });
      }
    } catch (err) {
      log.error(`WU discovery (${label}) failed:`, (err as Error).message);
    }
  }

  for (const sector of SECTORS) {
    // Query from sector center
    const [lon, lat] = sector.center;
    await fetchWUNear(lat, lon, sector.id);

    // Query from extra coverage points (matches client-side stationDiscovery.ts)
    if (sector.extraCoveragePoints?.length) {
      const extraResults = await Promise.allSettled(
        sector.extraCoveragePoints.map((p) =>
          fetchWUNear(p.lat, p.lon, `${sector.id}/${p.name}`)
        )
      );
      // Promise.allSettled handles errors per-point — no extra catch needed
      void extraResults;
    }
  }

  // Intra-WU dedup: cluster WU stations within 500m, keep closest to sector center
  const beforeDedup = allStations.length;
  const THRESHOLD = 0.0045; // ~500m
  const used = new Set<number>();
  const kept: NormalizedStation[] = [];

  for (let i = 0; i < allStations.length; i++) {
    if (used.has(i)) continue;
    const cluster = [i];
    used.add(i);

    for (let j = i + 1; j < allStations.length; j++) {
      if (used.has(j)) continue;
      const isNear = cluster.some((k) =>
        Math.abs(allStations[k].lat - allStations[j].lat) < THRESHOLD &&
        Math.abs(allStations[k].lon - allStations[j].lon) < THRESHOLD
      );
      if (isNear) {
        cluster.push(j);
        used.add(j);
      }
    }

    if (cluster.length === 1) {
      kept.push(allStations[i]);
    } else {
      // Pick closest to nearest sector center
      let bestIdx = cluster[0];
      let bestDist = Infinity;
      for (const idx of cluster) {
        for (const sector of SECTORS) {
          const [clon, clat] = sector.center;
          const d = (allStations[idx].lat - clat) ** 2 + (allStations[idx].lon - clon) ** 2;
          if (d < bestDist) { bestDist = d; bestIdx = idx; }
        }
      }
      kept.push(allStations[bestIdx]);
      log.info(
        `WU cluster: kept ${allStations[bestIdx].id}, dropped ${cluster.length - 1} nearby`
      );
    }
  }

  if (kept.length < beforeDedup) {
    log.info(`WU intra-dedup: ${beforeDedup} → ${kept.length} (${beforeDedup - kept.length} merged)`);
  }

  log.info(`Weather Underground: ${kept.length} stations`);
  return kept;
}

// ── Netatmo ───────────────────────────────────────────

let netatmoToken: string | null = null;
let netatmoTokenExpiry = 0;

export async function getNetatmoToken(): Promise<string | null> {
  if (netatmoToken && Date.now() < netatmoTokenExpiry) return netatmoToken;

  try {
    const res = await fetch(`${NETATMO_AUTH}/weathermap/token`, {
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const data = await res.json();
    netatmoToken = data.body ?? data.access_token ?? null;
    netatmoTokenExpiry = Date.now() + 55 * 60_000; // Refresh 5min before 1h expiry
    return netatmoToken;
  } catch (err) {
    log.error('Netatmo token failed:', (err as Error).message);
    return null;
  }
}

interface NetatmoRawStation {
  _id: string;
  place: { location: [number, number]; altitude: number; city?: string };
  measures: Record<string, unknown>;
  module_types?: Record<string, string>;
}

async function discoverNetatmo(): Promise<NormalizedStation[]> {
  const token = await getNetatmoToken();
  if (!token) return [];

  const allStations: NormalizedStation[] = [];

  for (const sector of SECTORS) {
    const [lon, lat] = sector.center;
    const latDelta = (sector.radiusKm / 111) * 1.1;
    const lonDelta = (sector.radiusKm / 82) * 1.1;

    try {
      const res = await fetch(`${NETATMO_API}/api/getpublicdata`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lat_ne: lat + latDelta,
          lat_sw: lat - latDelta,
          lon_ne: lon + lonDelta,
          lon_sw: lon - lonDelta,
          required_data: 'wind',
          filter: false,
        }),
        signal: AbortSignal.timeout(TIMEOUT),
      });
      const data = await res.json();
      const body: NetatmoRawStation[] = data.body ?? [];

      for (const raw of body) {
        const [sLon, sLat] = raw.place.location;
        if (!inAnySector(sLat, sLon)) continue;

        const shortMac = raw._id.replace(/:/g, '').slice(-6).toLowerCase();
        const id = `nt_${shortMac}`;
        if (allStations.some((s) => s.id === id)) continue;

        // Check if station has wind module (NAModule2)
        const hasWind = raw.module_types
          ? Object.values(raw.module_types).includes('NAModule2')
          : false;

        allStations.push({
          id,
          source: 'netatmo',
          name: raw.place.city ?? `Netatmo ${shortMac}`,
          lat: sLat,
          lon: sLon,
          altitude: raw.place.altitude ?? 0,
          tempOnly: !hasWind,
        });
      }
    } catch (err) {
      log.error(`Netatmo discovery (${sector.id}) failed:`, (err as Error).message);
    }
  }

  log.info(`Netatmo: ${allStations.length} stations (${allStations.filter(s => !s.tempOnly).length} with wind)`);
  return allStations;
}

// ── SkyX ─────────────────────────────────────────────

const SKYX_API = 'https://api.skyxglobal.com';
const SKYX_SN = 'SKY-100A0B765294EA4';
const SKYX_AUTH = 'a21bd737-a714-4a5c-9b08-e7d3d2693a51';
const SKYX_STATION_ID = 'skyx_SKY100';
const SKYX_TIMEOUT = 5_000;

interface SkyXResponse {
  code: number;
  message: string;
  data: {
    sn: string;
    ts: string;
    t: number;
    extra: { gps: string };
  };
}

async function discoverSkyX(): Promise<NormalizedStation[]> {
  try {
    const res = await fetch(
      `${SKYX_API}/api/v1/pub/device/last/report/${SKYX_SN}`,
      {
        headers: { 'X-Auth': SKYX_AUTH },
        signal: AbortSignal.timeout(SKYX_TIMEOUT),
      }
    );
    if (!res.ok) {
      log.warn(`SkyX discovery: HTTP ${res.status}`);
      return [];
    }

    const json: SkyXResponse = await res.json();
    if (json.code !== 200 || !json.data) {
      log.warn(`SkyX discovery: API error ${json.message}`);
      return [];
    }

    // Parse GPS from "lat,lon" string
    const gps = json.data.extra?.gps ?? '';
    const parts = gps.split(',');
    if (parts.length !== 2) {
      log.warn('SkyX discovery: no GPS data');
      return [];
    }
    const lat = parseFloat(parts[0]);
    const lon = parseFloat(parts[1]);
    if (isNaN(lat) || isNaN(lon)) return [];

    // Only include if within any sector
    if (!inAnySector(lat, lon)) {
      log.info(`SkyX: station out of all sector ranges (${lat.toFixed(4)}, ${lon.toFixed(4)})`);
      return [];
    }

    // Check if sensor is offline
    if (json.data.t === 9999) {
      log.warn('SkyX: station offline (sentinel 9999)');
      return [];
    }

    const station: NormalizedStation = {
      id: SKYX_STATION_ID,
      source: 'skyx',
      name: 'SkyX1',
      lat,
      lon,
      altitude: 0,
    };

    log.info(`SkyX: 1 station at ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
    return [station];
  } catch (err) {
    log.error('SkyX discovery failed:', (err as Error).message);
    return [];
  }
}

// ── Orchestrator ──────────────────────────────────────

/**
 * Discover stations from all sources in parallel.
 * Returns a Map<stationId, NormalizedStation> (deduped).
 */
export async function discoverAllStations(): Promise<Map<string, NormalizedStation>> {
  log.info('Discovering stations from all sources...');

  const results = await Promise.allSettled([
    discoverAemet(),
    discoverMeteoGalicia(),
    Promise.resolve(discoverMeteoclimatic()),
    discoverWunderground(),
    discoverNetatmo(),
    discoverSkyX(),
  ]);

  const stationMap = new Map<string, NormalizedStation>();

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const station of result.value) {
        stationMap.set(station.id, station);
      }
    }
  }

  log.ok(`Discovered ${stationMap.size} unique stations across all sources`);
  return stationMap;
}
