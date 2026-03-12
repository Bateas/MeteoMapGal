/**
 * Spot-based sailing scoring engine for Rías Baixas + Embalse.
 *
 * Each spot gets its own verdict based on:
 *   - Nearby station wind consensus (filtered by spot radius + preferred stations)
 *   - Buoy wave conditions (per-spot wave relevance)
 *   - Wind pattern recognition (thermal, nortada, virazón detection)
 *   - Safety hard gates (max wind, max wave height)
 *
 * 5-level verdict system calibrated to real sailing experience:
 *   calm    (<6kt)  — nobody sails
 *   light   (6-8kt) — marginal, not worth it
 *   sailing (8-12kt)— racers maybe, casual no
 *   good    (12-18kt)— good day for everyone
 *   strong  (18+kt) — experts only
 *
 * Philosophy: Coastal sailing decisions are WIND + WAVE. The key question
 * is "¿merece la pena preparar el barco?"
 */

import type { NormalizedStation, NormalizedReading } from '../types/station';
import type { BuoyReading } from '../api/buoyClient';
import { BUOY_COORDS_MAP } from '../api/buoyClient';
import type { SailingSpot, SpotId } from '../config/spots';
import { msToKnots, degToCardinal8, angleDifference } from './windUtils';
import { fastDistanceKm } from './idwInterpolation';

// ── Types ────────────────────────────────────────────────────

export type SpotVerdict = 'calm' | 'light' | 'sailing' | 'good' | 'strong' | 'unknown';

export interface SpotWindConsensus {
  stationCount: number;
  avgSpeedKt: number;
  dominantDir: string;
  /** Consensus wind direction in degrees (for arrow display) */
  dirDeg: number;
  /** Matched wind pattern name, if any */
  matchedPattern: string | null;
}

export interface SpotWaveConditions {
  /** Significant wave height (m) — from nearest buoy */
  waveHeight: number | null;
  /** Peak wave period (s) */
  wavePeriod: number | null;
  /** Wave direction (degrees) */
  waveDir: number | null;
  /** Source buoy name */
  sourceBuoy: string | null;
}

/** Thermal context for spots with thermalDetection: true */
export interface SpotThermalContext {
  deltaT: number | null;
  thermalProbability: number;
  windWindow: { startHour: number; endHour: number; avgSpeedKt: number; dominantDir: string } | null;
  atmosphere: { cloudCover: number | null; cape: number | null };
  bestTendency: string;
  hasStormAlert: boolean;
  rainProbability: number | null;
}

export interface SpotScore {
  spotId: SpotId;
  spotName: string;
  verdict: SpotVerdict;
  score: number; // 0-100
  summary: string;
  wind: SpotWindConsensus | null;
  waves: SpotWaveConditions | null;
  /** Water temperature from nearest buoy */
  waterTemp: number | null;
  /** Air temperature from nearest station (°C) */
  airTemp: number | null;
  /** Humidity from nearest station (%) */
  humidity: number | null;
  /** Wind chill / thermal sensation (°C) — when T<10°C and wind>4.8km/h */
  windChill: number | null;
  /** Consensus wind direction in degrees (for arrow display) */
  windDirDeg: number | null;
  /** Hard gate that triggered calm/nogo, if any */
  hardGateTriggered: string | null;
  /** Thermal context — only for spots with thermalDetection: true */
  thermal: SpotThermalContext | null;
  /** Active storm alert — applies to ALL spots in the sector */
  hasStormAlert: boolean;
  computedAt: Date;
}

// ── Station Selection ────────────────────────────────────────

/**
 * Select stations relevant to a spot.
 * Priority: preferred stations first, then any station within spot radius.
 */
function selectStationsForSpot(
  spot: SailingSpot,
  stations: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
): { station: NormalizedStation; reading: NormalizedReading; distKm: number }[] {
  const result: { station: NormalizedStation; reading: NormalizedReading; distKm: number }[] = [];
  const [spotLon, spotLat] = spot.center;
  const preferredSet = new Set(spot.preferredStations);

  for (const s of stations) {
    const reading = readings.get(s.id);
    if (!reading) continue;
    if (reading.windSpeed === null || reading.windDirection === null) continue;

    const distKm = fastDistanceKm(s.lat, s.lon, spotLat, spotLon);
    const isPreferred = preferredSet.has(s.id);

    // Include if preferred OR within spot radius
    if (isPreferred || distKm <= spot.radiusKm) {
      result.push({ station: s, reading, distKm });
    }
  }

  return result;
}

/**
 * Select buoy readings relevant to a spot.
 */
