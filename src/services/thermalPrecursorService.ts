/**
 * Thermal Precursor Service — Early warning for localized thermal wind.
 *
 * Detects 6 precursor signals from EXISTING data (no new API calls):
 *
 * | Signal                          | Source              | Lead Time | Weight |
 * |--------------------------------|---------------------|-----------|--------|
 * | Morning terral (E/NE at coast) | Coastal stations    | 2-4h      | 25%    |
 * | ΔT water-air from Rande buoy  | Buoy 1251 (temp)    | 3-5h      | 20%    |
 * | Solar radiation ramp (W/m²)    | Station sensors     | 2-3h      | 20%    |
 * | Humidity gradient coast-inland | Station humidity     | 1-2h      | 15%    |
 * | Cross-station wind divergence  | Multi-station        | 1h        | 10%    |
 * | Forecast thermal-favorable     | Open-Meteo (cached) | 12-48h    | 10%    |
 *
 * Output: probability 0-100%, confidence, ETA, human-readable summary.
 *
 * Pure computation — uses data already in stores. No new fetches.
 * Spot-agnostic — applies to any spot with thermalDetection: true.
 */

import type { NormalizedStation, NormalizedReading } from '../types/station';
import type { BuoyReading } from '../api/buoyClient';
import type { HourlyForecast } from '../types/forecast';
import type { SailingSpot } from '../config/spots';
import { fastDistanceKm } from './idwInterpolation';
import { isDirectionInRange, msToKnots, angleDifference } from './windUtils';

// ── Types ────────────────────────────────────────────────

export interface ThermalPrecursorResult {
  spotId: string;
  probability: number;          // 0-100
  confidence: 'high' | 'medium' | 'low';
  eta: string | null;           // e.g. "13-17h" or null if no thermal expected
  etaMinutes: number | null;    // minutes until expected onset
  signals: PrecursorSignals;
  summary: string;              // Spanish human-readable
  level: 'none' | 'watch' | 'probable' | 'imminent' | 'active';
  computedAt: Date;
}

export interface PrecursorSignals {
  /** Morning land breeze (terral) detected at coastal stations */
  terral: SignalDetail;
  /** Water-air temperature differential from buoy */
  deltaTWaterAir: SignalDetail;
  /** Solar radiation ramp rate (W/m²/h) */
  solarRamp: SignalDetail;
  /** Humidity gradient between coast and inland stations */
  humidityGradient: SignalDetail;
  /** Wind divergence across stations (some shifting W while others calm) */
  windDivergence: SignalDetail;
  /** Forecast indicates thermal-favorable conditions */
  forecastFavorable: SignalDetail;
  /** WRF sky_state clear during thermal window (MeteoSIX) */
  skyStateClear?: SignalDetail;
}

export interface SignalDetail {
  active: boolean;
  score: number;      // 0-100 (within its own scale)
  value: string;      // Human-readable value, e.g. "E 4kt" or "ΔT 5.2°C"
  weight: number;     // 0-1 contribution weight
}

// ── Constants ────────────────────────────────────────────

/** Terral = land breeze = E/NE/SE (45° ± 80°) — offshore flow */
const TERRAL_SECTOR = { from: 325, to: 135 }; // wraps through 0°

/** Thermal wind direction = WSW/SW/W (225° ± 50°) */
const THERMAL_DIR_CENTER = 250;
const THERMAL_DIR_TOLERANCE = 50;

/** Signal weights (must sum to 1.0) */
const W_TERRAL = 0.25;
const W_DELTA_T = 0.20;
const W_SOLAR = 0.20;
const W_HUMIDITY = 0.15;
const W_DIVERGENCE = 0.10;
const W_FORECAST = 0.10;

/** Level thresholds */
const LEVEL_ACTIVE = 75;
const LEVEL_IMMINENT = 60;
const LEVEL_PROBABLE = 40;
const LEVEL_WATCH = 20;

// ── Main function ────────────────────────────────────────

/**
 * Compute thermal precursor signals for a spot.
 *
 * @param spot - Sailing spot with thermalDetection: true
 * @param stations - All normalized stations in the sector
 * @param readings - Current readings keyed by stationId
 * @param buoys - Current buoy readings
 * @param forecast - Sector forecast (next 48h), if available
 * @param now - Current time (injectable for testing)
 */
