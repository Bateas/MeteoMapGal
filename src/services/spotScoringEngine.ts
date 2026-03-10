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
import { RIAS_BUOY_STATIONS } from '../api/buoyClient';
import type { SailingSpot } from '../config/spots';
import { RIAS_SPOTS } from '../config/spots';
import { msToKnots } from './windUtils';
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

export interface SpotScore {
  spotId: string;
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
  computedAt: Date;
}

// ── Cardinals ────────────────────────────────────────────────

const CARDINALS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

function degToCardinal8(deg: number): string {
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return CARDINALS_8[idx];
}

/** Angular difference (0-180°) */
function angleDiff(a: number, b: number): number {
  return Math.abs(((a - b + 180) % 360 + 360) % 360 - 180);
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
  const coordsMap = new Map(RIAS_BUOY_STATIONS.map((s) => [s.id, { lat: s.lat, lon: s.lon }]));

  const result: { buoy: BuoyReading; distKm: number; lat: number; lon: number }[] = [];

  for (const b of buoys) {
    const coords = coordsMap.get(b.stationId);
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
    if (angleDiff(avgDir, pattern.direction) <= 45 && avgSpeed >= 4) {
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
  // Sweet spot: 6-15kt for all types of sailing
  const spd = wind.avgSpeedKt;
  if (spot.id === 'cesantes') {
    // Cesantes: thermal hunting — any wind is good, >6kt is great
    if (spd >= 10) score += 45;
    else if (spd >= 8) score += 40;
    else if (spd >= 6) score += 35;
    else if (spd >= 4) score += 25;
    else if (spd >= 2) score += 10;
  } else if (spot.id === 'bocana') {
    // Bocana: bocana wind is THE event — moderate wind is ideal
    if (spd >= 8 && spd <= 18) score += 40;
    else if (spd >= 6) score += 32;
    else if (spd >= 4) score += 20;
    else if (spd >= 2) score += 8;
  } else if (spot.id === 'cies-ria') {
    // Cíes-Ría: need solid wind, ocean conditions
    if (spd >= 10 && spd <= 20) score += 30;
    else if (spd >= 8) score += 25;
    else if (spd >= 6) score += 20;
    else if (spd >= 4) score += 12;
    else score += 5;
  } else {
    // Centro Ría: medium requirements
    if (spd >= 8 && spd <= 18) score += 35;
    else if (spd >= 6) score += 28;
    else if (spd >= 4) score += 18;
    else if (spd >= 2) score += 8;
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
  let verdict: SpotVerdict;
  if (score >= 45) verdict = 'go';
  else if (score >= 20) verdict = 'marginal';
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
    parts.push(wind.matchedPattern
      ? `${wind.matchedPattern} activa.`
      : 'Buen viento para navegar.');
  } else if (verdict === 'marginal') {
    parts.push('Condiciones justas.');
  } else {
    parts.push('Sin condiciones favorables.');
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
 */
export function scoreAllSpots(
  stations: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
  buoys: BuoyReading[],
): Map<string, SpotScore> {
  const results = new Map<string, SpotScore>();

  for (const spot of RIAS_SPOTS) {
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
      computedAt: new Date(),
    });
  }

  return results;
}