function selectBuoysForSpot(
  spot: SailingSpot,
  buoys: BuoyReading[],
): { buoy: BuoyReading; distKm: number; lat: number; lon: number }[] {
  const [spotLon, spotLat] = spot.center;
  const preferredSet = new Set(spot.preferredBuoys);
  const result: { buoy: BuoyReading; distKm: number; lat: number; lon: number }[] = [];

  for (const b of buoys) {
    const coords = BUOY_COORDS_MAP.get(b.stationId);
    if (!coords) continue;

    const distKm = fastDistanceKm(coords.lat, coords.lon, spotLat, spotLon);
    const isPreferred = preferredSet.has(b.stationId);

    // Include preferred buoys regardless of distance, or within 30km
    if (isPreferred || distKm <= 30) {
      result.push({ buoy: b, distKm, lat: coords.lat, lon: coords.lon });
    }
  }

  // Sort by distance
  result.sort((a, b) => a.distKm - b.distKm);
  return result;
}

// ── Wind Consensus ───────────────────────────────────────────

function computeSpotWindConsensus(
  spot: SailingSpot,
  stationData: { reading: NormalizedReading; distKm: number }[],
  buoyData: { buoy: BuoyReading; distKm: number }[],
): SpotWindConsensus | null {
  // Collect all wind readings (stations + buoys)
  const windPoints: { dir: number; speedKt: number; weight: number }[] = [];

  for (const { reading, distKm } of stationData) {
    if (reading.windSpeed === null || reading.windDirection === null) continue;
    const speedKt = msToKnots(reading.windSpeed);
    if (speedKt < 1) continue;
    // Inverse-distance weighting: closer stations matter more
    const weight = 1 / (distKm + 1);
    windPoints.push({ dir: reading.windDirection, speedKt, weight });
  }

  for (const { buoy, distKm } of buoyData) {
    if (buoy.windSpeed === null || buoy.windDir === null) continue;
    const speedKt = msToKnots(buoy.windSpeed);
    if (speedKt < 1) continue;
    const weight = 1 / (distKm + 1);
    windPoints.push({ dir: buoy.windDir, speedKt, weight });
  }

  if (windPoints.length < 1) return null;

  // Weighted average speed
  let totalWeight = 0;
  let weightedSpeed = 0;
  let sinSum = 0;
  let cosSum = 0;

  for (const wp of windPoints) {
    weightedSpeed += wp.speedKt * wp.weight;
    totalWeight += wp.weight;
    const rad = (wp.dir * Math.PI) / 180;
    sinSum += Math.sin(rad) * wp.weight;
    cosSum += Math.cos(rad) * wp.weight;
  }

  const avgSpeed = weightedSpeed / totalWeight;
  const avgDir = ((Math.atan2(sinSum, cosSum) * 180) / Math.PI + 360) % 360;

  // Check wind pattern match — require minimum 8kt to acknowledge pattern
  let matchedPattern: string | null = null;
  if (avgSpeed >= 8) {
    for (const pattern of spot.windPatterns) {
      if (angleDifference(avgDir, pattern.direction) <= 45) {
        matchedPattern = pattern.name;
        break;
      }
    }
  }

  return {
    stationCount: windPoints.length,
    avgSpeedKt: Math.round(avgSpeed * 10) / 10,
    dominantDir: degToCardinal8(avgDir),
    dirDeg: Math.round(avgDir),
    matchedPattern,
  };
}

// ── Wave Conditions ──────────────────────────────────────────

function extractWaveConditions(
  buoyData: { buoy: BuoyReading; distKm: number }[],
): SpotWaveConditions | null {
  // Find nearest buoy with wave data
  for (const { buoy } of buoyData) {
    if (buoy.waveHeight !== null) {
      return {
        waveHeight: buoy.waveHeight,
        wavePeriod: buoy.wavePeriod,
        waveDir: buoy.waveDir,
        sourceBuoy: buoy.stationName,
      };
    }
  }
  return null;
}

// ── Verdict from wind speed ──────────────────────────────────

/**
 * Determine base verdict purely from wind speed (kt).
 * This is the PRIMARY driver — score adjustments are secondary.
 */
function windVerdict(spd: number, spotId: SpotId): SpotVerdict {
  // Cíes-Ría: ocean conditions need more wind
  if (spotId === 'cies-ria') {
    if (spd < 8) return 'calm';       // ocean <8kt = nothing
    if (spd < 12) return 'sailing';
    if (spd < 18) return 'good';
    if (spd <= 25) return 'strong';
    return 'strong'; // >25 still strong (hard gate catches danger)
  }

  // All other spots (interior / sheltered)
  if (spd < 6) return 'calm';
  if (spd < 8) return 'light';
  if (spd < 12) return 'sailing';
  if (spd < 18) return 'good';
  return 'strong'; // ≥18kt
}

// ── Per-Spot Scoring ─────────────────────────────────────────