export function computeThermalPrecursors(
  spot: SailingSpot,
  stations: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
  buoys: BuoyReading[],
  forecast: HourlyForecast[] | null,
  now: Date = new Date(),
): ThermalPrecursorResult {
  const hour = now.getHours();
  const month = now.getMonth() + 1;

  // Outside thermal season (May-Sep) or night → no precursors
  if (month < 5 || month > 9 || hour < 6 || hour > 21) {
    return emptyResult(spot.id, now, 'Fuera de temporada térmica');
  }

  // Classify stations: coastal (<5km from coast/spot) vs inland (>10km inland)
  const { coastal, inland } = classifyStations(spot, stations, readings);

  // ── Signal 1: Morning terral ────────────────────────────
  const terral = detectTerral(coastal, readings, hour);

  // ── Signal 2: ΔT water-air from buoy ────────────────────
  const deltaTWaterAir = detectDeltaTWaterAir(spot, buoys, readings);

  // ── Signal 3: Solar radiation ramp ──────────────────────
  const solarRamp = detectSolarRamp(stations, readings, hour);

  // ── Signal 4: Humidity gradient ─────────────────────────
  const humidityGradient = detectHumidityGradient(coastal, inland, readings);

  // ── Signal 5: Wind divergence ───────────────────────────
  const windDivergence = detectWindDivergence(stations, readings, spot);

  // ── Signal 6: Forecast favorable ────────────────────────
  const forecastFavorable = detectForecastFavorable(forecast, now);

  // ── Signal 7: WRF sky_state clear during thermal window (MeteoSIX) ──
  // SUNNY/PARTLY_CLOUDY between 13-18h → favorable for thermal development.
  // Weight: 5% (complementary — doesn't replace other signals).
  const thermalWindowHours = forecast.filter(f => {
    const h = f.time.getHours();
    const diff = f.time.getTime() - now.getTime();
    return diff >= 0 && diff < 8 * 3600_000 && h >= 13 && h <= 18;
  });
  const clearHours = thermalWindowHours.filter(f =>
    f.skyState === 'SUNNY' || f.skyState === 'PARTLY_CLOUDY' || f.skyState === 'HIGH_CLOUDS',
  ).length;
  const skyStateClear: SignalDetail = {
    active: clearHours >= 2 && thermalWindowHours.length > 0,
    score: thermalWindowHours.length > 0 ? Math.min(100, (clearHours / thermalWindowHours.length) * 100) : 0,
    weight: 0.05,
    value: clearHours > 0 ? `${clearHours}/${thermalWindowHours.length}h despejadas 13-18h` : 'Sin datos sky_state',
  };

  // ── Weighted probability ────────────────────────────────
  const signals: PrecursorSignals = {
    terral,
    deltaTWaterAir,
    solarRamp,
    humidityGradient,
    windDivergence,
    forecastFavorable,
    skyStateClear,
  };

  const probability = Math.min(100, Math.round(
    terral.score * terral.weight +
    deltaTWaterAir.score * deltaTWaterAir.weight +
    solarRamp.score * solarRamp.weight +
    humidityGradient.score * humidityGradient.weight +
    windDivergence.score * windDivergence.weight +
    forecastFavorable.score * forecastFavorable.weight +
    skyStateClear.score * skyStateClear.weight,
  ));

  // ── Confidence ──────────────────────────────────────────
  const activeSignals = [terral, deltaTWaterAir, solarRamp, humidityGradient, windDivergence, forecastFavorable, skyStateClear]
    .filter(s => s.active).length;
  const confidence: 'high' | 'medium' | 'low' =
    activeSignals >= 4 ? 'high' : activeSignals >= 2 ? 'medium' : 'low';

  // ── ETA ─────────────────────────────────────────────────
  const { eta, etaMinutes } = estimateETA(probability, hour, now);

  // ── Level ───────────────────────────────────────────────
  const level = probability >= LEVEL_ACTIVE ? 'active'
    : probability >= LEVEL_IMMINENT ? 'imminent'
    : probability >= LEVEL_PROBABLE ? 'probable'
    : probability >= LEVEL_WATCH ? 'watch'
    : 'none';

  // ── Summary ─────────────────────────────────────────────
  const summary = buildSummary(level, probability, signals, hour, eta);

  return {
    spotId: spot.id,
    probability,
    confidence,
    eta,
    etaMinutes,
    signals,
    summary,
    level,
    computedAt: now,
  };
}

