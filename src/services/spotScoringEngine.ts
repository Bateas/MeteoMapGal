/**
 * Spot-based sailing scoring engine for Rías Baixas.
 *
 * Each spot gets its own GO/MARGINAL/NOGO verdict based on:
 *   - Nearby station wind consensus (filtered by spot radius + preferred stations)
 *   - Buoy wave conditions (per-spot wave relevance)
 *   - Wind pattern recognition (thermal, nortada, virazón detection)
 *   - Safety hard gates (max wind, max wave height)
 *
 * Philosophy: Coastal sailing decisions are WIND + WAVE. No thermal scoring
 * (that's Embalse). The key question is: "Can I sail safely and enjoyably?"
 */

import type { NormalizedStation, NormalizedReading } from '../types/station';
import type { BuoyReading } from '../api/buoyClient';
import { BUOY_COORDS_MAP } from '../api/buoyClient';
import type { SailingSpot, SpotId } from '../config/spots';
import { msToKnots, degToCardinal8, angleDifference } from './windUtils';
import { fastDistanceKm } from './idwInterpolation';

// ── Types ────────────────────────────────────────────────────

export type SpotVerdict = 'go' | 'marginal' | 'nogo' | 'unknown';

export interface SpotWindConsensus {
  stationCount: number;
  avgSpeedKt: number;
  dominantDir: string;
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
  /** Hard gate that triggered NOGO, if any */
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

  // Check wind pattern match
  let matchedPattern: string | null = null;
  for (const pattern of spot.windPatterns) {
    if (angleDifference(avgDir, pattern.direction) <= 45 && avgSpeed >= 4) {
      matchedPattern = pattern.name;
      break;
    }
  }

