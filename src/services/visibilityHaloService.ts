/**
 * Pure helpers for the AEMET-visibility fog halo.
 *
 * Niebla en Galicia es fenómeno de cota baja: se forma en el valle (radiative)
 * o flota sobre el mar y costa (advective). NUNCA sobre cumbres. Por eso el
 * halo se ancla a la altitud de la propia estación que reporta vis<2km y se
 * recorta a su "piscina de aire frío": cualquier celda más alta que
 * stationAlt + ALT_BUFFER se descarta.
 *
 * Intensidad: visibility 0.3km → halo denso y amplio (5km radio), visibility
 * 1.8km → halo tenue (2km radio). Cuadrática.
 *
 * Mar (queryTerrainElevation = null): permitido SOLO si la estación es
 * costera (altitud ≤50m). Para estaciones interiores (Lavacolla 370m,
 * Lugo Rozas 444m) ignorar agua porque el valle interior no llega al mar.
 */

const KM_PER_DEG_LAT = 111;
const DEG_TO_RAD = Math.PI / 180;

/** ICAO-ish thresholds: visibility ≤ this triggers halo */
export const HALO_VIS_THRESHOLD_KM = 2.0;
/** Fog floor: vertical buffer above station altitude that still counts as "valley" */
const ALT_BUFFER_M = 50;
/** Coastal-station altitude cap (meters). Below this, water cells get the halo */
const COASTAL_ALT_M = 50;

export interface VisibilityHaloInput {
  stationId: string;
  name: string;
  lat: number;
  lon: number;
  visibilityKm: number;
  /** Ground elevation at the station from queryTerrainElevation, in meters */
  stationElevM: number | null;
}

export interface HaloCell {
  lng: number;
  lat: number;
  /** Width of the cell in degrees (lon) */
  cellW: number;
  /** Height of the cell in degrees (lat) */
  cellH: number;
  /** 0..1 density bucket */
  density: number;
}

/**
 * Compute halo radius (km) for a given visibility reading.
 * Lower visibility → wider halo (denser fog spreads further).
 */
export function haloRadiusKm(visibilityKm: number): number {
  if (visibilityKm >= HALO_VIS_THRESHOLD_KM) return 0;
  if (visibilityKm <= 0.5) return 5;
  if (visibilityKm <= 1.0) return 4;
  if (visibilityKm <= 1.5) return 3;
  return 2;
}

/**
 * Decide whether a single cell should receive halo paint and at what density.
 *
 * Returns the density (0..1) bucketed to 4 levels for seam-free rendering,
 * or 0 if the cell should be skipped. Pure function — easy to test.
 *
 * @param distKm distance from station to cell center
 * @param maxRadiusKm halo extent
 * @param cellElev elevation at cell (null = water/unloaded)
 * @param stationElev elevation at station (null = unloaded → fail safe SKIP)
 * @param visibilityKm reported visibility for distance-based intensity
 */
export function densityForCell(
  distKm: number,
  maxRadiusKm: number,
  cellElev: number | null | undefined,
  stationElev: number | null | undefined,
  visibilityKm: number,
): number {
  // No halo at all if visibility is above threshold or radius is zero
  if (maxRadiusKm <= 0) return 0;
  if (distKm > maxRadiusKm) return 0;
  // Without a station altitude reference we can't reason about the cold-air
  // pool — skip safely. Caller must defer until terrain is loaded.
  if (stationElev === null || stationElev === undefined) return 0;

  const isWater = cellElev === null || cellElev === undefined;
  if (isWater) {
    // Water only allowed for coastal stations
    if (stationElev > COASTAL_ALT_M) return 0;
  } else {
    // Land cell must be at-or-near the station's air column floor
    if (cellElev > stationElev + ALT_BUFFER_M) return 0;
  }

  // Distance falloff (quadratic, so the halo edge is sharp)
  const linear = Math.max(0, 1 - distKm / maxRadiusKm);
  const distFactor = linear * linear;

  // Visibility intensity multiplier — vis 0.3km → 1.0, vis 1.9km → ~0.05
  const visFactor = Math.max(
    0,
    Math.min(1, (HALO_VIS_THRESHOLD_KM - visibilityKm) / HALO_VIS_THRESHOLD_KM),
  );

  // Land cells closer to the station floor get a small altitude bonus
  let altBonus = 1;
  if (!isWater && stationElev !== null && stationElev !== undefined) {
    const above = Math.max(0, cellElev - stationElev);
    altBonus = Math.max(0.4, 1 - above / ALT_BUFFER_M);
  }

  const raw = distFactor * 0.7 + visFactor * 0.3;
  const blended = Math.min(1, raw * altBonus);
  if (blended < 0.08) return 0;

  // Bucket to 4 levels — adjacent cells in the same bucket merge cleanly
  // (same fix used in FogOverlay v2.56.12 to kill the mosaic seam).
  return Math.round(blended * 4) / 4;
}

/**
 * Fast equirectangular distance — same approach used elsewhere in the app.
 * Good enough at <500km for our halo scales.
 */
export function distKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD * Math.cos(((lat1 + lat2) / 2) * DEG_TO_RAD);
  return Math.sqrt(dLat * dLat + dLon * dLon) * 6371;
}

/**
 * Build the bounding box for one halo (covers radius + tiny buffer).
 */
export function haloBbox(
  lat: number,
  lon: number,
  radiusKm: number,
): { west: number; east: number; south: number; north: number } {
  const cosLat = Math.cos(lat * DEG_TO_RAD);
  const dLat = (radiusKm + 0.2) / KM_PER_DEG_LAT;
  const dLon = (radiusKm + 0.2) / (KM_PER_DEG_LAT * cosLat);
  return {
    west: lon - dLon,
    east: lon + dLon,
    south: lat - dLat,
    north: lat + dLat,
  };
}