// ── Signal detectors ─────────────────────────────────────

/**
 * Signal 1: Morning terral (land breeze).
 * Coastal stations showing E/NE/SE wind between 6-11h = positive indicator.
 * The terral means overnight cooling created land→sea gradient.
 */
function detectTerral(
  coastal: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
  hour: number,
): SignalDetail {
  const empty: SignalDetail = { active: false, score: 0, value: 'Sin datos costa', weight: W_TERRAL };

  // Terral is a morning signal — strongest before noon
  if (hour > 13) {
    // After 13h, if thermal already started, terral signal is past
    return { ...empty, value: 'Ventana matutina pasada' };
  }

  const coastalWithWind = coastal.filter(s => {
    const r = readings.get(s.id);
    return r && r.windDirection != null && r.windSpeed != null && r.windSpeed >= 0.5;
  });

  if (coastalWithWind.length === 0) return empty;

  // Count stations with terral (offshore) wind
  let terralCount = 0;
  let totalDir = 0;
  let totalSpd = 0;

  for (const s of coastalWithWind) {
    const r = readings.get(s.id)!;
    if (isOffshoreWind(r.windDirection!)) {
      terralCount++;
      totalDir += r.windDirection!;
      totalSpd += msToKnots(r.windSpeed!);
    }
  }

  if (terralCount === 0) {
    return { ...empty, value: 'No hay terral' };
  }

  const ratio = terralCount / coastalWithWind.length;
  const avgSpd = totalSpd / terralCount;

  // Score: ratio of coastal stations showing terral × time bonus
  let score = ratio * 70;

  // Morning bonus (terral is strongest signal 7-10h)
  if (hour >= 7 && hour <= 10) score += 20;
  else if (hour >= 6 && hour <= 12) score += 10;

  // Speed bonus (light terral 2-8kt is ideal)
  if (avgSpd >= 2 && avgSpd <= 8) score += 10;

  score = Math.min(100, Math.round(score));

  const avgDir = Math.round(totalDir / terralCount);
  return {
    active: score >= 30,
    score,
    value: `${degreesToCardinalShort(avgDir)} ${avgSpd.toFixed(0)}kt (${terralCount}/${coastalWithWind.length} est.)`,
    weight: W_TERRAL,
  };
}

/**
 * Signal 2: Water-air temperature differential.
 * When water is significantly warmer than air → thermal gradient exists.
 * Rande buoy (1251) has temp sensors but no anemometer — perfect for this.
 */
function detectDeltaTWaterAir(
  spot: SailingSpot,
  buoys: BuoyReading[],
  readings: Map<string, NormalizedReading>,
): SignalDetail {
  const empty: SignalDetail = { active: false, score: 0, value: 'Sin datos boya', weight: W_DELTA_T };

  // Find nearest buoy with water temp from preferred buoys
  const relevantBuoys = buoys.filter(b =>
    spot.preferredBuoys?.includes(b.stationId) && b.waterTemp != null,
  );

  if (relevantBuoys.length === 0) return empty;

  // Get air temp from nearest land stations
  const airTemps: number[] = [];
  for (const [, r] of readings) {
    if (r.temperature != null) airTemps.push(r.temperature);
  }
  if (airTemps.length === 0) return empty;

  const avgAirTemp = airTemps.reduce((a, b) => a + b, 0) / airTemps.length;

  // Use the buoy with highest water-air delta
  let bestDelta = -Infinity;
  let bestBuoy: BuoyReading | null = null;

  for (const buoy of relevantBuoys) {
    const delta = buoy.waterTemp! - avgAirTemp;
    if (delta > bestDelta) {
      bestDelta = delta;
      bestBuoy = buoy;
    }
  }

  if (!bestBuoy || bestDelta <= 0) {
    return {
      ...empty,
      value: bestDelta != null ? `ΔT ${bestDelta.toFixed(1)}°C (agua más fría)` : 'Sin datos',
    };
  }

  // Score: larger ΔT → stronger thermal gradient
  // ΔT >5°C: excellent | >3°C: good | >1°C: weak
  let score = 0;
  if (bestDelta >= 6) score = 100;
  else if (bestDelta >= 4) score = 80;
  else if (bestDelta >= 3) score = 60;
  else if (bestDelta >= 2) score = 40;
  else if (bestDelta >= 1) score = 20;
  else score = 10;

  return {
    active: score >= 30,
    score,
    value: `ΔT +${bestDelta.toFixed(1)}°C (${bestBuoy.stationName})`,
    weight: W_DELTA_T,
  };
}