/**
 * Score a single spot.
 *
 * The VERDICT is driven primarily by wind speed (windVerdict above).
 * The SCORE (0-100) adds nuance from patterns, consensus, waves, and context.
 * Score is used for sorting/comparison but verdict drives the color on the map.
 */
function scoreSpot(
  spot: SailingSpot,
  wind: SpotWindConsensus | null,
  waves: SpotWaveConditions | null,
  waterTemp: number | null,
): { score: number; verdict: SpotVerdict; hardGate: string | null; summary: string } {
  // ── Hard gates (instant danger override) ──────────────
  if (wind && spot.hardGates.maxWindKt && wind.avgSpeedKt > spot.hardGates.maxWindKt) {
    return {
      score: 0,
      verdict: 'strong',
      hardGate: `Viento ${wind.avgSpeedKt.toFixed(0)}kt > ${spot.hardGates.maxWindKt}kt`,
      summary: `Viento excesivo (${wind.avgSpeedKt.toFixed(0)}kt). Peligroso.`,
    };
  }

  if (waves && spot.hardGates.maxWaveHeight && waves.waveHeight !== null &&
      waves.waveHeight > spot.hardGates.maxWaveHeight) {
    return {
      score: 0,
      verdict: 'strong',
      hardGate: `Oleaje ${waves.waveHeight.toFixed(1)}m > ${spot.hardGates.maxWaveHeight}m`,
      summary: `Oleaje excesivo (${waves.waveHeight.toFixed(1)}m). Peligroso.`,
    };
  }

  // ── No data ────────────────────────────────────────────
  if (!wind) {
    return { score: 0, verdict: 'unknown', hardGate: null, summary: 'Sin datos de viento.' };
  }

  const spd = wind.avgSpeedKt;

  // ── Primary verdict from wind speed ────────────────────
  const verdict = windVerdict(spd, spot.id);

  // ── Score computation (0-100) for ranking ──────────────
  let score = 0;

  // Wind speed score — calibrated to real Rías experience
  if (spot.id === 'cesantes' || spot.id === 'castrelo') {
    if (spd < 6) score += 0;
    else if (spd < 8) score += 10;
    else if (spd < 12) score += 22;
    else if (spd < 15) score += 38;
    else if (spd <= 22) score += 48;
    else score += 35;
  } else if (spot.id === 'bocana') {
    if (spd < 6) score += 0;
    else if (spd < 8) score += 8;
    else if (spd < 12) score += 20;
    else if (spd < 15) score += 38;
    else if (spd <= 22) score += 48;
    else score += 30;
  } else if (spot.id === 'cies-ria') {
    if (spd < 8) score += 0;
    else if (spd < 12) score += 15;
    else if (spd < 15) score += 30;
    else if (spd <= 22) score += 42;
    else score += 25;
  } else {
    // Centro Ría
    if (spd < 6) score += 0;
    else if (spd < 8) score += 8;
    else if (spd < 12) score += 18;
    else if (spd < 15) score += 35;
    else if (spd <= 22) score += 45;
    else score += 28;
  }

  // ── Wind pattern match (requires ≥8kt) ─────────────────
  if (wind.matchedPattern) {
    score += spot.id === 'bocana' ? 20 : 15;
    // Cesantes thermal channel bonus: stations underestimate water wind
    if (spot.id === 'cesantes' && wind.matchedPattern === 'Térmica WSW') {
      score += 8;
    }
  }

  // ── Station/buoy consensus bonus ───────────────────────
  if (wind.stationCount >= 4) score += 15;
  else if (wind.stationCount >= 2) score += 10;
  else if (wind.stationCount >= 1) score += 5;

  // ── Wave scoring (per spot relevance) ──────────────────
  if (spot.waveRelevance === 'critical' && waves?.waveHeight !== null) {
    const wh = waves.waveHeight!;
    if (wh >= 0.3 && wh <= 1.5) score += 25;
    else if (wh <= 2.5) score += 15;
    else if (wh <= 3.0) score += 5;
  } else if (spot.waveRelevance === 'moderate' && waves?.waveHeight !== null) {
    const wh = waves.waveHeight!;
    if (wh <= 0.5) score += 15;
    else if (wh <= 1.0) score += 10;
    else if (wh <= 1.5) score += 5;
  } else if (spot.waveRelevance === 'none') {
    score += 10; // Flat water bonus
  }

  // ── N wind penalty for Cesantes ────────────────────────
  if (spot.id === 'cesantes' && wind.dominantDir === 'N') {
    score -= 15;
  }

  // Cap score
  score = Math.max(0, Math.min(100, score));

  // ── Summary ────────────────────────────────────────────
  const summary = buildSpotSummary(spot, verdict, wind, waves, waterTemp);

  return { score, verdict, hardGate: null, summary };
}

