/**
 * Maritime (advection) fog predictor for Rías Baixas.
 *
 * Advection fog forms when warm, moist air flows over cold sea water.
 * This is a DIFFERENT mechanism from radiative fog (dewPointService.ts):
 *
 *  Radiative fog: clear night + calm + cooling → T approaches Td → ground fog (inland)
 *  Advection fog: warm moist air + cold water → air cools below Td → sea fog (coastal)
 *
 * Key indicators:
 *   1. Small air-water temperature difference (airTemp - waterTemp < 3°C)
 *   2. Onshore wind (SW-W-NW, 180°-360°) pushing moist air over cold water
 *   3. High humidity (HR > 85%)
 *   4. Light-to-moderate wind (1-6 m/s) — too strong disperses, too calm doesn't advect
 *
 * Galicia-specific context:
 *   - Summer upwelling (N/NW sustained) → cold coastal water (12-14°C)
 *   - Warm air mass arrival from S/SW → massive ΔT → fog in outer rías (Cíes, Ons)
 *   - Inner rías (Cesantes, Rande) less affected — warmer water, sheltered
 */

import type { BuoyReading } from '../api/buoyClient';
import { BUOY_COORDS_MAP } from '../api/buoyClient';
import type { NormalizedReading } from '../types/station';
import type { AlertLevel } from '../types/campo';
import type { UnifiedAlert } from '../services/alertService';
import { angleDifference } from './windUtils';
import { fastDistanceKm } from './idwInterpolation';

// ── Types ────────────────────────────────────────────────────

export interface MaritimeFogRisk {
  level: AlertLevel;
  /** Air-water temperature difference at assessment point (°C) */
  airWaterDelta: number | null;
  /** Average humidity from nearby stations (%) */
  humidity: number | null;
  /** Average wind speed (m/s) */
  windSpeed: number | null;
  /** Average wind direction (degrees) */
  windDir: number | null;
  /** Is wind onshore (pushing moist air over water)? */
  isOnshore: boolean;
  /** Water temperature from buoy (°C) */
  waterTemp: number | null;
  /** Air temperature from buoy or stations (°C) */
  airTemp: number | null;
  /** Confidence 0-100 */
  confidence: number;
  /** Human-readable hypothesis (Spanish) */
  hypothesis: string;
  /** Source buoy name */
  sourceBuoy: string | null;
}

// ── Constants ────────────────────────────────────────────────

/** Onshore wind directions for Galician Atlantic coast (SW through NW) */
const ONSHORE_DIR_MIN = 180; // S
const ONSHORE_DIR_MAX = 360; // N (via W)

/** Wind speed sweet spot for advection fog (m/s) */
const MIN_WIND_FOR_ADVECTION = 1.0;
const MAX_WIND_FOR_ADVECTION = 6.0;

/** Air-water ΔT thresholds */
const DELTA_T_CRITICAL = 1.5;  // °C — fog very likely
const DELTA_T_HIGH = 3.0;      // °C — fog conditions
const DELTA_T_RISK = 5.0;      // °C — elevated risk with other factors

/** Minimum humidity for fog (%) */
const MIN_HUMIDITY_RISK = 80;
const MIN_HUMIDITY_HIGH = 88;

/**
 * Solar radiation threshold (W/m²) — above this, fog has dissipated or cannot form.
 * At 250+ W/m² the sun is clearly shining on the stations — no fog overhead.
 * More conservative than inland threshold (200) because coastal fog can be patchy.
 */
const SOLAR_SUPPRESSION_THRESHOLD = 250;
/** Minimum stations with solar data for reliable suppression */
const MIN_SOLAR_STATIONS = 2;

// ── Helpers ──────────────────────────────────────────────────

/** Check if wind direction is onshore for the Galician Atlantic coast */
function isOnshoreWind(dir: number): boolean {
  // Onshore = S (180°) through W (270°) through NW (315°) to N (360°/0°)
  // Offshore = NE through E through SE (roughly 30°-170°)
  return dir >= ONSHORE_DIR_MIN || dir < 15; // SW-W-NW-N
}

/**
 * Get the best air temperature near a buoy.
 * Priority: buoy's own airTemp → nearest station reading.
 */
