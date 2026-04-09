/**
 * Wave Exposure Engine — Classifies coastline segments by exposure to swell.
 *
 * For each coastline segment:
 *   1. Compute outward normal bearing (perpendicular to segment, pointing seaward)
 *   2. Compare with current swell direction from buoys
 *   3. Classify: exposed (<30°), moderate (30-75°), sheltered (>75°)
 *
 * Uses OSM coastline vectors (38,712 points) for accurate coast geometry.
 * Pure computation — no React, no stores, no API calls.
 */

import type { BuoyReading } from '../api/buoyClient';

// ── Types ────────────────────────────────────────────

export type ExposureLevel = 'exposed' | 'moderate' | 'sheltered';

export interface ExposureConfig {
  /** Swell direction in degrees (meteorological: direction waves come FROM) */
  swellDir: number;
  /** Significant wave height in meters */
  waveHeight: number;
}

// ── Constants ────────────────────────────────────────

/** Angle thresholds (degrees between coast normal and swell direction) */
const EXPOSED_MAX_ANGLE = 30;
const MODERATE_MAX_ANGLE = 75;

/** Colors per exposure level */
export const EXPOSURE_COLORS: Record<ExposureLevel, string> = {
  exposed:   '#ef4444',  // red-500 — direct swell impact
  moderate:  '#eab308',  // yellow-500 — partial exposure
  sheltered: '#22d3ee',  // cyan-400 — protected
};

/** Line width scaled by wave height (meters) */
export function widthForWaveHeight(h: number): number {
  if (h < 0.3) return 1.5;
  if (h < 0.8) return 2;
  if (h < 1.5) return 3;
  if (h < 2.5) return 4;
  return 5.5;
}

/** Glow blur scaled by wave height */
export function blurForWaveHeight(h: number): number {
  if (h < 0.3) return 0;
  if (h < 0.8) return 2;
  if (h < 1.5) return 4;
  if (h < 2.5) return 8;
  return 12;
}

// ── Geometry helpers ─────────────────────────────────

/** Normalize angle to [0, 360) */
function normAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Smallest angle between two bearings (0-180) */
function angleDiff(a: number, b: number): number {
  const d = Math.abs(normAngle(a) - normAngle(b));
  return d > 180 ? 360 - d : d;
}

/**
 * Compute bearing from point A to point B (degrees, 0=N, clockwise).
 */
function bearing(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1R = lat1 * Math.PI / 180;
  const lat2R = lat2 * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLon);
  return normAngle(Math.atan2(y, x) * 180 / Math.PI);
}

/**
 * Compute the OUTWARD normal of a coastline segment.
 *
 * OSM coastlines follow the convention: water is on the LEFT side
 * when walking along the line. So the outward (seaward) normal
 * points LEFT = segment bearing - 90°.
 */
function outwardNormal(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const segBearing = bearing(lon1, lat1, lon2, lat2);
  // OSM convention: water on left → outward normal = bearing - 90°
  return normAngle(segBearing - 90);
}

// ── Main: classify coastline ─────────────────────────

/**
 * Take raw coastline GeoJSON and classify each segment by wave exposure.
 * Returns a new FeatureCollection with per-segment properties:
 *   { exposure, color, angleDeg, normalBearing }
 */
export function classifyCoastlineExposure(
  coastline: GeoJSON.FeatureCollection,
  config: ExposureConfig,
): GeoJSON.FeatureCollection {
  const { swellDir, waveHeight } = config;
  const features: GeoJSON.Feature[] = [];

  for (const feature of coastline.features) {
    if (feature.geometry.type !== 'LineString') continue;
    const coords = feature.geometry.coordinates as [number, number][];
    if (coords.length < 2) continue;

    // Process each segment pair
    for (let i = 0; i < coords.length - 1; i++) {
      const [lon1, lat1] = coords[i];
      const [lon2, lat2] = coords[i + 1];

      const normal = outwardNormal(lon1, lat1, lon2, lat2);
      const angle = angleDiff(normal, swellDir);

      let exposure: ExposureLevel;
      if (angle <= EXPOSED_MAX_ANGLE) exposure = 'exposed';
      else if (angle <= MODERATE_MAX_ANGLE) exposure = 'moderate';
      else exposure = 'sheltered';

      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [[lon1, lat1], [lon2, lat2]],
        },
        properties: {
          exposure,
          color: EXPOSURE_COLORS[exposure],
          angleDeg: Math.round(angle),
          normalBearing: Math.round(normal),
        },
      });
    }
  }

  return { type: 'FeatureCollection', features };
}

// ── Buoy swell extraction ────────────────────────────

/**
 * Get dominant swell conditions from buoy array.
 * Uses the buoy with highest wave height as reference.
 */
export function getDominantSwell(buoys: BuoyReading[]): ExposureConfig | null {
  let best: BuoyReading | null = null;

  for (const b of buoys) {
    if (b.waveHeight == null || b.waveDir == null) continue;
    if (!best || (b.waveHeight ?? 0) > (best.waveHeight ?? 0)) {
      best = b;
    }
  }

  if (!best || best.waveDir == null || best.waveHeight == null) return null;

  return {
    swellDir: best.waveDir,
    waveHeight: best.waveHeight,
  };
}
