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
import { predictCesantesCanalization } from '../src/services/cesantesCanalizationDetector.js';
import { detectBocana } from '../src/services/bocanaDetector.js';
import type { BuoyReading } from '../src/api/buoyClient.js';

// Climatological monthly SST fallback for Ría de Vigo interior (matches
// frontend spotScoringEngine.ts — single source of truth would be nicer
// but the array values are static climatology, no drift risk).
const RIA_VIGO_INTERIOR_SST_BY_MONTH = [13, 13, 13, 14, 16, 18, 20, 21, 20, 18, 16, 14];

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
  // Extended fields for detector connection (Phase A — TIER 1 P0)
  dew_point?: number | null;
  solar_rad?: number | null;
  pressure?: number | null;
}

export interface BuoyWind {
  station_id: number;
  wind_speed: number;
  wind_dir: number | null;
  lat: number;
  lon: number;
  // Extended fields for detector connection (Phase A — TIER 1 P0)
  station_name?: string;
  water_temp?: number | null;
  air_temp?: number | null;
  humidity?: number | null;
  wave_height?: number | null;
  wave_period?: number | null;
  wave_dir?: number | null;
}

export interface SpotResult {
  spot: SpotDef;
  /** Wind in knots — may have been BOOSTED by detector (canalization/bocana).
   *  Raw measured average is preserved in `rawWindKt`. */
  avgWindKt: number;
  maxGustKt: number;
  avgDir: number | null;
  verdict: Verdict;
  stationCount: number;
  /** Inferred direction for spots without vane (e.g. Castrelo SkyX) */
  inferredDir?: string | null;
  /** Raw measured wind average BEFORE detector overrides (for debug + accuracy tracking) */
  rawWindKt?: number;
  /** Detector that boosted the verdict, if any. 'cesantes-canalization' | 'bocana-terral' | null */
  boostedBy?: 'cesantes-canalization' | 'bocana-terral' | null;
  /** Detector confidence 0-100% (when boostedBy set) */
  boostConfidence?: number;
}

// ── Adapter: ingestor BuoyWind → frontend BuoyReading ────────
//
// Frontend detectors (canalization, bocana) consume the BuoyReading shape
// from src/api/buoyClient. Our DB row shape is BuoyWind. The two largely
// overlap but use different field names (snake_case vs camelCase) and
// BuoyReading has more strictly-typed fields. This converter bridges them.
export function buoyWindToBuoyReading(b: BuoyWind): BuoyReading {
  return {
    stationId: b.station_id,
    stationName: b.station_name ?? `Boya ${b.station_id}`,
    timestamp: new Date().toISOString(),
    waveHeight: b.wave_height ?? null,
    waveHeightMax: null,
    wavePeriod: b.wave_period ?? null,
    wavePeriodMean: null,
    waveDir: b.wave_dir ?? null,
    windSpeed: b.wind_speed > 0 ? b.wind_speed : null,
    windDir: b.wind_dir,
    windGust: null,
    waterTemp: b.water_temp ?? null,
    airTemp: b.air_temp ?? null,
    airPressure: null,
    currentSpeed: null,
    currentDir: null,
    salinity: null,
    seaLevel: null,
    humidity: b.humidity ?? null,
    dewPoint: null,
  };
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

// ── Detector boost helpers ───────────────────────────
//
// Connect-from-frontend pattern (Phase B TIER 1 P0): the analyzer used to
// compute verdicts from RAW wind consensus only. That meant Cesantes (sheltered
// behind Monte Costa da Vela) and Bocana (NE terral 6-11h) NEVER reached the
// 'good'/'sailing' threshold even when the actual sailable wind in the spot
// was 14-18kt. Telegram alerts therefore stayed silent on the most interesting
// session windows. We now wrap scoreSpot with detector overrides that mirror
// what SpotPopup does on the frontend (which is the authoritative scorer).

/**
 * Compute mouth-of-ría humidity from station readings (mirror of
 * `computeMouthHumidity` in cesantesCanalizationDetector.ts but operating on
 * our DB row shape — frontend version needs NormalizedStation + Map).
 *
 * Mouth = stations near Vigo bay entrance (lon < -8.78, lat 42.15-42.30),
 * 75th percentile is used (robust to interior dry leaking in).
 */
function computeMouthHumidityFromRows(readings: StationReading[]): number | null {
  const mouth: number[] = [];
  for (const r of readings) {
    if (r.longitude > -8.78 || r.latitude < 42.15 || r.latitude > 42.30) continue;
    if (r.humidity == null) continue;
    mouth.push(r.humidity);
  }
  if (mouth.length === 0) return null;
  const sorted = [...mouth].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75));
  return sorted[idx];
}

/**
 * Apply Cesantes canalization override to a raw verdict.
 * Returns boosted wind kt + signal info, or null if not applicable.
 *
 * Matches frontend gate exactly:
 *   - spot.id === 'cesantes'
 *   - prediction.active && predictedKt !== null
 *   - prediction.confidence >= 70
 *   - (predictedKt - rawKt) >= 4
 */
