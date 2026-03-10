/**
 * Tendency Detector — Early warning system for thermal wind onset.
 *
 * Based on real precursor signals from historical analysis:
 * - Meteostat WMO Ourense (08048): 2021-2024 hourly data, 481 summer days
 * - Open-Meteo Archive: 7 points, 2019-2025, 854 summer days each
 * - AEMET daily: 3 stations, 2022-2025, 1412 records
 *
 * Key findings:
 * - 87% of thermal days show ≥4°C temperature rise between 8h-11h
 * - 82% of thermal days already show W/SW/NW wind at 11h
 * - At peak-4h: T≈28°C, HR≈47%, Wind≈3 m/s W
 * - ΔT > 20°C → 42% thermal probability; ΔT < 8°C → thermals very unlikely
 * - Valley stations (105-218m): 31-34% thermal probability in summer
 * - Humidity sweet spot: 45-65% (not too dry, not too humid)
 */

import type { NormalizedReading } from '../types/station';
import type { MicroZoneId, TendencySignal, TendencyLevel, DailyContext } from '../types/thermal';
import { isDirectionInRange, angleDifference } from './windUtils';

// ── Thermal sector: W/SW/NW (202.5° to 337.5°) ──────────
const THERMAL_SECTOR = { from: 202.5, to: 337.5 };

// ── Thresholds derived from Meteostat hourly analysis ────

/** Temperature rise rate (°C/h) thresholds */
const TEMP_RISE_EXCELLENT = 2.0;  // ≥2°C/h → strong precursor
const TEMP_RISE_GOOD = 1.3;      // typical thermal day rise
const TEMP_RISE_MIN = 0.8;       // minimum meaningful rise

/** Absolute temperature thresholds (°C) */
const TEMP_THRESHOLD_HIGH = 28;   // typical peak-4h temperature
const TEMP_THRESHOLD_LOW = 24;    // minimum for thermal activity

/** Humidity thresholds (%) — sweet spot is 45-65% */
const HR_OPTIMAL_LOW = 45;
const HR_OPTIMAL_HIGH = 65;
const HR_TOO_DRY = 30;
const HR_TOO_WET = 75;

/** Humidity drop rate thresholds (%/h) */
const HR_DROP_STRONG = 3.0;      // strong drying trend
const HR_DROP_MIN = 1.0;         // minimum meaningful drop

/** ΔT thresholds (°C) */
const DT_EXCELLENT = 20;
const DT_GOOD = 15;
const DT_POOR = 8;

/** Score thresholds for tendency levels */
const SCORE_ACTIVE = 70;
const SCORE_LIKELY = 50;
const SCORE_BUILDING = 30;

/**
 * Analyze reading history for a zone to detect thermal tendency.
 *
 * @param zoneId - The zone being analyzed
 * @param currentReadings - Latest readings for stations in this zone
 * @param history - Historical readings (last 2-4 hours) for stations in this zone
 * @param dailyContext - ΔT context from Open-Meteo forecast
 * @param now - Current time (injectable for testing)
 */