function getAirTempNearBuoy(
  buoy: BuoyReading,
  stationReadings: Map<string, NormalizedReading>,
  stations: { id: string; lat: number; lon: number }[],
): number | null {
  // Buoy's own air temp is best
  if (buoy.airTemp !== null) return buoy.airTemp;

  // Find nearest station with temperature
  const coords = BUOY_COORDS_MAP.get(buoy.stationId);
  if (!coords) return null;

  let closest: { temp: number; dist: number } | null = null;
  for (const s of stations) {
    const reading = stationReadings.get(s.id);
    if (!reading || reading.temperature === null) continue;
    const dist = fastDistanceKm(coords.lat, coords.lon, s.lat, s.lon);
    if (dist <= 25 && (!closest || dist < closest.dist)) {
      closest = { temp: reading.temperature, dist };
    }
  }

  return closest?.temp ?? null;
}

/**
 * Get average humidity from station readings near a buoy.
 */
function getHumidityNearBuoy(
  buoy: BuoyReading,
  stationReadings: Map<string, NormalizedReading>,
  stations: { id: string; lat: number; lon: number }[],
): number | null {
  // Observatorio Costeiro buoys have humidity
  if (buoy.humidity !== null) return buoy.humidity;

  const coords = BUOY_COORDS_MAP.get(buoy.stationId);
  if (!coords) return null;

  const nearby: number[] = [];
  for (const s of stations) {
    const reading = stationReadings.get(s.id);
    if (!reading || reading.humidity === null) continue;
    const dist = fastDistanceKm(coords.lat, coords.lon, s.lat, s.lon);
    if (dist <= 20) nearby.push(reading.humidity);
  }

  if (nearby.length === 0) return null;
  return nearby.reduce((a, b) => a + b, 0) / nearby.length;
}

/**
 * Get average wind speed and direction from station readings near a buoy.
 */
function getWindNearBuoy(
  buoy: BuoyReading,
  stationReadings: Map<string, NormalizedReading>,
  stations: { id: string; lat: number; lon: number }[],
): { speed: number; dir: number } | null {
  // Buoy's own wind is best
  if (buoy.windSpeed !== null && buoy.windDir !== null) {
    return { speed: buoy.windSpeed, dir: buoy.windDir };
  }

  const coords = BUOY_COORDS_MAP.get(buoy.stationId);
  if (!coords) return null;

  const points: { speed: number; dir: number; dist: number }[] = [];
  for (const s of stations) {
    const reading = stationReadings.get(s.id);
    if (!reading || reading.windSpeed === null || reading.windDirection === null) continue;
    const dist = fastDistanceKm(coords.lat, coords.lon, s.lat, s.lon);
    if (dist <= 25) {
      points.push({ speed: reading.windSpeed, dir: reading.windDirection, dist });
    }
  }

  if (points.length === 0) return null;

  // Inverse-distance weighted average
  let totalW = 0, wSpeed = 0, sinSum = 0, cosSum = 0;
  for (const p of points) {
    const w = 1 / (p.dist + 1);
    wSpeed += p.speed * w;
    sinSum += Math.sin((p.dir * Math.PI) / 180) * w;
    cosSum += Math.cos((p.dir * Math.PI) / 180) * w;
    totalW += w;
  }

  return {
    speed: wSpeed / totalW,
    dir: ((Math.atan2(sinSum, cosSum) * 180) / Math.PI + 360) % 360,
  };
}

/**
 * Get average solar radiation from stations near a buoy.
 * Returns null if fewer than MIN_SOLAR_STATIONS have data.
 */
function getSolarRadiationNearBuoy(
  buoy: BuoyReading,
  stationReadings: Map<string, NormalizedReading>,
  stations: { id: string; lat: number; lon: number }[],
): number | null {
  const coords = BUOY_COORDS_MAP.get(buoy.stationId);
  if (!coords) return null;

  const nearby: number[] = [];
  for (const s of stations) {
    const reading = stationReadings.get(s.id);
    if (!reading || reading.solarRadiation === null) continue;
    const dist = fastDistanceKm(coords.lat, coords.lon, s.lat, s.lon);
    if (dist <= 30) nearby.push(reading.solarRadiation);
  }

  if (nearby.length < MIN_SOLAR_STATIONS) return null;
  return nearby.reduce((a, b) => a + b, 0) / nearby.length;
}

/**
 * Check if it's daytime (solar suppression only applies when sun should be up).
 */
function isDaytime(): boolean {
  const hour = new Date().getHours();
  return hour >= 9 && hour <= 19;
}

// ── Main Assessment ──────────────────────────────────────────

/**
 * Assess maritime fog risk at a single buoy location.
 */
