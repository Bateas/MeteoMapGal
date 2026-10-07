import type { NormalizedStation, NormalizedReading } from '../types/station';
import type { BuoyReading } from '../api/buoyClient';
import { BUOY_COORDS_MAP } from '../api/buoyClient';
import { STALE_THRESHOLD_MIN } from '../config/constants';
import { isWindBlacklisted } from './spotScoringEngine';
import { isLandStationCopy } from './buoyUtils';

// ── Types ──────────────────────────────────────────────────

export interface WindVector {
  vx: number; // east component (m/s)
  vy: number; // north component (m/s)
  speed: number; // magnitude (m/s)
}

export interface StationWindData {
  lat: number;
  lon: number;
  speed: number; // m/s
  dirDeg: number; // meteorological "from" direction
  /** Weight multiplier: freshness (recent=1.0, older=decayed), times the station's measured
   *  exposure, or the buoys' extra weight. Default 1.0 */
  freshness?: number;
}

/** Measured exposure of a land station (station_calibration, via /api/v1/stations/exposure):
 *  the share of the free stream it reads, overall and per 45° sector of the free stream's
 *  direction (index 0 = N … 7 = NW, null where the sector lacked hours). */
export interface StationExposure {
  ratio: number | null;
  sectors: (number | null)[];
}
export type StationExposureMap = Map<string, StationExposure>;

/** Extra weight of a buoy over the water in the arrows' field. */
export const BUOY_FIELD_WEIGHT = 3;

/**
 * Weight of a land station in the arrows' field from its measured exposure in the free stream's
 * direction: (ratio / 0.6)², capped at 1 and floored at 0.05. No measurement = 1, as before.
 *
 * Measured 22-sep..7-oct on 448 buoy-hours, each buoy left out and predicted by the field built
 * from everything else: with the buoys at BUOY_FIELD_WEIGHT the error over the water drops from
 * 7.3 to 6.8 kt and the field stops being ~5 kt short by half a knot. Most of that shortfall
 * stays — the field is still built from land — but the sheltered gardens that painted calm and
 * crossed arrows next to an exposed station stop deciding it.
 */
export function exposureWeight(exposure: StationExposure | undefined, dirDeg: number | null): number {
  if (!exposure) return 1;
  const sector = dirDeg == null ? null : exposure.sectors[Math.round((((dirDeg % 360) + 360) % 360) / 45) % 8];
  const r = sector ?? exposure.ratio;
  if (r == null || !Number.isFinite(r)) return 1;
  return Math.max(0.05, Math.min(1, (r / 0.6) ** 2));
}

// ── Fast distance approximation ────────────────────────────
// Uses equirectangular approximation — accurate enough at local scale (~50km)
// ~100x faster than full haversine for tight loops

const DEG_TO_RAD = Math.PI / 180;
const EARTH_R_KM = 6371;

/** Approximate distance in km between two lat/lon points (equirectangular) */
export function fastDistanceKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD * Math.cos(((lat1 + lat2) / 2) * DEG_TO_RAD);
  return Math.sqrt(dLat * dLat + dLon * dLon) * EARTH_R_KM;
}