export function detectTendency(
  zoneId: MicroZoneId,
  currentReadings: NormalizedReading[],
  history: NormalizedReading[][],
  dailyContext: DailyContext | null,
  now: Date = new Date(),
): TendencySignal {
  const hour = now.getHours();
  const month = now.getMonth() + 1;

  // Only analyze during thermal-relevant hours (8h-21h) and months (May-Sep)
  if (hour < 8 || hour > 21 || month < 5 || month > 9) {
    return emptySignal(zoneId, now);
  }

  // Get current conditions (average across stations in zone)
  const current = averageReadings(currentReadings);
  if (!current.temperature || !current.windDirection) {
    return emptySignal(zoneId, now);
  }

  // Build time series from history (flatten all station histories)
  const timeSeries = buildTimeSeries(history, now);

  // ── 1. Temperature rise rate (0-25 pts) ────────────────
  const tempRiseRate = computeRiseRate(timeSeries, 'temperature', 2);
  let tempRiseScore = 0;
  if (tempRiseRate !== null) {
    if (tempRiseRate >= TEMP_RISE_EXCELLENT) tempRiseScore = 25;
    else if (tempRiseRate >= TEMP_RISE_GOOD) tempRiseScore = 20;
    else if (tempRiseRate >= TEMP_RISE_MIN) tempRiseScore = 12;
    else if (tempRiseRate > 0) tempRiseScore = 5;
  }

  // ── 2. Wind direction in thermal sector (0-25 pts) ─────
  const windInSector = isDirectionInRange(current.windDirection!, THERMAL_SECTOR);
  let windDirScore = 0;
  if (windInSector) {
    windDirScore = 25;
    // Bonus check: was wind NOT in sector 2h ago? (rotation happening)
    const oldDir = getValueAtOffset(timeSeries, 'windDirection', 2);
    if (oldDir !== null && !isDirectionInRange(oldDir, THERMAL_SECTOR)) {
      // Wind just rotated into thermal sector — strong signal
      windDirScore = 25;
    }
  } else {
    // Check if wind is rotating towards thermal sector
    const dirTrend = computeDirectionTrend(timeSeries, now);
    if (dirTrend === 'approaching') windDirScore = 10;
  }

  // ── 3. Humidity dropping trend (0-20 pts) ──────────────
  const humidityDropRate = computeRiseRate(timeSeries, 'humidity', 2);
  const hrDropRate = humidityDropRate !== null ? -humidityDropRate : null;
  let humidityScore = 0;
  if (hrDropRate !== null && hrDropRate > 0) {
    if (hrDropRate >= HR_DROP_STRONG) humidityScore = 20;
    else if (hrDropRate >= HR_DROP_MIN) humidityScore = 12;
    else humidityScore = 5;
  }
  // Also check absolute humidity is in sweet spot
  if (current.humidity !== null) {
    if (current.humidity >= HR_OPTIMAL_LOW && current.humidity <= HR_OPTIMAL_HIGH) {
      humidityScore = Math.min(20, humidityScore + 5);
    } else if (current.humidity < HR_TOO_DRY || current.humidity > HR_TOO_WET) {
      humidityScore = Math.max(0, humidityScore - 5);
    }
  }

  // ── 4. ΔT context (0-15 pts) ──────────────────────────
  let deltaTScore = 0;
  if (dailyContext?.deltaT !== null && dailyContext?.deltaT !== undefined) {
    if (dailyContext.deltaT >= DT_EXCELLENT) deltaTScore = 15;
    else if (dailyContext.deltaT >= DT_GOOD) deltaTScore = 12;
    else if (dailyContext.deltaT >= DT_POOR) deltaTScore = 7;
    else deltaTScore = 0; // ΔT < 8°C → thermals very unlikely
  }

  // ── 5. Current temperature threshold (0-15 pts) ───────
  const tempAboveThreshold = current.temperature! >= TEMP_THRESHOLD_LOW;
  let tempScore = 0;
  if (current.temperature! >= TEMP_THRESHOLD_HIGH) tempScore = 15;
  else if (current.temperature! >= TEMP_THRESHOLD_LOW) {
    // Proportional between 24 and 28
    tempScore = Math.round(15 * (current.temperature! - TEMP_THRESHOLD_LOW) / (TEMP_THRESHOLD_HIGH - TEMP_THRESHOLD_LOW));
  }

  // ── Total score ────────────────────────────────────────
  const score = Math.min(100, tempRiseScore + windDirScore + humidityScore + deltaTScore + tempScore);

  // ── Estimate onset time ────────────────────────────────
  let estimatedOnsetMin: number | null = null;
  if (score >= SCORE_BUILDING && score < SCORE_ACTIVE) {
    // Estimate based on typical thermal timeline:
    // Peak thermal usually at 15-17h. If current hour < 15, estimate remaining time
    const peakHour = 16;
    if (hour < peakHour) {
      estimatedOnsetMin = (peakHour - hour) * 60;
      // Adjust by score: higher score = sooner onset
      estimatedOnsetMin = Math.round(estimatedOnsetMin * (1 - (score - SCORE_BUILDING) / 100));
    } else {
      estimatedOnsetMin = 30; // Already in window, onset imminent
    }
  }

  const level = scoreToLevel(score);
  const summary = buildSummary(level, score, tempRiseRate, windInSector, current.temperature!, hour);

  return {
    zoneId,
    score,
    level,
    precursors: {
      tempRiseRate,
      tempRiseScore,
      windInSector,
      windDirScore,
      humidityDropRate: hrDropRate,
      humidityScore,
      deltaTScore,
      tempAboveThreshold,
      tempScore,
    },
    estimatedOnsetMin,
    summary,
    computedAt: now,
  };
}

