/**
 * Smoke plume generator — fan-shaped polygon downwind of an active fire.
 *
 * Pure geometry. Inputs: fire location + intensity (FRP), wind from nearest
 * station. Output: GeoJSON polygon to render as a translucent grey-brown
 * fan over the map.
 *
 * Length scales with FRP (1MW = 3km tail, ≥100MW = 15km tail). Width is a
 * 35° fan angle (typical plume dispersion). Opacity gradient handled by
 * the renderer (paint expression).
 *
 * Wind direction convention: meteorological "from" — i.e. windDirDeg = 270
 * means "wind blowing FROM 270° = westerly". The plume drifts toward the
 * opposite bearing (270° + 180° = 90° east).
 */

import type { ActiveFire } from '../types/fire';
import { fastDistanceKm } from './idwInterpolation';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
/** ~111 km per degree latitude */
const KM_PER_DEG_LAT = 111;

const FAN_ANGLE_DEG = 35;
/** Number of arc samples per fan side — higher = smoother, more vertices */
const ARC_SAMPLES = 6;

export interface SmokePlume {
  fireId: string;
  /** GeoJSON Polygon coordinates: [[[lon,lat], ...]] */
  polygon: number[][][];
  /** Length in km (informational) */
  lengthKm: number;
  /** "to" bearing — direction the plume drifts toward */
  bearingTo: number;
}

/** Find the wind reading nearest a fire (within `maxKm`), returning null if none */
export function nearestWindFromStations(
  lat: number,
  lon: number,
  stations: { lat: number; lon: number; windDirDeg: number | null; windKt: number | null }[],
  maxKm = 80,
): { dirDeg: number; speedKt: number; distKm: number } | null {
  let best: { dirDeg: number; speedKt: number; distKm: number } | null = null;
  for (const s of stations) {
    if (s.windDirDeg == null || s.windKt == null || s.windKt < 1) continue;
    const d = fastDistanceKm(lat, lon, s.lat, s.lon);
    if (d > maxKm) continue;
    if (!best || d < best.distKm) {
      best = { dirDeg: s.windDirDeg, speedKt: s.windKt, distKm: d };
    }
  }
  return best;
}

/**
 * Plume length (km) as a function of fire intensity (MW).
 * Logarithmic-ish scaling: 1MW → 3km, 10MW → 6km, 100MW → 12km, 500MW → 15km.
 */
export function plumeLengthKm(frp: number): number {
  if (!Number.isFinite(frp) || frp <= 0) return 3;
  return Math.max(3, Math.min(15, 3 + Math.log10(Math.max(1, frp)) * 4));
}

/**
 * Build a fan polygon downwind of `(originLat, originLon)`.
 * `bearingTo` is in degrees (0 = North, 90 = East) — direction smoke drifts.
 */
export function buildPlumePolygon(
  originLat: number,
  originLon: number,
  bearingTo: number,
  lengthKm: number,
  fanAngleDeg = FAN_ANGLE_DEG,
): number[][][] {
  const halfFan = fanAngleDeg / 2;
  const cosLat = Math.cos(originLat * DEG_TO_RAD);
  const kmPerDegLon = KM_PER_DEG_LAT * cosLat;

  // Start with origin, then sweep an arc on the far edge
  const ring: number[][] = [[originLon, originLat]];

  // Sweep from (bearingTo - halfFan) to (bearingTo + halfFan)
  for (let i = 0; i <= ARC_SAMPLES; i++) {
    const t = i / ARC_SAMPLES;
    const angle = bearingTo - halfFan + t * fanAngleDeg;
    const a = angle * DEG_TO_RAD;
    const dy = Math.cos(a) * lengthKm; // North component
    const dx = Math.sin(a) * lengthKm; // East component
    const lat = originLat + dy / KM_PER_DEG_LAT;
    const lon = originLon + dx / kmPerDegLon;
    ring.push([lon, lat]);
  }

  // Close polygon back to origin
  ring.push([originLon, originLat]);

  return [ring];
}

/**
 * Build a plume for one fire given its ActiveFire record + a wind sample.
 * Returns null if wind speed is too low (<2kt) — no meaningful plume.
 */
export function buildPlume(
  fire: ActiveFire,
  wind: { dirDeg: number; speedKt: number },
): SmokePlume | null {
  if (wind.speedKt < 2) return null; // calm air → no directed plume

  // "from" → "to" direction (180° flip), normalized 0-360
  const bearingTo = (wind.dirDeg + 180) % 360;
  const lengthKm = plumeLengthKm(fire.frp);
  const polygon = buildPlumePolygon(fire.lat, fire.lon, bearingTo, lengthKm);

  return {
    fireId: fire.id,
    polygon,
    lengthKm,
    bearingTo,
  };
}

/**
 * Build plumes for all active fires using nearest-station wind.
 * Filters out fires with no usable wind sample within range.
 */
export function buildAllPlumes(
  fires: ActiveFire[],
  windStations: { lat: number; lon: number; windDirDeg: number | null; windKt: number | null }[],
): SmokePlume[] {
  const out: SmokePlume[] = [];
  for (const fire of fires) {
    const wind = nearestWindFromStations(fire.lat, fire.lon, windStations);
    if (!wind) continue;
    const plume = buildPlume(fire, wind);
    if (plume) out.push(plume);
  }
  return out;
}

/**
 * Derive a [lon, lat] approximate impact point — the centroid of the plume's
 * far arc. Useful for cross-feeding HazeOverlay / smoke alerts.
 */
export function plumeImpactPoint(plume: SmokePlume): [number, number] {
  // Polygon ring is [origin, ...arc samples..., origin]. Far arc midpoint
  // = ring[ARC_SAMPLES/2 + 1] approximately. Average all non-origin samples.
  const ring = plume.polygon[0];
  let sumLon = 0, sumLat = 0, count = 0;
  for (let i = 1; i < ring.length - 1; i++) {
    sumLon += ring[i][0];
    sumLat += ring[i][1];
    count++;
  }
  return [sumLon / count, sumLat / count];
}