// ── Summary Builder ──────────────────────────────────────────

function buildSpotSummary(
  spot: SailingSpot,
  verdict: SpotVerdict,
  wind: SpotWindConsensus,
  waves: SpotWaveConditions | null,
  waterTemp: number | null,
): string {
  const parts: string[] = [];
  const spd = wind.avgSpeedKt;
  const dir = wind.dominantDir;
  const pattern = wind.matchedPattern;

  switch (verdict) {
    case 'good':
      if (pattern) {
        parts.push(`${pattern} activa.`);
      }
      parts.push(`Buen d\u00eda (${dir} ${spd.toFixed(0)}kt).`);
      if (spd >= 15) {
        parts.push('Regata y ocio.');
      } else {
        parts.push('Regata bien, ocio justo.');
      }
      break;
    case 'strong':
      parts.push(`Viento fuerte (${dir} ${spd.toFixed(0)}kt).`);
      parts.push('Solo con experiencia.');
      break;
    case 'sailing':
      if (pattern) {
        parts.push(`${pattern} d\u00e9bil.`);
      }
      parts.push(`Navegable (${dir} ${spd.toFixed(0)}kt).`);
      parts.push('Regata puede, ocio escaso.');
      break;
    case 'light':
      parts.push(`Flojo (${dir} ${spd.toFixed(0)}kt). No merece.`);
      break;
    case 'calm':
      parts.push('Sin viento. No se navega.');
      break;
    default:
      parts.push('Sin datos.');
  }

  if (wind.stationCount > 1 && verdict !== 'calm') {
    parts.push(`(${wind.stationCount} fuentes)`);
  }

  if (waves?.waveHeight !== null && spot.waveRelevance !== 'none') {
    parts.push(`\u00b7 Olas ${waves.waveHeight!.toFixed(1)}m`);
  }

  if (waterTemp !== null && verdict !== 'calm') {
    parts.push(`\u00b7 Agua ${waterTemp.toFixed(0)}\u00b0C`);
  }

  return parts.join(' ');
}

// ── Public API ───────────────────────────────────────────────

/**
 * Score all spots with current data.
 * Returns a Map of spotId → SpotScore.
 * Accepts spots array to support multiple sectors.
 */
export function scoreAllSpots(
  spots: SailingSpot[],
  stations: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
  buoys: BuoyReading[],
  thermalData?: SpotThermalContext,
): Map<string, SpotScore> {
  const results = new Map<string, SpotScore>();
  const computedAt = new Date();

  for (const spot of spots) {
    const stationData = selectStationsForSpot(spot, stations, readings);
    const buoyData = selectBuoysForSpot(spot, buoys);

    const wind = computeSpotWindConsensus(spot, stationData, buoyData);
    const waves = extractWaveConditions(buoyData);

    // Water temp from nearest buoy
    let waterTemp: number | null = null;
    for (const { buoy } of buoyData) {
      if (buoy.waterTemp !== null) {
        waterTemp = buoy.waterTemp;
        break;
      }
    }

    const { score, verdict, hardGate, summary } = scoreSpot(spot, wind, waves, waterTemp);

    // Air temp & humidity from nearest station with valid data (IDW-weighted by distance)
    let airTemp: number | null = null;
    let humidity: number | null = null;
    // Sort by distance, pick nearest with data
    const sortedStations = [...stationData].sort((a, b) => a.distKm - b.distKm);
    for (const { reading } of sortedStations) {
      if (airTemp === null && reading.temperature !== null) airTemp = reading.temperature;
      if (humidity === null && reading.humidity !== null) humidity = reading.humidity;
      if (airTemp !== null && humidity !== null) break;
    }

    // Wind chill (sensación térmica) — Environment Canada formula
    // Valid when T < 10°C and wind > 4.8 km/h
    let windChill: number | null = null;
    if (airTemp !== null && wind !== null) {
      const windKmh = wind.avgSpeedKt * 1.852; // kt → km/h
      if (airTemp < 10 && windKmh > 4.8) {
        windChill = Math.round(
          (13.12 + 0.6215 * airTemp - 11.37 * Math.pow(windKmh, 0.16) +
            0.3965 * airTemp * Math.pow(windKmh, 0.16)) * 10,
        ) / 10;
      }
    }

    results.set(spot.id, {
      spotId: spot.id,
      spotName: spot.name,
      verdict,
      score,
      summary,
      wind,
      waves,
      waterTemp,
      airTemp,
      humidity,
      windChill,
      windDirDeg: wind?.dirDeg ?? null,
      hardGateTriggered: hardGate,
      thermal: spot.thermalDetection ? (thermalData ?? null) : null,
      hasStormAlert: thermalData?.hasStormAlert ?? false,
      computedAt,
    });
  }

  return results;
}
