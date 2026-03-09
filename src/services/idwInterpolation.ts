import type { NormalizedStation, NormalizedReading } from '../types/station';

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
}

export interface StationScalarData {
  lat: number;
  lon: number;
  value: number;
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
  power = 2,
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

    const w = 1 / Math.pow(d, power);
    const v = windToVector(s.speed, s.dirDeg);
    vxSum += w * v.vx;
    vySum += w * v.vy;
    weightSum += w;
  }

  const vx = vxSum / weightSum;
  const vy = vySum / weightSum;
  const speed = Math.sqrt(vx * vx + vy * vy);

  return { vx, vy, speed };
}

/**
 * Interpolate a scalar value (e.g., humidity %) at (lat, lon) using IDW.
 */
export function interpolateScalar(
  lat: number,
  lon: number,
  stations: StationScalarData[],
  power = 2,
): number {
  if (stations.length === 0) return 0;

  let weightSum = 0;
  let valueSum = 0;

  for (const s of stations) {
    const d = fastDistanceKm(lat, lon, s.lat, s.lon);

    if (d < 0.05) return s.value;

    const w = 1 / Math.pow(d, power);
    valueSum += w * s.value;
    weightSum += w;
  }

  return valueSum / weightSum;
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

// ── Helper: extract wind data from store ───────────────────

/** Build StationWindData[] from stations + readings for IDW wind interpolation */
export function extractWindData(
  stations: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
): StationWindData[] {
  const result: StationWindData[] = [];
  for (const station of stations) {
    if (station.tempOnly) continue;
    const reading = readings.get(station.id);
    if (!reading || reading.windSpeed === null || reading.windDirection === null) continue;
    if (reading.windSpeed < 0.1) continue; // skip truly calm (< 0.1 m/s)
    result.push({
      lat: station.lat,
      lon: station.lon,
      speed: reading.windSpeed,
      dirDeg: reading.windDirection,
    });
  }
  return result;
}

/** Build StationScalarData[] for humidity IDW interpolation */
export function extractHumidityData(
  stations: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
): StationScalarData[] {
  const result: StationScalarData[] = [];
  for (const station of stations) {
    const reading = readings.get(station.id);
    if (!reading || reading.humidity === null) continue;
    result.push({
      lat: station.lat,
      lon: station.lon,
      value: reading.humidity,
    });
  }
  return result;
}