// ── Helpers ──────────────────────────────────────────────

function emptySignal(zoneId: MicroZoneId, now: Date): TendencySignal {
  return {
    zoneId,
    score: 0,
    level: 'none',
    precursors: {
      tempRiseRate: null,
      tempRiseScore: 0,
      windInSector: false,
      windDirScore: 0,
      humidityDropRate: null,
      humidityScore: 0,
      deltaTScore: 0,
      tempAboveThreshold: false,
      tempScore: 0,
    },
    estimatedOnsetMin: null,
    summary: 'Fuera de ventana térmica',
    computedAt: now,
  };
}

function scoreToLevel(score: number): TendencyLevel {
  if (score >= SCORE_ACTIVE) return 'active';
  if (score >= SCORE_LIKELY) return 'likely';
  if (score >= SCORE_BUILDING) return 'building';
  return 'none';
}

interface AveragedValues {
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  windDirection: number | null;
}

function averageReadings(readings: NormalizedReading[]): AveragedValues {
  if (readings.length === 0) {
    return { temperature: null, humidity: null, windSpeed: null, windDirection: null };
  }

  const temps = readings.map(r => r.temperature).filter((v): v is number => v !== null);
  const hums = readings.map(r => r.humidity).filter((v): v is number => v !== null);
  const speeds = readings.map(r => r.windSpeed).filter((v): v is number => v !== null);
  const dirs = readings.map(r => r.windDirection).filter((v): v is number => v !== null);

  return {
    temperature: temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : null,
    humidity: hums.length > 0 ? hums.reduce((a, b) => a + b, 0) / hums.length : null,
    windSpeed: speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null,
    windDirection: dirs.length > 0 ? circularMean(dirs) : null,
  };
}

function circularMean(angles: number[]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  let sinSum = 0, cosSum = 0;
  for (const a of angles) {
    sinSum += Math.sin(toRad(a));
    cosSum += Math.cos(toRad(a));
  }
  return ((Math.atan2(sinSum, cosSum) * 180 / Math.PI) + 360) % 360;
}

interface TimeSeriesPoint {
  timestamp: Date;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  windDirection: number | null;
}

/**
 * Build a chronologically sorted time series from station histories.
 * Averages readings from multiple stations at the same time point.
 */
function buildTimeSeries(
  histories: NormalizedReading[][],
  now: Date,
): TimeSeriesPoint[] {
  // Flatten all readings from all stations
  const allReadings: NormalizedReading[] = [];
  for (const stationHistory of histories) {
    for (const reading of stationHistory) {
      // Only include readings from last 4 hours
      const ageMs = now.getTime() - reading.timestamp.getTime();
      if (ageMs >= 0 && ageMs <= 4 * 60 * 60 * 1000) {
        allReadings.push(reading);
      }
    }
  }

  if (allReadings.length === 0) return [];

  // Group by 10-minute buckets
  const buckets = new Map<number, NormalizedReading[]>();
  for (const r of allReadings) {
    const bucketKey = Math.floor(r.timestamp.getTime() / (10 * 60 * 1000));
    const bucket = buckets.get(bucketKey) || [];
    bucket.push(r);
    buckets.set(bucketKey, bucket);
  }

  // Average each bucket
  const series: TimeSeriesPoint[] = [];
  for (const [key, readings] of buckets) {
    const avg = averageReadings(readings);
    series.push({
      timestamp: new Date(key * 10 * 60 * 1000),
      ...avg,
    });
  }

  series.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return series;
}

