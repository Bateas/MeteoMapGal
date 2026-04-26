/**
 * Pure scoring/inference logic extracted from analyzer.ts.
 *
 * No DB, no I/O — testable in isolation. Imported by analyzer.ts which
 * adds DB queries + alert dispatch around these primitives.
 *
 * Used by `analyzerLogic.test.ts` to cover the 24/7 Telegram pipeline
 * without spinning up TimescaleDB.
 */

import { haversineDistance } from '../src/services/geoUtils.js';
import { msToKnots, degreesToCardinal } from '../src/services/windUtils.js';

// ── Types ───────────────────────────────────────────

export interface SpotDef {
  id: string;
  name: string;
  lat: number;
  lon: number;
  sector: 'embalse' | 'rias';
  radiusKm: number;
  thermalDetection: boolean;
}

export type Verdict = 'calm' | 'light' | 'sailing' | 'good' | 'strong' | 'unknown';

export interface StationReading {
  station_id: string;
  latitude: number;
  longitude: number;
  wind_speed: number | null;
  wind_gust: number | null;
  wind_dir: number | null;
  temperature: number | null;
  humidity: number | null;
}

export interface BuoyWind {
  station_id: number;
  wind_speed: number;
  wind_dir: number | null;
  lat: number;
  lon: number;
}

export interface SpotResult {
  spot: SpotDef;
  avgWindKt: number;
  maxGustKt: number;
  avgDir: number | null;
  verdict: Verdict;
  stationCount: number;
  /** Inferred direction for spots without vane (e.g. Castrelo SkyX) */
  inferredDir?: string | null;
}

// ── Constants ───────────────────────────────────────

export const VERDICT_LABEL: Record<Verdict, string> = {
  calm: 'CALMA', light: 'FLOJO', sailing: 'NAVEGABLE',
  good: 'BUENO', strong: 'FUERTE', unknown: 'SIN DATOS',
};

export const ALERT_VERDICTS: Set<Verdict> = new Set(['sailing', 'good', 'strong']);
export const LOW_VERDICTS: Set<Verdict> = new Set(['calm', 'light', 'unknown']);

// ── windVerdict ─────────────────────────────────────

/**
 * Match frontend spotScoringEngine thresholds exactly.
 * Cies-Ria uses ocean thresholds (higher), all others use ria/embalse.
 */
export function windVerdict(avgKt: number, spotId: string): Verdict {
  const kt = Math.round(avgKt);
  if (spotId === 'cies-ria') {
    if (kt < 5) return 'calm';
    if (kt < 10) return 'light';
    if (kt < 14) return 'sailing';
    if (kt < 18) return 'good';
    return 'strong';
  }
  if (kt < 6) return 'calm';
  if (kt < 8) return 'light';
  if (kt < 12) return 'sailing';
  if (kt < 18) return 'good';
  return 'strong';
}

// ── inferCastreloDirection ──────────────────────────

/**
 * Infer wind direction for Castrelo when SkyX has no vane.
 * Uses nearby stations with direction (AEMET Ribadavia, MG stations)
 * + time-of-day heuristic (14-18h sunny = likely SW thermal).
 */
export function inferCastreloDirection(readings: StationReading[]): string | null {
  const castreloLat = 42.2991, castreloLon = -8.1087;
  const nearby = readings.filter(r =>
    r.wind_dir != null && r.wind_speed != null && r.wind_speed > 1.0 &&
    r.latitude !== 0 && r.longitude !== 0 &&
    haversineDistance(castreloLat, castreloLon, r.latitude, r.longitude) <= 15
  );

  if (nearby.length === 0) return null;

  let sinSum = 0, cosSum = 0;
  for (const r of nearby) {
    const rad = r.wind_dir! * Math.PI / 180;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }
  const avgDeg = (Math.round(Math.atan2(sinSum / nearby.length, cosSum / nearby.length) * 180 / Math.PI) + 360) % 360;
  const cardinal = degreesToCardinal(avgDeg);

  const hour = new Date().getHours();
  const isSWish = avgDeg >= 200 && avgDeg <= 280;
  const isAfternoon = hour >= 13 && hour <= 19;

  if (isSWish && isAfternoon) {
    return `${cardinal} (termico probable)`;
  }

  return cardinal;
}

// ── scoreSpot ───────────────────────────────────────

/**
 * Score a spot based on nearby station wind consensus.
 * Filters stations by distance to spot (radiusKm).
 * Matches frontend spotScoringEngine logic.
 */
export function scoreSpot(spot: SpotDef, readings: StationReading[], buoyWinds: BuoyWind[]): SpotResult {
  const nearby = readings.filter(r =>
    r.latitude !== 0 && r.longitude !== 0 &&
    haversineDistance(spot.lat, spot.lon, r.latitude, r.longitude) <= spot.radiusKm
  );

  let windSum = 0, gustMax = 0, dirCount = 0, count = 0;
  let sinSum = 0, cosSum = 0;

  for (const r of nearby) {
    if (r.wind_speed != null) {
      const kt = msToKnots(r.wind_speed);
      windSum += kt;
      count++;
      if (r.wind_gust != null) {
        const gKt = msToKnots(r.wind_gust);
        if (gKt > gustMax) gustMax = gKt;
      }
      if (r.wind_dir != null) {
        const rad = r.wind_dir * Math.PI / 180;
        sinSum += Math.sin(rad);
        cosSum += Math.cos(rad);
        dirCount++;
      }
    }
  }

  const nearbyBuoys = buoyWinds.filter(b =>
    b.lat !== 0 && b.lon !== 0 &&
    haversineDistance(spot.lat, spot.lon, b.lat, b.lon) <= spot.radiusKm
  );
  for (const b of nearbyBuoys) {
    const kt = msToKnots(b.wind_speed);
    windSum += kt;
    count++;
    if (b.wind_dir != null) {
      const rad = b.wind_dir * Math.PI / 180;
      sinSum += Math.sin(rad);
      cosSum += Math.cos(rad);
      dirCount++;
    }
  }

  if (count === 0) {
    return { spot, avgWindKt: 0, maxGustKt: 0, avgDir: null, verdict: 'unknown', stationCount: 0 };
  }

  const avgWindKt = Math.round(windSum / count);
  const avgDir = dirCount > 0
    ? (Math.round(Math.atan2(sinSum / dirCount, cosSum / dirCount) * 180 / Math.PI) + 360) % 360
    : null;
  const verdict = windVerdict(avgWindKt, spot.id);

  let inferredDir: string | null = null;
  if (avgDir === null && avgWindKt >= 3 && spot.id === 'castrelo') {
    inferredDir = inferCastreloDirection(readings);
  }

  return { spot, avgWindKt, maxGustKt: Math.round(gustMax), avgDir, verdict, stationCount: count, inferredDir };
}