/**
 * Signal 3: Solar radiation ramp.
 * Strong morning solar ramp → clear skies → thermal likely.
 * Stations with pyranometers report solarRadiation (W/m²).
 */
function detectSolarRamp(
  stations: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
  hour: number,
): SignalDetail {
  const empty: SignalDetail = { active: false, score: 0, value: 'Sin datos radiación', weight: W_SOLAR };

  // Solar radiation is most meaningful before noon (ramp up phase)
  const solarReadings = stations
    .map(s => readings.get(s.id))
    .filter((r): r is NormalizedReading => r != null && r.solarRadiation != null);

  if (solarReadings.length === 0) return empty;

  const avgSolar = solarReadings.reduce((s, r) => s + r.solarRadiation!, 0) / solarReadings.length;

  // Score based on absolute solar radiation (proxy for clear skies)
  // Expected peak values in Galicia summer: 800-1000 W/m²
  let score = 0;
  if (hour >= 10 && hour <= 15) {
    // Midday: high solar expected
    if (avgSolar >= 800) score = 100;
    else if (avgSolar >= 600) score = 80;
    else if (avgSolar >= 400) score = 50;
    else if (avgSolar >= 200) score = 20;
    else score = 0;
  } else if (hour >= 7 && hour < 10) {
    // Morning ramp: lower absolute values but still meaningful
    if (avgSolar >= 500) score = 100;
    else if (avgSolar >= 300) score = 70;
    else if (avgSolar >= 150) score = 40;
    else score = 10;
  } else {
    // Late afternoon: less relevant
    if (avgSolar >= 400) score = 60;
    else score = 20;
  }

  return {
    active: score >= 40,
    score,
    value: `${Math.round(avgSolar)} W/m² (${solarReadings.length} est.)`,
    weight: W_SOLAR,
  };
}

/**
 * Signal 4: Humidity gradient coast vs inland.
 * When inland stations are drier than coastal → thermal gradient.
 * Coastal humid + inland dry = classic thermal setup.
 */
function detectHumidityGradient(
  coastal: NormalizedStation[],
  inland: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
): SignalDetail {
  const empty: SignalDetail = { active: false, score: 0, value: 'Sin datos humedad', weight: W_HUMIDITY };

  const coastalHumidity = coastal
    .map(s => readings.get(s.id)?.humidity)
    .filter((h): h is number => h != null);

  const inlandHumidity = inland
    .map(s => readings.get(s.id)?.humidity)
    .filter((h): h is number => h != null);

  if (coastalHumidity.length === 0 || inlandHumidity.length === 0) return empty;

  const avgCoastal = coastalHumidity.reduce((a, b) => a + b, 0) / coastalHumidity.length;
  const avgInland = inlandHumidity.reduce((a, b) => a + b, 0) / inlandHumidity.length;

  const gradient = avgCoastal - avgInland; // positive = coast more humid (expected)

  // Score: larger gradient → stronger thermal indicator
  // Typical thermal day: coast 65-80%, inland 40-55% → gradient 15-25%
  let score = 0;
  if (gradient >= 25) score = 100;
  else if (gradient >= 18) score = 80;
  else if (gradient >= 12) score = 60;
  else if (gradient >= 6) score = 35;
  else if (gradient >= 3) score = 15;
  else score = 0;

  // Also check: inland humidity in the sweet spot (40-60%) is positive
  if (avgInland >= 40 && avgInland <= 60) score = Math.min(100, score + 10);
  // Inland too wet (>75%) kills thermal
  if (avgInland > 75) score = Math.max(0, score - 30);

  return {
    active: score >= 30,
    score,
    value: `Costa ${avgCoastal.toFixed(0)}% vs Interior ${avgInland.toFixed(0)}% (Δ${gradient.toFixed(0)}%)`,
    weight: W_HUMIDITY,
  };
}

/**
 * Signal 5: Cross-station wind divergence.
 * Some stations starting to show W/SW while others still calm or E/NE
 * → thermal wind starting to penetrate.
 */