/** Compute bearing between two points in degrees (0 = North, 90 = East) */
export function computeBearing(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const y = Math.sin(dLon) * Math.cos(lat2 * DEG_TO_RAD);
  const x =
    Math.cos(lat1 * DEG_TO_RAD) * Math.sin(lat2 * DEG_TO_RAD) -
    Math.sin(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// ── Wind decomposition ─────────────────────────────────────

/** Decompose meteorological wind (speed + "from" direction) into vector components */
export function windToVector(speed: number, dirDeg: number): { vx: number; vy: number } {
  // Meteorological "from" → add 180° to get "to" direction
  const toRad = ((dirDeg + 180) % 360) * DEG_TO_RAD;
  return {
    vx: speed * Math.sin(toRad), // east component
    vy: speed * Math.cos(toRad), // north component
  };
}

// ── IDW interpolation core ─────────────────────────────────

/**
 * Interpolate wind vector at (lat, lon) using Inverse Distance Weighting.
 * Uses vector decomposition to avoid directional averaging issues.
 */
export function interpolateWind(
  lat: number,
  lon: number,
  stations: StationWindData[],
  power = 2.5,
  maxRadiusKm = 25,
): WindVector {
  if (stations.length === 0) return { vx: 0, vy: 0, speed: 0 };

  let weightSum = 0;
  let vxSum = 0;
  let vySum = 0;

  for (const s of stations) {
    const d = fastDistanceKm(lat, lon, s.lat, s.lon);

    // If practically on top of a station, return its value directly
    if (d < 0.05) {
      const v = windToVector(s.speed, s.dirDeg);
      return { vx: v.vx, vy: v.vy, speed: s.speed };
    }

    // Skip stations beyond max influence radius — prevents distant calm
    // inland stations from "pulling down" interpolation over open water
    if (d > maxRadiusKm) continue;

    const w = (1 / Math.pow(d, power)) * (s.freshness ?? 1.0);
    const v = windToVector(s.speed, s.dirDeg);
    vxSum += w * v.vx;
    vySum += w * v.vy;
    weightSum += w;
  }

  if (weightSum === 0) return { vx: 0, vy: 0, speed: 0 };

  const vx = vxSum / weightSum;
  const vy = vySum / weightSum;
  const speed = Math.sqrt(vx * vx + vy * vy);

  return { vx, vy, speed };
}

// ── Pre-computed wind grid ─────────────────────────────────
// Instead of per-particle IDW (O(particles × stations) per frame), pre-compute
// a grid once when data/viewport changes, then do O(1) bilinear lookups.
// At 400 particles × 60fps × 40 stations = ~960K distance calcs/sec → eliminated.

export interface WindGrid {
  /** Geographic bounds of the grid */
  w: number; e: number; s: number; n: number;
  /** Grid dimensions */
  cols: number;
  rows: number;
  /** Cell size in degrees */
  cellW: number;
  cellH: number;
  /** Flat array of pre-computed wind vectors [row * cols + col] */
  cells: WindVector[];
}

/**
 * Build a pre-computed wind grid covering the given geographic bounds.
 * Each grid cell stores the IDW-interpolated wind vector at its center.
 *
 * @param bounds Map viewport bounds (with small padding)
 * @param stations Station wind data for IDW interpolation
 * @param cols Grid columns (default 24 — ~2km resolution at 50km viewport)
 * @param rows Grid rows (default 24)
 * @returns WindGrid for fast bilinear lookups
 */
export function buildWindGrid(
  bounds: { w: number; e: number; s: number; n: number },
  stations: StationWindData[],
  cols = 24,
  rows = 24,
): WindGrid {
  const cellW = (bounds.e - bounds.w) / cols;
  const cellH = (bounds.n - bounds.s) / rows;
  const cells = new Array<WindVector>(cols * rows);

  for (let r = 0; r < rows; r++) {
    const lat = bounds.s + (r + 0.5) * cellH;
    for (let c = 0; c < cols; c++) {
      const lon = bounds.w + (c + 0.5) * cellW;
      cells[r * cols + c] = interpolateWind(lat, lon, stations);
    }
  }

  return { w: bounds.w, e: bounds.e, s: bounds.s, n: bounds.n, cols, rows, cellW, cellH, cells };
}

/**
 * Fast bilinear wind lookup in pre-computed grid — O(1) per particle.
 * Replaces per-particle IDW which was O(stations) per particle.
 */
export function lookupWindGrid(grid: WindGrid, lat: number, lon: number): WindVector {
  // Continuous grid coordinates
  const fc = (lon - grid.w) / grid.cellW - 0.5;
  const fr = (lat - grid.s) / grid.cellH - 0.5;

  // Integer cell indices (clamped)
  const c0 = Math.max(0, Math.min(grid.cols - 2, Math.floor(fc)));
  const r0 = Math.max(0, Math.min(grid.rows - 2, Math.floor(fr)));
  const c1 = c0 + 1;
  const r1 = r0 + 1;

  // Fractional position within cell
  const fx = Math.max(0, Math.min(1, fc - c0));
  const fy = Math.max(0, Math.min(1, fr - r0));

  // Four corner values
  const q00 = grid.cells[r0 * grid.cols + c0];
  const q10 = grid.cells[r0 * grid.cols + c1];
  const q01 = grid.cells[r1 * grid.cols + c0];
  const q11 = grid.cells[r1 * grid.cols + c1];

  // Bilinear interpolation
  const vx = q00.vx * (1 - fx) * (1 - fy)
           + q10.vx * fx * (1 - fy)
           + q01.vx * (1 - fx) * fy
           + q11.vx * fx * fy;

  const vy = q00.vy * (1 - fx) * (1 - fy)
           + q10.vy * fx * (1 - fy)
           + q01.vy * (1 - fx) * fy
           + q11.vy * fx * fy;

  const speed = Math.sqrt(vx * vx + vy * vy);

  return { vx, vy, speed };
}

// ── Helper: freshness decay ──────────────────────────────────
// Gradual decay instead of binary cutoff — recent readings contribute more

/** Compute freshness multiplier (0.5–1.0) from reading age in minutes */
function freshnessDecay(ageMin: number): number {
  if (ageMin <= 5) return 1.0;     // just updated
  if (ageMin <= 10) return 0.95;   // normal interval
  if (ageMin <= 20) return 0.85;   // slightly behind
  return 0.7;                       // approaching stale threshold
}

// ── Helper: extract wind data from store ───────────────────

/** Build StationWindData[] from stations + readings for IDW wind interpolation.
 *  Filters out stale readings (>STALE_THRESHOLD_MIN) and applies freshness decay
 *  so recently-updated stations contribute more to interpolation. With `exposure`,
 *  each station also weighs by its measured exposure in the direction of `freeDir`
 *  (the buoys' wind; the station's own reading when there is none). */
export function extractWindData(
  stations: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
  exposure?: StationExposureMap,
  freeDir?: number | null,
): StationWindData[] {
  const result: StationWindData[] = [];
  const maxAgeMs = STALE_THRESHOLD_MIN * 60_000;
  const now = Date.now();
  for (const station of stations) {
    if (station.tempOnly) continue;
    if (isWindBlacklisted(station.id)) continue; // sheltered/broken → contaminate IDW
    const reading = readings.get(station.id);
    if (!reading || reading.windSpeed === null || reading.windDirection === null) continue;
    if (reading.windSpeed < 0.1) continue; // skip truly calm (< 0.1 m/s)
    const readingTime = reading.timestamp instanceof Date
      ? reading.timestamp.getTime()
      : typeof reading.timestamp === 'string'
        ? new Date(reading.timestamp).getTime()
        : 0;
    if (readingTime <= 0) continue;
    const ageMs = now - readingTime;
    if (ageMs > maxAgeMs) continue; // skip stale
    result.push({
      lat: station.lat,
      lon: station.lon,
      speed: reading.windSpeed,
      dirDeg: reading.windDirection,
      freshness: freshnessDecay(ageMs / 60_000)
        * exposureWeight(exposure?.get(station.id), freeDir ?? reading.windDirection),
    });
  }
  return result;
}

/** Extract wind data from marine buoy readings for IDW wind interpolation. A PORTUS copy of a
 *  land anemometer is not a sensor over the water (and the land station is already in). */
export function extractBuoyWindData(buoys: BuoyReading[], weight = 1): StationWindData[] {
  const result: StationWindData[] = [];
  for (const b of buoys) {
    if (b.windSpeed == null || b.windDir == null) continue;
    if (isLandStationCopy(b.stationId)) continue;
    if (b.windSpeed < 0.1) continue;
    const coords = BUOY_COORDS_MAP.get(b.stationId);
    if (!coords) continue;
    result.push({
      lat: coords.lat,
      lon: coords.lon,
      speed: b.windSpeed,
      dirDeg: b.windDir,
      freshness: weight,
    });
  }
  return result;
}