function assessBuoyFogRisk(
  buoy: BuoyReading,
  stationReadings: Map<string, NormalizedReading>,
  stations: { id: string; lat: number; lon: number }[],
  northWindActive: boolean,
): MaritimeFogRisk {
  const noRisk: MaritimeFogRisk = {
    level: 'none', airWaterDelta: null, humidity: null,
    windSpeed: null, windDir: null, isOnshore: false,
    waterTemp: null, airTemp: null, confidence: 0,
    hypothesis: 'Sin datos suficientes', sourceBuoy: buoy.stationName,
  };

  // Need water temperature — the core input
  if (buoy.waterTemp === null) return noRisk;

  const airTemp = getAirTempNearBuoy(buoy, stationReadings, stations);
  if (airTemp === null) return { ...noRisk, waterTemp: buoy.waterTemp, hypothesis: 'Sin temperatura del aire' };

  const delta = airTemp - buoy.waterTemp;
  const humidity = getHumidityNearBuoy(buoy, stationReadings, stations);
  const wind = getWindNearBuoy(buoy, stationReadings, stations);
  const avgSolar = getSolarRadiationNearBuoy(buoy, stationReadings, stations);

  const onshore = wind ? isOnshoreWind(wind.dir) : false;

  // ── Solar suppression (daytime only) ─────────────────────
  // If stations near this buoy report sustained high solar radiation,
  // the sky is clear — fog has dissipated or cannot form, regardless of
  // other parameters (humidity stays high after fog clears).
  if (isDaytime() && avgSolar !== null && avgSolar > SOLAR_SUPPRESSION_THRESHOLD) {
    return {
      level: 'none',
      airWaterDelta: delta,
      humidity, windSpeed: wind?.speed ?? null, windDir: wind?.dir ?? null,
      isOnshore: onshore, waterTemp: buoy.waterTemp, airTemp,
      confidence: 0,
      hypothesis: `Niebla suprimida por radiación solar (${avgSolar.toFixed(0)} W/m²) — cielo despejado en estaciones costeras`,
      sourceBuoy: buoy.stationName,
    };
  }

  // ── North/NE wind exclusion (sector-wide consensus) ──────
  // A true Galician norte is unmistakable: ≥6kt (3 m/s) from N/NE across
  // practically ALL stations. Not just 1-2 nearby with residual breeze.
  // Check is done at sector level via the northWindSuppression flag.
  if (northWindActive) {
    return {
      level: 'none',
      airWaterDelta: delta,
      humidity, windSpeed: wind?.speed ?? null, windDir: wind?.dir ?? null,
      isOnshore: false, waterTemp: buoy.waterTemp, airTemp,
      confidence: 0,
      hypothesis: `Niebla suprimida: norte claro en estaciones del sector — aire continental seco`,
      sourceBuoy: buoy.stationName,
    };
  }

  // ── Scoring ──────────────────────────────────────────────
  let level: AlertLevel = 'none';
  let confidence = 0;
  const notes: string[] = [];

  // Factor 0: SIGN check — advection fog requires warm air over cold water.
  // When air is COLDER than water (delta < 0), the water WARMS the air →
  // air moves AWAY from dew point → advection fog mechanism is inactive.
  // Only sea smoke (steam fog) could form, which is a different phenomenon.
  if (delta < -1) {
    return {
      level: 'none',
      airWaterDelta: delta,
      humidity, windSpeed: wind?.speed ?? null, windDir: wind?.dir ?? null,
      isOnshore: onshore, waterTemp: buoy.waterTemp, airTemp,
      confidence: 0,
      hypothesis: `ΔT ${delta.toFixed(1)}°C — aire más frío que agua, sin advección`,
      sourceBuoy: buoy.stationName,
    };
  }

  // Near-equilibrium (delta -1 to 0): marginally possible but weak mechanism
  const isNearEquilibrium = delta < 0;

  // Factor 1: Air-water ΔT (most important for advection fog)
  // Only POSITIVE deltas indicate warm-air-over-cold-water mechanism
  if (delta >= 0 && delta <= DELTA_T_CRITICAL) {
    confidence += 40;
    notes.push(`ΔT aire-agua +${delta.toFixed(1)}°C — condensación muy probable`);
  } else if (isNearEquilibrium) {
    // Air barely colder than water — weak signal, cap contribution
    confidence += 10;
    notes.push(`ΔT aire-agua ${delta.toFixed(1)}°C — equilibrio térmico, señal débil`);
  } else if (delta <= DELTA_T_HIGH) {
    confidence += 30;
    notes.push(`ΔT aire-agua +${delta.toFixed(1)}°C — riesgo de condensación`);
  } else if (delta <= DELTA_T_RISK) {
    confidence += 15;
    notes.push(`ΔT aire-agua +${delta.toFixed(1)}°C — moderado`);
  } else {
    // Large ΔT — no fog risk
    return {
      level: 'none',
      airWaterDelta: delta,
      humidity, windSpeed: wind?.speed ?? null, windDir: wind?.dir ?? null,
      isOnshore: onshore, waterTemp: buoy.waterTemp, airTemp,
      confidence: 0,
      hypothesis: `ΔT aire-agua +${delta.toFixed(1)}°C — sin riesgo (aire mucho más cálido que agua)`,
      sourceBuoy: buoy.stationName,
    };
  }

  // Factor 2: Humidity
  if (humidity !== null) {
    if (humidity >= MIN_HUMIDITY_HIGH) {
      confidence += 25;
      notes.push(`HR ${humidity.toFixed(0)}% muy alta`);
    } else if (humidity >= MIN_HUMIDITY_RISK) {
      confidence += 15;
      notes.push(`HR ${humidity.toFixed(0)}%`);
    } else if (humidity < 70) {
      // Dry air — strong suppression
      confidence = Math.max(0, confidence - 20);
      notes.push(`HR ${humidity.toFixed(0)}% baja — suprime niebla`);
    }
  }

  // Factor 3: Wind direction (onshore pushes moist air over cold water)
  if (wind) {
    if (onshore && wind.speed >= MIN_WIND_FOR_ADVECTION && wind.speed <= MAX_WIND_FOR_ADVECTION) {
      confidence += 20;
      notes.push(`viento onshore ${wind.dir.toFixed(0)}° ${wind.speed.toFixed(1)} m/s — advección activa`);
    } else if (onshore && wind.speed > MAX_WIND_FOR_ADVECTION) {
      confidence += 5;
      notes.push(`viento onshore fuerte ${wind.speed.toFixed(1)} m/s — dispersa parcialmente`);
    } else if (!onshore && wind.speed >= 2) {
      // Offshore wind — suppresses advection fog (air moves away from water)
      confidence = Math.max(0, confidence - 15);
      notes.push(`viento offshore ${wind.dir.toFixed(0)}° — aleja aire húmedo`);
    } else if (wind.speed < MIN_WIND_FOR_ADVECTION) {
      confidence += 5;
      notes.push('calma — sin advección, posible niebla radiativa');
    }
  }

  // Factor 4: Solar radiation (daytime partial suppression)
  // Even below full suppression threshold, moderate sun reduces confidence
  if (isDaytime() && avgSolar !== null) {
    if (avgSolar > 150) {
      // Significant sun — fog unlikely to persist
      confidence = Math.max(0, confidence - 20);
      notes.push(`radiación solar ${avgSolar.toFixed(0)} W/m² — sol parcial, niebla improbable`);
    } else if (avgSolar > 80) {
      // Some sun filtering through — fog may be thinning
      confidence = Math.max(0, confidence - 10);
      notes.push(`radiación ${avgSolar.toFixed(0)} W/m² — posible niebla delgada`);
    }
  }

  // Factor 5: Time of day — advection fog more common in evening/night
  // (warm air arrives, sea is cold from daytime upwelling)
  const hour = new Date().getHours();
  if (hour >= 20 || hour < 8) {
    confidence += 5;
    notes.push('horario nocturno favorable');
  }

  confidence = Math.min(100, Math.max(0, confidence));

  // ── Level determination ──────────────────────────────────
  if (delta >= 0 && delta <= DELTA_T_CRITICAL && humidity !== null && humidity >= MIN_HUMIDITY_HIGH && onshore) {
    level = 'critico';
  } else if (delta >= 0 && delta <= DELTA_T_HIGH && confidence >= 50) {
    level = 'alto';
  } else if (delta <= DELTA_T_RISK && confidence >= 35) {
    level = 'riesgo';
  }

  // Near-equilibrium: cap at 'riesgo' — advection mechanism is marginal
  if (isNearEquilibrium && (level === 'critico' || level === 'alto')) {
    level = 'riesgo';
    notes.push('cap: ΔT negativo limita severidad');
  }

  // Downgrade if wind is offshore or too strong
  if (!onshore && wind && wind.speed >= 3 && level !== 'none') {
    if (level === 'riesgo') level = 'none';
    else if (level === 'alto') level = 'riesgo';
    else if (level === 'critico') level = 'alto';
  }

  return {
    level,
    airWaterDelta: delta,
    humidity,
    windSpeed: wind?.speed ?? null,
    windDir: wind?.dir ?? null,
    isOnshore: onshore,
    waterTemp: buoy.waterTemp,
    airTemp,
    confidence,
    hypothesis: notes.join(' · '),
    sourceBuoy: buoy.stationName,
  };
}