function detectWindDivergence(
  stations: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
  spot: SailingSpot,
): SignalDetail {
  const empty: SignalDetail = { active: false, score: 0, value: 'Sin divergencia', weight: W_DIVERGENCE };

  // Get stations within spot radius with wind data
  const nearby = stations.filter(s => {
    const dist = fastDistanceKm(spot.center[1], spot.center[0], s.lat, s.lon);
    return dist <= spot.radiusKm;
  });

  const withWind = nearby.filter(s => {
    const r = readings.get(s.id);
    return r && r.windDirection != null && r.windSpeed != null && r.windSpeed >= 0.3;
  });

  if (withWind.length < 2) return empty;

  // Count stations in thermal sector vs not
  let thermalCount = 0;
  let otherCount = 0;

  for (const s of withWind) {
    const r = readings.get(s.id)!;
    if (angleDifference(r.windDirection!, THERMAL_DIR_CENTER) <= THERMAL_DIR_TOLERANCE) {
      thermalCount++;
    } else {
      otherCount++;
    }
  }

  if (thermalCount === 0) {
    return { ...empty, value: `0/${withWind.length} est. en sector térmico` };
  }

  // Score: mixed directions (some thermal, some not) = transition happening
  const ratio = thermalCount / withWind.length;
  let score = 0;

  if (ratio >= 0.8) {
    // Most stations showing thermal → already active
    score = 90;
  } else if (ratio >= 0.5) {
    // Half showing thermal → transition in progress
    score = 70;
  } else if (ratio >= 0.25) {
    // Some showing thermal → early penetration
    score = 50;
  } else {
    // Few showing thermal → very early signal
    score = 25;
  }

  return {
    active: score >= 30,
    score,
    value: `${thermalCount}/${withWind.length} est. en WSW (${Math.round(ratio * 100)}%)`,
    weight: W_DIVERGENCE,
  };
}

/**
 * Signal 6: Forecast thermal-favorable.
 * Check if Open-Meteo forecast for today's afternoon shows thermal conditions.
 */
function detectForecastFavorable(
  forecast: HourlyForecast[] | null,
  now: Date,
): SignalDetail {
  const empty: SignalDetail = { active: false, score: 0, value: 'Sin previsión', weight: W_FORECAST };

  if (!forecast || forecast.length === 0) return empty;

  // Look at afternoon hours (13-18h) today
  const todayAfternoon = forecast.filter(f => {
    const h = f.time.getHours();
    const sameDay = f.time.toDateString() === now.toDateString();
    return sameDay && h >= 13 && h <= 18;
  });

  if (todayAfternoon.length === 0) return empty;

  // Score based on forecast conditions
  let totalScore = 0;
  let count = 0;

  for (const f of todayAfternoon) {
    let hourScore = 0;

    // Temperature favorable (≥25°C)
    if (f.temperature != null) {
      if (f.temperature >= 30) hourScore += 30;
      else if (f.temperature >= 27) hourScore += 25;
      else if (f.temperature >= 24) hourScore += 15;
    }

    // Low cloud cover (<30%)
    if (f.cloudCover != null) {
      if (f.cloudCover < 15) hourScore += 25;
      else if (f.cloudCover < 30) hourScore += 20;
      else if (f.cloudCover < 50) hourScore += 10;
    }

    // Wind in thermal direction
    if (f.windDirection != null) {
      if (angleDifference(f.windDirection, THERMAL_DIR_CENTER) <= THERMAL_DIR_TOLERANCE) {
        hourScore += 20;
      }
    }

    // Wind speed 3-8 m/s (6-16kt) ideal for thermal sailing
    if (f.windSpeed != null) {
      const kt = msToKnots(f.windSpeed);
      if (kt >= 6 && kt <= 16) hourScore += 15;
      else if (kt >= 3 && kt <= 20) hourScore += 8;
    }

    // Low precipitation probability
    if (f.precipProbability != null && f.precipProbability < 20) {
      hourScore += 10;
    }

    totalScore += Math.min(100, hourScore);
    count++;
  }

  const avgScore = count > 0 ? Math.round(totalScore / count) : 0;

  return {
    active: avgScore >= 40,
    score: avgScore,
    value: `${todayAfternoon.length}h favorables (${avgScore}%)`,
    weight: W_FORECAST,
  };
}

// ── Helpers ──────────────────────────────────────────────