/**
 * Compute rise rate for a variable over a given number of hours.
 * Returns value change per hour (positive = rising).
 */
function computeRiseRate(
  series: TimeSeriesPoint[],
  field: 'temperature' | 'humidity' | 'windSpeed',
  hours: number,
): number | null {
  if (series.length < 2) return null;

  const latest = series[series.length - 1];
  const latestVal = latest[field];
  if (latestVal === null) return null;

  // Find the reading closest to `hours` ago
  const targetTime = latest.timestamp.getTime() - hours * 60 * 60 * 1000;
  let closest: TimeSeriesPoint | null = null;
  let closestDist = Infinity;

  for (const point of series) {
    const dist = Math.abs(point.timestamp.getTime() - targetTime);
    if (dist < closestDist && point[field] !== null) {
      closest = point;
      closestDist = dist;
    }
  }

  // Must have a point within 30 minutes of target time
  if (!closest || closestDist > 30 * 60 * 1000) return null;
  const oldVal = closest[field];
  if (oldVal === null) return null;

  const actualHours = (latest.timestamp.getTime() - closest.timestamp.getTime()) / (60 * 60 * 1000);
  if (actualHours < 0.5) return null; // Need at least 30 min of data

  return (latestVal - oldVal) / actualHours;
}

/**
 * Get the value of a field at approximately `hoursAgo` from the latest point.
 */
function getValueAtOffset(
  series: TimeSeriesPoint[],
  field: 'temperature' | 'humidity' | 'windSpeed' | 'windDirection',
  hoursAgo: number,
): number | null {
  if (series.length === 0) return null;

  const latest = series[series.length - 1];
  const targetTime = latest.timestamp.getTime() - hoursAgo * 60 * 60 * 1000;

  let closest: TimeSeriesPoint | null = null;
  let closestDist = Infinity;

  for (const point of series) {
    const dist = Math.abs(point.timestamp.getTime() - targetTime);
    if (dist < closestDist && point[field] !== null) {
      closest = point;
      closestDist = dist;
    }
  }

  if (!closest || closestDist > 30 * 60 * 1000) return null;
  return closest[field];
}

/**
 * Detect if wind direction is trending towards the thermal sector.
 */
function computeDirectionTrend(
  series: TimeSeriesPoint[],
  _now: Date,
): 'approaching' | 'departing' | 'stable' {
  if (series.length < 3) return 'stable';

  const latest = series[series.length - 1];
  const oldDir = getValueAtOffset(series, 'windDirection', 1);

  if (!latest.windDirection || oldDir === null) return 'stable';

  // Distance to center of thermal sector (270° = W)
  const thermalCenter = 270;
  const currentDist = angleDifference(latest.windDirection, thermalCenter);
  const oldDist = angleDifference(oldDir, thermalCenter);

  if (oldDist - currentDist > 15) return 'approaching'; // Getting closer
  if (currentDist - oldDist > 15) return 'departing';
  return 'stable';
}


function buildSummary(
  level: TendencyLevel,
  score: number,
  tempRise: number | null,
  windInSector: boolean,
  currentTemp: number,
  hour: number,
): string {
  switch (level) {
    case 'active':
      return `Térmico activo — ${Math.round(currentTemp)}°C, viento ${windInSector ? 'en sector' : 'rotando'}`;
    case 'likely':
      if (windInSector && tempRise !== null && tempRise > 1) {
        return `Probable — T subiendo ${tempRise.toFixed(1)}°C/h, viento ya en sector W-NW`;
      }
      return `Probable (${score}%) — condiciones favorables desarrollándose`;
    case 'building':
      if (hour < 12) {
        return `Formándose — vigilar evolución matinal`;
      }
      return `Formándose (${score}%) — señales precursoras presentes`;
    default:
      if (hour >= 8 && hour <= 21) {
        return `Sin tendencia térmica clara`;
      }
      return 'Fuera de ventana térmica';
  }
}