// ── Public API ───────────────────────────────────────────────

/**
 * Detect sector-wide north wind consensus.
 *
 * A true Galician norte = N/NE (350°-60°) at ≥3 m/s (~6kt) across the
 * MAJORITY of stations. Not 2 stations with residual breeze — it must be
 * a clear, unmistakable signal from the whole network.
 *
 * Requirements:
 * - At least 4 stations with valid wind data
 * - ≥60% of those stations report N/NE direction
 * - Average speed of northerly stations ≥ 3 m/s (~6kt)
 */
function detectNorthWindConsensus(
  stationReadings: Map<string, NormalizedReading>,
): boolean {
  const MIN_STATIONS = 4;
  const CONSENSUS_RATIO = 0.6; // 60% must agree
  const MIN_NORTH_SPEED = 3.0; // ~6kt

  const windReports: { dir: number; speed: number }[] = [];

  for (const [, reading] of stationReadings) {
    if (reading.windSpeed !== null && reading.windDirection !== null && reading.windSpeed >= 1.5) {
      windReports.push({ dir: reading.windDirection, speed: reading.windSpeed });
    }
  }

  if (windReports.length < MIN_STATIONS) return false;

  // Count northerly stations (N/NE: 350°-60°)
  const northerly = windReports.filter((w) => w.dir >= 350 || w.dir <= 60);
  const ratio = northerly.length / windReports.length;

  if (ratio < CONSENSUS_RATIO) return false;

  // Average speed of northerly stations must be meaningful
  const avgNorthSpeed = northerly.reduce((s, w) => s + w.speed, 0) / northerly.length;
  return avgNorthSpeed >= MIN_NORTH_SPEED;
}