/** Classify stations as coastal (lon < spot lon - threshold) or inland */
function classifyStations(
  spot: SailingSpot,
  stations: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
): { coastal: NormalizedStation[]; inland: NormalizedStation[] } {
  const coastal: NormalizedStation[] = [];
  const inland: NormalizedStation[] = [];

  // Rías: coastal = closer to Atlantic (lon < -8.5), inland = further east
  // Embalse: coastal = N/A, but lower altitude near river vs higher inland
  const coastLon = -8.5; // approximate coast line longitude for Rías

  for (const s of stations) {
    if (!readings.has(s.id)) continue;
    const dist = fastDistanceKm(spot.center[1], spot.center[0], s.lat, s.lon);
    if (dist > spot.radiusKm * 1.5) continue; // skip distant stations

    if (s.lon < coastLon || (s.altitude != null && s.altitude < 30)) {
      coastal.push(s);
    } else {
      inland.push(s);
    }
  }

  return { coastal, inland };
}

/** Check if wind direction is offshore (terral) — E/NE/SE sector */
function isOffshoreWind(dir: number): boolean {
  // Offshore in Rías Baixas = E/NE/SE (coming from land)
  // Range: 325° → 0° → 135° (wrapping through north)
  return isDirectionInRange(dir, TERRAL_SECTOR);
}

function degreesToCardinalShort(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function estimateETA(
  probability: number,
  hour: number,
  now: Date,
): { eta: string | null; etaMinutes: number | null } {
  if (probability < LEVEL_WATCH) return { eta: null, etaMinutes: null };

  // Typical thermal onset: 13-15h
  const typicalOnset = probability >= LEVEL_IMMINENT ? 13 : 14;
  const typicalEnd = 18;

  if (hour >= typicalEnd) return { eta: null, etaMinutes: null };

  if (hour >= typicalOnset) {
    // Already in thermal window
    return { eta: `${hour}-${typicalEnd}h`, etaMinutes: 0 };
  }

  const minsUntilOnset = (typicalOnset - hour) * 60 - now.getMinutes();
  return {
    eta: `${typicalOnset}-${typicalEnd}h`,
    etaMinutes: Math.max(0, minsUntilOnset),
  };
}

function buildSummary(
  level: string,
  probability: number,
  signals: PrecursorSignals,
  hour: number,
  eta: string | null,
): string {
  switch (level) {
    case 'active':
      return `Térmica activa — ${probability}% señales positivas`;
    case 'imminent':
      return `Térmica inminente${eta ? ` (${eta})` : ''} — ${countActive(signals)} señales activas`;
    case 'probable':
      if (hour < 12) {
        const activeNames = getActiveNames(signals);
        return `Térmica probable${eta ? ` (${eta})` : ''} — ${activeNames}`;
      }
      return `Térmica probable (${probability}%)${eta ? ` · ventana ${eta}` : ''}`;
    case 'watch':
      return `Vigilancia térmica — ${countActive(signals)} precursores débiles`;
    default:
      return 'Sin indicios de térmica';
  }
}

function countActive(signals: PrecursorSignals): number {
  return Object.values(signals).filter(s => s.active).length;
}

function getActiveNames(signals: PrecursorSignals): string {
  const names: string[] = [];
  if (signals.terral.active) names.push('terral');
  if (signals.deltaTWaterAir.active) names.push('ΔT agua-aire');
  if (signals.solarRamp.active) names.push('sol');
  if (signals.humidityGradient.active) names.push('gradiente HR');
  if (signals.windDivergence.active) names.push('divergencia');
  if (signals.forecastFavorable.active) names.push('previsión');
  if (signals.skyStateClear?.active) names.push('cielo WRF');
  return names.join(', ') || 'señales débiles';
}

function emptyResult(spotId: string, now: Date, summary: string): ThermalPrecursorResult {
  const emptySignal: SignalDetail = { active: false, score: 0, value: '', weight: 0 };
  return {
    spotId,
    probability: 0,
    confidence: 'low',
    eta: null,
    etaMinutes: null,
    signals: {
      terral: { ...emptySignal, weight: W_TERRAL },
      deltaTWaterAir: { ...emptySignal, weight: W_DELTA_T },
      solarRamp: { ...emptySignal, weight: W_SOLAR },
      humidityGradient: { ...emptySignal, weight: W_HUMIDITY },
      windDivergence: { ...emptySignal, weight: W_DIVERGENCE },
      forecastFavorable: { ...emptySignal, weight: W_FORECAST },
    },
    summary,
    level: 'none',
    computedAt: now,
  };
}
