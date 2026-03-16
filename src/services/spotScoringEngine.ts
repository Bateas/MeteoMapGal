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
import { STALE_THRESHOLD_MIN } from '../config/constants';
import type { TeleconnectionIndex } from '../api/naoClient';

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
  /** True when thermal boost was applied (land stations underestimate water wind) */
  thermalBoosted: boolean;
  /** Scoring confidence: 'high' (3+ sources), 'medium' (2), 'low' (1 or only land) */
  scoringConfidence: 'high' | 'medium' | 'low';
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

  const now = Date.now();
  const MAX_READING_AGE_MS = STALE_THRESHOLD_MIN * 60_000;

  for (const s of stations) {
    const reading = readings.get(s.id);
    if (!reading) continue;
    if (reading.windSpeed === null) continue; // Direction is optional (SkyX, some Netatmo)

    // Skip stale readings — prevents offline stations from dragging consensus
    const ageMs = now - reading.timestamp.getTime();
    if (ageMs > MAX_READING_AGE_MS) continue;

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

// ── Source Quality Multipliers ────────────────────────────────
// Official agencies > curated amateur > consumer PWS
// Applied to IDW weighting in consensus — AEMET/MG readings "out-vote" nearby WU/Netatmo

const SOURCE_QUALITY: Record<string, number> = {
  aemet: 1.0,           // calibrated professional instruments
  meteogalicia: 1.0,    // calibrated professional instruments
  meteoclimatic: 0.85,  // amateur but curated network, good placement
  wunderground: 0.7,    // variable quality, placement unknown
  netatmo: 0.6,         // consumer devices, often building-mounted
  skyx: 0.6,            // single consumer device
};

function getSourceQuality(stationId: string): number {
  const source = stationId.split('_')[0];
  return SOURCE_QUALITY[source] ?? 0.7;
}

// ── Wind Consensus ───────────────────────────────────────────

function computeSpotWindConsensus(
  spot: SailingSpot,
  stationData: { station: NormalizedStation; reading: NormalizedReading; distKm: number }[],
  buoyData: { buoy: BuoyReading; distKm: number }[],
): SpotWindConsensus | null {
  // Collect speed and direction separately — direction is optional
  const speedPoints: { speedKt: number; weight: number }[] = [];
  const dirPoints: { dir: number; weight: number }[] = [];

  for (const { station, reading, distKm } of stationData) {
    if (reading.windSpeed === null) continue;
    const speedKt = msToKnots(reading.windSpeed);
    if (speedKt < 1) continue;
    // Composite weight: distance × source quality × freshness
    const distWeight = 1 / (distKm + 1);
    const qualityMul = getSourceQuality(station.id);
    const ageMin = (Date.now() - reading.timestamp.getTime()) / 60_000;
    const freshnessMul = ageMin <= 5 ? 1.0 : ageMin <= 10 ? 0.95 : ageMin <= 20 ? 0.85 : 0.7;
    const weight = distWeight * qualityMul * freshnessMul;
    speedPoints.push({ speedKt, weight });
    // Direction only if available (SkyX, some Netatmo lack wind vanes)
    if (reading.windDirection !== null) {
      dirPoints.push({ dir: reading.windDirection, weight });
    }
  }

  for (const { buoy, distKm } of buoyData) {
    if (buoy.windSpeed === null) continue;
    const speedKt = msToKnots(buoy.windSpeed);
    if (speedKt < 1) continue;
    // Buoys are professional instruments (quality=1.0) but still decay by freshness
    const distWeight = 1 / (distKm + 1);
    const buoyAgeMin = buoy.timestamp ? (Date.now() - new Date(buoy.timestamp).getTime()) / 60_000 : 0;
    const buoyFreshness = buoyAgeMin <= 10 ? 1.0 : buoyAgeMin <= 30 ? 0.95 : buoyAgeMin <= 60 ? 0.85 : 0.7;
    const weight = distWeight * buoyFreshness;
    speedPoints.push({ speedKt, weight });
    if (buoy.windDir !== null) {
      dirPoints.push({ dir: buoy.windDir, weight });
    }
  }

  if (speedPoints.length < 1) return null;

  // Weighted average speed (from ALL sources with speed)
  let totalWeight = 0;
  let weightedSpeed = 0;
  for (const sp of speedPoints) {
    weightedSpeed += sp.speedKt * sp.weight;
    totalWeight += sp.weight;
  }
  const avgSpeed = weightedSpeed / totalWeight;

  // Weighted average direction (only from sources WITH direction)
  let avgDir = 0;
  if (dirPoints.length > 0) {
    let sinSum = 0;
    let cosSum = 0;
    for (const dp of dirPoints) {
      const rad = (dp.dir * Math.PI) / 180;
      sinSum += Math.sin(rad) * dp.weight;
      cosSum += Math.cos(rad) * dp.weight;
    }
    avgDir = ((Math.atan2(sinSum, cosSum) * 180) / Math.PI + 360) % 360;
  }

  // Check wind pattern match — lower threshold for thermal spots (land stations underestimate)
  const patternThreshold = spot.thermalDetection ? 5 : 8;
  let matchedPattern: string | null = null;
  if (avgSpeed >= patternThreshold) {
    for (const pattern of spot.windPatterns) {
      if (angleDifference(avgDir, pattern.direction) <= 45) {
        matchedPattern = pattern.name;
        break;
      }
    }
  }

  return {
    stationCount: speedPoints.length,
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
  // Round to integer — same as displayed value, avoids "CALMA 8kt" incoherence
  const kt = Math.round(spd);

  // Cíes-Ría: ocean conditions — needs "light" category for coherence
  if (spotId === 'cies-ria') {
    if (kt < 5) return 'calm';        // ocean <5kt = truly nothing
    if (kt < 10) return 'light';      // 5-9kt = breeze but not enough for ocean
    if (kt < 14) return 'sailing';    // 10-13kt = navigable ocean
    if (kt < 18) return 'good';       // 14-17kt = good ocean sailing
    return 'strong'; // ≥18kt (hard gate catches danger)
  }

  // All other spots (interior / sheltered)
  if (kt < 6) return 'calm';
  if (kt < 8) return 'light';
  if (kt < 12) return 'sailing';
  if (kt < 18) return 'good';
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
  thermalData?: SpotThermalContext,
): { score: number; verdict: SpotVerdict; hardGate: string | null; summary: string; thermalBoosted: boolean } {
  // ── Hard gates (instant danger override) ──────────────
  if (wind && spot.hardGates.maxWindKt && wind.avgSpeedKt > spot.hardGates.maxWindKt) {
    return {
      score: 0,
      verdict: 'strong',
      hardGate: `Viento ${wind.avgSpeedKt.toFixed(0)}kt > ${spot.hardGates.maxWindKt}kt`,
      summary: `Viento excesivo (${wind.avgSpeedKt.toFixed(0)}kt). Peligroso.`,
      thermalBoosted: false,
    };
  }

  if (waves && spot.hardGates.maxWaveHeight && waves.waveHeight !== null &&
      waves.waveHeight > spot.hardGates.maxWaveHeight) {
    return {
      score: 0,
      verdict: 'strong',
      hardGate: `Oleaje ${waves.waveHeight.toFixed(1)}m > ${spot.hardGates.maxWaveHeight}m`,
      summary: `Oleaje excesivo (${waves.waveHeight.toFixed(1)}m). Peligroso.`,
      thermalBoosted: false,
    };
  }

  // ── No data ────────────────────────────────────────────
  if (!wind) {
    return { score: 0, verdict: 'unknown', hardGate: null, summary: 'Sin datos de viento.', thermalBoosted: false };
  }

  const spd = wind.avgSpeedKt;

  // ── Thermal boost: land stations systematically underestimate water wind ──
  // During thermal conditions, sheltered land stations read 30-50% below actual
  // water surface wind. When thermal probability is high AND direction matches
  // a thermal pattern, we apply an amplification factor to the consensus.
  let thermalBoosted = false;
  let effectiveSpd = spd;

  if (spot.thermalDetection && thermalData && thermalData.thermalProbability >= 40) {
    // Check if current wind direction matches a thermal pattern
    const dirMatchesThermal = spot.windPatterns.some(
      (p) => angleDifference(wind.dirDeg, p.direction) <= 50,
    );
    // Also check forecast wind window direction
    const forecastMatchesThermal = thermalData.windWindow?.dominantDir &&
      ['SW', 'WSW', 'W', 'SSW'].includes(thermalData.windWindow.dominantDir);

    if ((dirMatchesThermal || forecastMatchesThermal) && spd >= 3) {
      // Amplification factor: +20% at 40% probability → +50% at 100% probability
      // Capped at +50% (e.g., 5kt consensus → 7.5kt effective)
      const boostFactor = 1 + (thermalData.thermalProbability / 100) * 0.5;
      effectiveSpd = spd * boostFactor;
      thermalBoosted = true;
    }
  }

  // ── Primary verdict from wind speed (using effective speed with thermal boost) ──
  const verdict = windVerdict(effectiveSpd, spot.id);

  // ── Score computation (0-100) for ranking ──────────────
  let score = 0;

  // Wind speed score — calibrated to real Rías experience
  // Uses effectiveSpd (includes thermal boost when applicable)
  const spdForScore = effectiveSpd;
  if (spot.id === 'cesantes' || spot.id === 'castrelo') {
    if (spdForScore < 6) score += 0;
    else if (spdForScore < 8) score += 10;
    else if (spdForScore < 12) score += 22;
    else if (spdForScore < 15) score += 38;
    else if (spdForScore <= 22) score += 48;
    else score += 35;
  } else if (spot.id === 'bocana') {
    if (spdForScore < 6) score += 0;
    else if (spdForScore < 8) score += 8;
    else if (spdForScore < 12) score += 20;
    else if (spdForScore < 15) score += 38;
    else if (spdForScore <= 22) score += 48;
    else score += 30;
  } else if (spot.id === 'cies-ria') {
    if (spdForScore < 5) score += 0;
    else if (spdForScore < 10) score += 8;     // light — not enough for ocean
    else if (spdForScore < 14) score += 22;    // sailing
    else if (spdForScore < 18) score += 38;    // good
    else if (spdForScore <= 22) score += 42;   // strong but manageable
    else score += 25;                  // overpowered
  } else {
    // Centro Ría
    if (spdForScore < 6) score += 0;
    else if (spdForScore < 8) score += 8;
    else if (spdForScore < 12) score += 18;
    else if (spdForScore < 15) score += 35;
    else if (spdForScore <= 22) score += 45;
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

  // Cap score — calm verdict should never score high (confusing to see "CALMA 30/100")
  // Exception: when thermal boost is active, don't cap — the score reflects thermal potential
  if (verdict === 'calm' && !thermalBoosted) score = Math.min(score, 10);
  score = Math.max(0, Math.min(100, score));

  // ── Summary ────────────────────────────────────────────
  const summary = buildSpotSummary(spot, verdict, wind, waves, waterTemp, thermalBoosted, thermalData);

  return { score, verdict, hardGate: null, summary, thermalBoosted };
}

// ── Summary Builder ──────────────────────────────────────────

function buildSpotSummary(
  spot: SailingSpot,
  verdict: SpotVerdict,
  wind: SpotWindConsensus,
  waves: SpotWaveConditions | null,
  waterTemp: number | null,
  thermalBoosted = false,
  thermalData?: SpotThermalContext,
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
      if (spd >= 3) {
        parts.push(`Calma (${dir} ${spd.toFixed(0)}kt). No se navega.`);
      } else {
        parts.push('Sin viento. No se navega.');
      }
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

  // Thermal boost indicator — tell user the score accounts for localized thermal
  if (thermalBoosted && thermalData) {
    parts.push(`\u00b7 Térmica ${thermalData.thermalProbability}% (estaciones en tierra subestiman)`);
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
  teleconnections?: TeleconnectionIndex[],
): Map<string, SpotScore> {
  const results = new Map<string, SpotScore>();
  const computedAt = new Date();

  // Extract NAO/AO for score modulation
  const nao = teleconnections?.find((t) => t.name === 'NAO');
  const ao = teleconnections?.find((t) => t.name === 'AO');

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

    // Pass thermal data to scoring when spot has thermalDetection
    const spotThermal = spot.thermalDetection ? thermalData : undefined;
    let { score, verdict, hardGate, summary, thermalBoosted } = scoreSpot(spot, wind, waves, waterTemp, spotThermal);

    // Scoring confidence based on source count and type
    const sourceCount = wind?.stationCount ?? 0;
    const scoringConfidence: 'high' | 'medium' | 'low' =
      sourceCount >= 3 ? 'high' : sourceCount >= 2 ? 'medium' : 'low';

    // ── NAO/AO score modulation ──────────────────────────
    // NAO+ = Atlantic storms → consistent wind patterns (+5-8%)
    // NAO− = anticyclonic blocking → unreliable wind, calms (−5-8%)
    // AO− = weak polar vortex → variable patterns (−3-5%)
    // Modulation is multiplicative, capped, and only when NOT calm/unknown
    if (nao && verdict !== 'calm' && verdict !== 'unknown' && !hardGate) {
      const naoMod = nao.value * 0.04; // ±4% per index unit (typ. range ±2)
      const aoMod = ao ? ao.value * 0.02 : 0; // ±2% per AO unit
      const totalMod = Math.max(-0.12, Math.min(0.12, naoMod + aoMod)); // cap ±12%
      score = Math.max(0, Math.min(100, Math.round(score * (1 + totalMod))));
    }

    // ── NAO/AO context line in summary ───────────────────
    if (nao && verdict !== 'calm' && verdict !== 'unknown') {
      const naoCtx = naoSummaryContext(nao, ao);
      if (naoCtx) summary += ` · ${naoCtx}`;
    }

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
      thermalBoosted,
      scoringConfidence,
      computedAt,
    });
  }

  return results;
}

// ── NAO/AO summary context (user-friendly Spanish) ──────────

function naoSummaryContext(nao: TeleconnectionIndex, ao?: TeleconnectionIndex): string | null {
  const v = nao.value;
  // Strong signals only — don't clutter summary with neutral
  if (v > 1.0) return 'Patrón atlántico activo: viento consistente';
  if (v < -1.0) {
    if (ao && ao.value < -0.5) return 'Bloqueo + aire frío: calmas y frío';
    return 'Bloqueo anticiclónico: patrones débiles';
  }
  if (ao && ao.value < -1.0) return 'Vórtice polar débil: patrones variables';
  if (ao && ao.value > 1.0) return 'Chorro polar activo: westerlies fuertes';
  return null; // neutral — no context worth showing
}