  return {
    stationCount: windPoints.length,
    avgSpeedKt: Math.round(avgSpeed * 10) / 10,
    dominantDir: degToCardinal8(avgDir),
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

// ── Per-Spot Scoring ─────────────────────────────────────────

/**
 * Score a single spot.
 *
 * Scoring breakdown varies by spot type:
 *
 * CESANTES (thermal, flat water):
 *   Wind speed: 0-45 pts (dominant — thermal detection)
 *   Wind pattern match: 0-20 pts (WSW thermal = bonus)
 *   Station consensus: 0-15 pts (how many stations agree)
 *   N wind penalty: 0 to -20 pts
 *   Calm penalty: -10 if all calm
 *
 * BOCANA (Vigo–Rande, bocana wind zone):
 *   Wind speed: 0-40 pts (bocana wind = prime condition)
 *   Wind pattern match: 0-25 pts (bocana detection = big bonus)
 *   Station consensus: 0-15 pts
 *   Flat water bonus: +10 pts (sheltered from ocean swell)
 *
 * CENTRO RÍA (mid-ría, mixed):
 *   Wind speed: 0-35 pts
 *   Wind pattern match: 0-20 pts (virazón detection)
 *   Wave conditions: 0-15 pts (moderate check)
 *   Station consensus: 0-15 pts
 *   Visibility/safety: 0-15 pts
 *
 * CÍES-RÍA (ocean entrance, Baiona-Cíes):
 *   Wind speed: 0-30 pts
 *   Wave height+period: 0-30 pts (critical!)
 *   Wind pattern match: 0-15 pts
 *   Station consensus: 0-10 pts
 *   Safety margin: 0-15 pts
 */
function scoreSpot(
  spot: SailingSpot,
  wind: SpotWindConsensus | null,
  waves: SpotWaveConditions | null,
  waterTemp: number | null,
): { score: number; verdict: SpotVerdict; hardGate: string | null; summary: string } {
  // ── Hard gates (instant NOGO) ──────────────────────────
  if (wind && spot.hardGates.maxWindKt && wind.avgSpeedKt > spot.hardGates.maxWindKt) {
    return {
      score: 0,
      verdict: 'nogo',
      hardGate: `Viento ${wind.avgSpeedKt.toFixed(0)}kt > ${spot.hardGates.maxWindKt}kt máx`,
      summary: `Viento excesivo (${wind.avgSpeedKt.toFixed(0)}kt). No navegar.`,
    };
  }

  if (waves && spot.hardGates.maxWaveHeight && waves.waveHeight !== null &&
      waves.waveHeight > spot.hardGates.maxWaveHeight) {
    return {
      score: 0,
      verdict: 'nogo',
      hardGate: `Oleaje ${waves.waveHeight.toFixed(1)}m > ${spot.hardGates.maxWaveHeight}m máx`,
      summary: `Oleaje excesivo (${waves.waveHeight.toFixed(1)}m). No navegar.`,
    };
  }

  // ── No data ────────────────────────────────────────────
  if (!wind) {
    return { score: 0, verdict: 'unknown', hardGate: null, summary: 'Sin datos de viento para este spot.' };
  }

  let score = 0;

  // ── Wind speed scoring ─────────────────────────────────
  // Rías sailing scale: <5kt nogo, 5-8kt marginal, 8-13kt decent,
  // 13-20kt good day, 20-25kt strong but sailable, 25-30kt experts only
  const spd = wind.avgSpeedKt;
  if (spot.id === 'cesantes' || spot.id === 'castrelo') {
    // Thermal/flat water spots — lighter wind is still useful
    if (spd >= 13 && spd <= 20) score += 45;      // buen día
    else if (spd >= 20 && spd <= 25) score += 40;  // fuerte, viable
    else if (spd >= 8 && spd < 13) score += 35;    // decentillo
    else if (spd >= 5 && spd < 8) score += 18;     // marginal
    else if (spd >= 3 && spd < 5) score += 8;      // casi nada
    else if (spd > 25) score += 25;                 // solo expertos
  } else if (spot.id === 'bocana') {
    // Bocana: bocana wind is THE event — moderate-strong ideal
    if (spd >= 13 && spd <= 20) score += 45;
    else if (spd >= 8 && spd < 13) score += 35;
    else if (spd >= 20 && spd <= 25) score += 35;
    else if (spd >= 5 && spd < 8) score += 15;
    else if (spd > 25) score += 20;
  } else if (spot.id === 'cies-ria') {
    // Cíes-Ría: ocean conditions, needs solid wind
    if (spd >= 13 && spd <= 20) score += 40;
    else if (spd >= 8 && spd < 13) score += 30;
    else if (spd >= 20 && spd <= 25) score += 30;
    else if (spd >= 5 && spd < 8) score += 12;
    else if (spd > 25) score += 15;
  } else {
    // Centro Ría: medium requirements
    if (spd >= 13 && spd <= 20) score += 42;
    else if (spd >= 8 && spd < 13) score += 35;
    else if (spd >= 20 && spd <= 25) score += 32;
    else if (spd >= 5 && spd < 8) score += 15;
    else if (spd > 25) score += 18;
  }

  // ── Wind pattern match ─────────────────────────────────
  if (wind.matchedPattern) {
    // Bocana spot gets extra bonus for bocana wind detection (it's THE event)
    score += spot.id === 'bocana' ? 25 : 20;
  } else if (spd >= 4) {
    score += 5; // Wind present but no known pattern
  }

  // ── Station/buoy consensus bonus ───────────────────────
  if (wind.stationCount >= 4) score += 15;
  else if (wind.stationCount >= 2) score += 10;
  else if (wind.stationCount >= 1) score += 5;

  // ── Wave scoring (per spot relevance) ──────────────────
  if (spot.waveRelevance === 'critical' && waves?.waveHeight !== null) {
    const wh = waves.waveHeight!;
    // Cíes-Ría: ideal 0.5-2m, manageable ocean swell
    if (wh >= 0.3 && wh <= 1.5) score += 25;
    else if (wh <= 2.5) score += 15;
    else if (wh <= 3.0) score += 5;
    // >3m already blocked by hard gate
  } else if (spot.waveRelevance === 'moderate' && waves?.waveHeight !== null) {
    const wh = waves.waveHeight!;
    // Centro Ría: prefer calm, tolerate moderate
    if (wh <= 0.5) score += 15;
    else if (wh <= 1.0) score += 10;
    else if (wh <= 1.5) score += 5;
    // >2m already blocked by hard gate
  } else if (spot.waveRelevance === 'none') {
    score += 10; // Flat water bonus (Cesantes)
  }

  // ── N wind penalty for Cesantes ────────────────────────
  if (spot.id === 'cesantes' && wind.dominantDir === 'N') {
    score -= 15; // N wind kills thermal at Cesantes
  }

  // Cap score
  score = Math.max(0, Math.min(100, score));

  // ── Verdict ────────────────────────────────────────────
  // GO: solid conditions (≥50), MARGINAL: sailable but marginal (≥25), NOGO: not worth it
  let verdict: SpotVerdict;
  if (score >= 50) verdict = 'go';
  else if (score >= 25) verdict = 'marginal';
  else verdict = 'nogo';

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

  if (verdict === 'go') {
    if (wind.avgSpeedKt >= 13) {
      parts.push(wind.matchedPattern
        ? `${wind.matchedPattern} activa. Buen día!`
        : 'Buen día de navegación.');
    } else {
      parts.push(wind.matchedPattern
        ? `${wind.matchedPattern} activa.`
        : 'Condiciones navegables.');
    }
  } else if (verdict === 'marginal') {
    parts.push(wind.avgSpeedKt >= 5
      ? 'Decentillo — se puede navegar.'
      : 'Condiciones justas.');
  } else {
    parts.push('Poco viento, no merece la pena.');
  }

  parts.push(`${wind.dominantDir} ~${wind.avgSpeedKt.toFixed(0)}kt`);

  if (wind.stationCount > 1) {
    parts.push(`(${wind.stationCount} fuentes)`);
  }

  if (waves?.waveHeight !== null && spot.waveRelevance !== 'none') {
    parts.push(`· Olas ${waves.waveHeight!.toFixed(1)}m`);
  }

  if (waterTemp !== null) {
    parts.push(`· Agua ${waterTemp.toFixed(0)}°C`);
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

    results.set(spot.id, {
      spotId: spot.id,
      spotName: spot.name,
      verdict,
      score,
      summary,
      wind,
      waves,
      waterTemp,
      hardGateTriggered: hardGate,
      thermal: spot.thermalDetection ? (thermalData ?? null) : null,
      hasStormAlert: thermalData?.hasStormAlert ?? false,
      computedAt,
    });
  }

  return results;
}
