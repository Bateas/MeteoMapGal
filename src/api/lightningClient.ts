import type { LightningStrike } from '../types/lightning';

/**
 * IDEG MapServer endpoint for real-time lightning data (last 24h).
 * Layer 1 includes both cloud-to-ground and intra-cloud strikes.
 * No authentication required. Returns GeoJSON.
 *
 * Source: MeteoGalicia / Xunta de Galicia (CC BY-SA 4.0)
 */
const LIGHTNING_24H_URL =
  '/ideg-api/meteogalicia/rest/services/METEO2_WS/Observacion_raios_ultimas_24h/MapServer/1/query';

/** Bounding box around Ourense/Ribadavia (generous ~80km radius) */
const OURENSE_BBOX = {
  xmin: -8.8,
  ymin: 41.8,
  xmax: -7.4,
  ymax: 42.8,
};

/** Fields to request from the API */
const OUT_FIELDS = [
  'idDescargas',
  'Fecha',
  'PeakCurrent',
  'CloudInd',
  'Multiplicidad',
].join(',');

/** In-memory cache to avoid hammering the API */
let cache: { data: LightningStrike[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Fetch lightning strikes from the last 24 hours in the Ourense area.
 * Returns parsed LightningStrike[] sorted by timestamp (newest first).
 */
export async function fetchLightningStrikes(): Promise<LightningStrike[]> {
  // Return cached data if fresh enough
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return recomputeAges(cache.data);
  }

  const params = new URLSearchParams({
    where: '1=1',
    outFields: OUT_FIELDS,
    outSR: '4326',
    f: 'geojson',
    returnGeometry: 'true',
    geometry: JSON.stringify({
      xmin: OURENSE_BBOX.xmin,
      ymin: OURENSE_BBOX.ymin,
      xmax: OURENSE_BBOX.xmax,
      ymax: OURENSE_BBOX.ymax,
      spatialReference: { wkid: 4326 },
    }),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
  });

  const url = `${LIGHTNING_24H_URL}?${params}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Lightning API ${res.status}`);

    const geojson = await res.json();
    const now = Date.now();

    const strikes: LightningStrike[] = (geojson.features || []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (f: any) => {
        const p = f.properties;
        const [lon, lat] = f.geometry.coordinates;
        const timestamp = p.Fecha;
        return {
          id: p.idDescargas,
          lat,
          lon,
          timestamp,
          peakCurrent: p.PeakCurrent,
          cloudToCloud: p.CloudInd === 1,
          multiplicity: p.Multiplicidad,
          ageMinutes: Math.round((now - timestamp) / 60_000),
        };
      },
    );

    // Sort newest first
    strikes.sort((a, b) => b.timestamp - a.timestamp);

    cache = { data: strikes, fetchedAt: now };
    return strikes;
  } catch (err) {
    console.error('[Lightning] Fetch error:', err);
    // Return stale cache if available
    if (cache) return recomputeAges(cache.data);
    return [];
  }
}

/** Recompute ageMinutes from cached timestamps */
function recomputeAges(strikes: LightningStrike[]): LightningStrike[] {
  const now = Date.now();
  return strikes.map((s) => ({
    ...s,
    ageMinutes: Math.round((now - s.timestamp) / 60_000),
  }));
}

/**
 * Haversine distance in km between two points.
 */
export function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