/**
 * Assess maritime fog risk across all buoys.
 * Returns the HIGHEST risk found (worst-case scenario for the sector).
 */
export function assessMaritimeFogRisk(
  buoys: BuoyReading[],
  stationReadings: Map<string, NormalizedReading>,
  stations: { id: string; lat: number; lon: number }[],
): MaritimeFogRisk {
  if (buoys.length === 0) {
    return {
      level: 'none', airWaterDelta: null, humidity: null,
      windSpeed: null, windDir: null, isOnshore: false,
      waterTemp: null, airTemp: null, confidence: 0,
      hypothesis: 'Sin datos de boyas', sourceBuoy: null,
    };
  }

  // Sector-wide north wind check — done ONCE for all buoys
  const northWindActive = detectNorthWindConsensus(stationReadings);

  let worst: MaritimeFogRisk | null = null;
  const LEVEL_ORDER: Record<AlertLevel, number> = { none: 0, riesgo: 1, alto: 2, critico: 3 };

  for (const buoy of buoys) {
    const risk = assessBuoyFogRisk(buoy, stationReadings, stations, northWindActive);
    if (!worst || LEVEL_ORDER[risk.level] > LEVEL_ORDER[worst.level] ||
        (risk.level === worst.level && risk.confidence > worst.confidence)) {
      worst = risk;
    }
  }

  return worst!;
}

/**
 * Build UnifiedAlert[] from maritime fog assessment.
 * Only emits alerts if risk is riesgo or above.
 */
export function buildMaritimeFogAlerts(
  buoys: BuoyReading[],
  stationReadings: Map<string, NormalizedReading>,
  stations: { id: string; lat: number; lon: number }[],
): UnifiedAlert[] {
  const risk = assessMaritimeFogRisk(buoys, stationReadings, stations);
  if (risk.level === 'none') return [];

  const levelToScore: Record<AlertLevel, number> = {
    none: 0, riesgo: 35, alto: 60, critico: 85,
  };
  const score = levelToScore[risk.level];
  const severity = score >= 80 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'moderate' : 'info';

  const deltaStr = risk.airWaterDelta !== null ? `ΔT ${risk.airWaterDelta.toFixed(1)}°C` : '';
  const buoyStr = risk.sourceBuoy ? ` (${risk.sourceBuoy})` : '';

  return [{
    id: 'maritime-fog',
    category: 'fog',
    severity: severity as 'info' | 'moderate' | 'high' | 'critical',
    score,
    icon: 'fog',
    title: risk.level === 'critico'
      ? 'NIEBLA MARÍTIMA INMINENTE'
      : risk.level === 'alto'
        ? 'Niebla marítima probable'
        : 'Riesgo de niebla marítima',
    detail: `${deltaStr}${buoyStr} · ${risk.confidence}% confianza`,
    urgent: risk.level === 'critico',
    updatedAt: new Date(),
  }];
}