function applyCesantesBoost(
  rawKt: number,
  readings: StationReading[],
  buoys: BuoyWind[],
): { effectiveKt: number; confidence: number; predictedDir: number | null } | null {
  // Compute mouth humidity from interior station readings
  const mouthHumidity = computeMouthHumidityFromRows(readings);

  // Find airTemp near Cesantes (nearest station with temperature, sorted by distance)
  const cesantesLat = 42.307, cesantesLon = -8.619;
  const stationsWithTemp = readings
    .filter(r => r.temperature != null && r.latitude !== 0 && r.longitude !== 0)
    .map(r => ({ r, d: haversineDistance(cesantesLat, cesantesLon, r.latitude, r.longitude) }))
    .sort((a, b) => a.d - b.d);
  const airTempLocal = stationsWithTemp[0]?.r.temperature ?? null;

  // Find waterTemp from nearby buoy or climatology fallback
  // (matches frontend RIA_VIGO_INTERIOR_SST_BY_MONTH pattern)
  const nearbyBuoyWithSST = buoys.find(b =>
    b.water_temp != null && haversineDistance(cesantesLat, cesantesLon, b.lat, b.lon) <= 15
  );
  const summerLike = airTempLocal !== null && airTempLocal >= 20;
  const waterTemp = nearbyBuoyWithSST?.water_temp
    ?? (summerLike ? RIA_VIGO_INTERIOR_SST_BY_MONTH[new Date().getMonth()] : null);

  // Convert ingestor buoys to frontend BuoyReading shape
  const buoyReadings = buoys.map(buoyWindToBuoyReading);

  const prediction = predictCesantesCanalization(
    buoyReadings,
    mouthHumidity,
    false, // no webcam vision in ingestor (frontend-only feature)
    airTempLocal,
    waterTemp,
    rawKt, // localStationKt — used in thermal-only mode as base
  );

  if (!prediction.active || prediction.predictedKt === null) return null;
  if (prediction.confidence < 70) return null;
  if (prediction.predictedKt - rawKt < 4) return null;

  return {
    effectiveKt: prediction.predictedKt,
    confidence: prediction.confidence,
    predictedDir: prediction.predictedDir,
  };
}

/**
 * Apply Bocana (NE terral matinal 6-11h) boost to a raw verdict.
 * Returns boosted wind kt + signal info, or null if not applicable.
 */
function applyBocanaBoost(
  rawKt: number,
  readings: StationReading[],
  buoys: BuoyWind[],
): { effectiveKt: number; confidence: number; signal: string } | null {
  // Find solar reading from nearest station with solar_rad (for cloud gating)
  const bocanaLat = 42.268, bocanaLon = -8.714;
  const nearestSolar = readings
    .filter(r => r.solar_rad != null && r.latitude !== 0 && r.longitude !== 0)
    .map(r => ({ r, d: haversineDistance(bocanaLat, bocanaLon, r.latitude, r.longitude) }))
    .sort((a, b) => a.d - b.d)[0]?.r;
  const solarRad = nearestSolar?.solar_rad ?? null;

  const buoyReadings = buoys.map(buoyWindToBuoyReading);
  const signal = detectBocana(buoyReadings, solarRad);
  if (!signal.active || signal.confidence < 40) return null;

  return {
    effectiveKt: rawKt + signal.boostKt,
    confidence: signal.confidence,
    signal: signal.signal ?? 'Terral matinal detectado',
  };
}

// ── scoreSpot ───────────────────────────────────────

/**
 * Score a spot based on nearby station wind consensus.
 * Filters stations by distance to spot (radiusKm).
 * Matches frontend spotScoringEngine logic INCLUDING detector overrides
 * (Cesantes canalization + Bocana terral matinal — Phase B TIER 1 P0).
 *
 * NB: surf spots (`surf-*` IDs in frontend `spots.ts`) are NOT in the
 * ingestor SPOTS array — only sailing/thermal sailing spots get Telegram
 * verdicts (wind verdict is meaningless for waves). No skip-list needed.
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
    b.lat !== 0 && b.lon !== 0 && b.wind_speed > 0 &&
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

  const rawWindKt = Math.round(windSum / count);
  const avgDir = dirCount > 0
    ? (Math.round(Math.atan2(sinSum / dirCount, cosSum / dirCount) * 180 / Math.PI) + 360) % 360
    : null;

  // ── Apply detector overrides ──
  let effectiveKt = rawWindKt;
  let boostedBy: 'cesantes-canalization' | 'bocana-terral' | null = null;
  let boostConfidence: number | undefined;

  if (spot.id === 'cesantes') {
    const boost = applyCesantesBoost(rawWindKt, readings, buoyWinds);
    if (boost) {
      effectiveKt = boost.effectiveKt;
      boostedBy = 'cesantes-canalization';
      boostConfidence = boost.confidence;
    }
  } else if (spot.id === 'bocana') {
    const boost = applyBocanaBoost(rawWindKt, readings, buoyWinds);
    if (boost) {
      effectiveKt = boost.effectiveKt;
      boostedBy = 'bocana-terral';
      boostConfidence = boost.confidence;
    }
  }

  const verdict = windVerdict(effectiveKt, spot.id);

  let inferredDir: string | null = null;
  if (avgDir === null && rawWindKt >= 3 && spot.id === 'castrelo') {
    inferredDir = inferCastreloDirection(readings);
  }

  return {
    spot,
    avgWindKt: effectiveKt,
    maxGustKt: Math.round(gustMax),
    avgDir,
    verdict,
    stationCount: count,
    inferredDir,
    rawWindKt,
    boostedBy,
    boostConfidence,
  };
}
