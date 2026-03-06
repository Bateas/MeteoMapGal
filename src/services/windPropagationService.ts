/**
 * Wind Propagation Detection Service
 *
 * Detects wind intensity increases propagating across stations.
 * When upwind stations show rising wind speeds, alerts that stronger
 * wind is heading toward downstream stations.
 *
 * Uses the spatial distribution of weather stations as a primitive "wind radar":
 * 1. Determine dominant wind direction from current readings
 * 2. Sort stations upwind-to-downwind along that direction
 * 3. Analyze recent speed trends (last 30-60 min) at each station
 * 4. If upwind stations are intensifying → alert for downstream stations
 */

import type { NormalizedStation, NormalizedReading } from '../types/station';
import { msToKnots, degreesToCardinal, averageWindDirection } from './windUtils';

// ── Types ────────────────────────────────────────────────

export interface WindPropagationAlert {
  /** Is there a propagation event detected? */
  active: boolean;
  /** Dominant wind direction (degrees) across stations */
  dominantDirection: number | null;
  /** Cardinal label */
  directionLabel: string;
  /** Upwind stations showing speed increase */
  upwindStations: PropagationStation[];
  /** Downstream stations that will be affected */
  downwindStations: PropagationStation[];
  /** Estimated arrival time at downstream stations (minutes) */
  estimatedArrivalMin: number | null;
  /** Average speed increase at upwind stations (m/s) */
  avgSpeedIncrease: number;
  /** Current max speed at upwind front (m/s) */
  frontSpeed: number;
  /** Confidence (0-100) based on number of stations and consistency */
  confidence: number;
  /** Human-readable summary */
  summary: string;
}

export interface PropagationStation {
  id: string;
  name: string;
  /** Current wind speed (m/s) */
  currentSpeed: number;
  /** Speed trend over recent readings (m/s per 10min) */
  speedTrend: number;
  /** Distance along wind axis from reference (km, negative = upwind) */
  axisDistance: number;
}

// ── Constants ────────────────────────────────────────────

/** Minimum readings needed to compute a trend */
const MIN_READINGS_FOR_TREND = 3;

/** Time window to analyze trends (ms) — last 40 minutes */
const TREND_WINDOW_MS = 40 * 60 * 1000;

/** Minimum speed increase to consider significant (m/s per 10min) */
const SIGNIFICANT_TREND = 0.8; // ~1.5 kt per 10min

/** Minimum number of upwind stations showing increase to trigger alert */
const MIN_UPWIND_STATIONS = 2;

/** Estimated wind propagation speed across terrain (km/h) — conservative */
const PROPAGATION_SPEED_KMH = 30;

/** Reference point (Embalse de Castrelo) */
const REF_LAT = 42.295;
const REF_LON = -8.115;

// ── Core functions ───────────────────────────────────────

/**
 * Compute haversine distance between two points (km)
 */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Project a station's position onto the wind axis.
 * Returns distance along axis in km (negative = upwind, positive = downwind).
 * Wind direction is "from" convention → wind comes FROM this direction.
 */
function projectOntoWindAxis(
  stationLat: number,
  stationLon: number,
  windFromDeg: number,
): number {
  // Wind comes FROM windFromDeg, travels TO windFromDeg + 180
  // Upwind stations are in the direction the wind comes FROM
  const windToRad = ((windFromDeg + 180) % 360) * Math.PI / 180;

  // Vector from reference to station (rough km at this latitude)
  const dLat = (stationLat - REF_LAT) * 111.32;
  const dLon = (stationLon - REF_LON) * 111.32 * Math.cos(REF_LAT * Math.PI / 180);

  // Wind travel direction unit vector (north = +y, east = +x)
  const windX = Math.sin(windToRad);
  const windY = Math.cos(windToRad);

  // Dot product: positive = downwind (station is in direction wind is going)
  return dLat * windY + dLon * windX;
}

/**
 * Compute wind speed trend from recent readings.
 * Returns m/s per 10 minutes (positive = increasing).
 */
function computeSpeedTrend(
  history: NormalizedReading[],
  now: number,
): number | null {
  // Filter to recent window, only entries with wind data
  const recent = history.filter(
    (r) => r.windSpeed !== null && (now - r.timestamp.getTime()) < TREND_WINDOW_MS
  );

  if (recent.length < MIN_READINGS_FOR_TREND) return null;

  // Sort by time ascending
  recent.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // Simple linear regression on (time, speed)
  const n = recent.length;
  let sumT = 0, sumS = 0, sumTS = 0, sumTT = 0;

  for (const r of recent) {
    // Time in minutes from first reading
    const t = (r.timestamp.getTime() - recent[0].timestamp.getTime()) / (60 * 1000);
    const s = r.windSpeed!;
    sumT += t;
    sumS += s;
    sumTS += t * s;
    sumTT += t * t;
  }

  const denom = n * sumTT - sumT * sumT;
  if (Math.abs(denom) < 0.001) return null;

  // Slope = m/s per minute → convert to per 10min
  const slope = (n * sumTS - sumT * sumS) / denom;
  return slope * 10;
}

/**
 * Get dominant wind direction from current readings.
 * Filters to stations with valid wind data and uses circular mean.
 */
function getDominantDirection(
  currentReadings: Map<string, NormalizedReading>,
): number | null {
  const directions: number[] = [];
  for (const reading of currentReadings.values()) {
    if (reading.windDirection !== null && reading.windSpeed !== null && reading.windSpeed > 0.5) {
      directions.push(reading.windDirection);
    }
  }
  if (directions.length < 3) return null;
  return averageWindDirection(directions);
}

// ── Main detection function ──────────────────────────────

/**
 * Analyze wind propagation across all stations.
 */
export function detectWindPropagation(
  stations: NormalizedStation[],
  currentReadings: Map<string, NormalizedReading>,
  readingHistory: Map<string, NormalizedReading[]>,
): WindPropagationAlert {
  const noAlert: WindPropagationAlert = {
    active: false,
    dominantDirection: null,
    directionLabel: '--',
    upwindStations: [],
    downwindStations: [],
    estimatedArrivalMin: null,
    avgSpeedIncrease: 0,
    frontSpeed: 0,
    confidence: 0,
    summary: 'Sin datos suficientes para detectar propagación',
  };

  // 1. Determine dominant wind direction
  const dominantDir = getDominantDirection(currentReadings);
  if (dominantDir === null) return noAlert;

  const now = Date.now();

  // 2. Build station data with axis projection and trend
  const stationData: PropagationStation[] = [];
  for (const station of stations) {
    if (station.tempOnly) continue; // skip temp-only stations
    const reading = currentReadings.get(station.id);
    if (!reading || reading.windSpeed === null) continue;

    const history = readingHistory.get(station.id) || [];
    const trend = computeSpeedTrend(history, now);
    if (trend === null) continue;

    const axisDistance = projectOntoWindAxis(station.lat, station.lon, dominantDir);

    stationData.push({
      id: station.id,
      name: station.name,
      currentSpeed: reading.windSpeed,
      speedTrend: trend,
      axisDistance,
    });
  }

  if (stationData.length < 3) {
    return { ...noAlert, dominantDirection: dominantDir, directionLabel: degreesToCardinal(dominantDir) };
  }

  // 3. Sort by axis distance (most upwind first → most downwind last)
  stationData.sort((a, b) => a.axisDistance - b.axisDistance);

  // 4. Split into upwind (negative axis = where wind comes FROM) and downwind
  const upwind = stationData.filter((s) => s.axisDistance < -1); // > 1km upwind
  const downwind = stationData.filter((s) => s.axisDistance >= -1);

  // 5. Detect: upwind stations with significant speed increases
  const intensifyingUpwind = upwind.filter((s) => s.speedTrend >= SIGNIFICANT_TREND);

  if (intensifyingUpwind.length < MIN_UPWIND_STATIONS) {
    return {
      ...noAlert,
      active: false,
      dominantDirection: dominantDir,
      directionLabel: degreesToCardinal(dominantDir),
      upwindStations: upwind,
      downwindStations: downwind,
      summary: 'Sin señal de intensificación en estaciones a barlovento',
    };
  }

  // 6. Compute metrics
  const avgIncrease = intensifyingUpwind.reduce((s, st) => s + st.speedTrend, 0) / intensifyingUpwind.length;
  const frontSpeed = Math.max(...intensifyingUpwind.map((s) => s.currentSpeed));

  // Estimate arrival: distance from closest intensifying station to reference / propagation speed
  const closestUpwind = intensifyingUpwind.reduce((a, b) =>
    Math.abs(a.axisDistance) < Math.abs(b.axisDistance) ? a : b
  );
  const distanceKm = Math.abs(closestUpwind.axisDistance);
  const estimatedArrivalMin = Math.round((distanceKm / PROPAGATION_SPEED_KMH) * 60);

  // 7. Confidence based on consistency and number of stations
  let confidence = 0;
  // More intensifying stations → higher confidence
  confidence += Math.min(intensifyingUpwind.length * 20, 40);
  // Consistent direction across stations
  const dirSpread = computeDirectionSpread(currentReadings);
  if (dirSpread !== null) {
    confidence += dirSpread < 30 ? 30 : dirSpread < 60 ? 15 : 0;
  }
  // Stronger trend → higher confidence
  confidence += Math.min(avgIncrease * 10, 30);
  confidence = Math.min(Math.round(confidence), 100);

  // 8. Build summary
  const dirLabel = degreesToCardinal(dominantDir);
  const frontKt = msToKnots(frontSpeed).toFixed(0);
  const increaseKt = msToKnots(avgIncrease).toFixed(1);
  const stationNames = intensifyingUpwind.map((s) => s.name).join(', ');

  const summary = estimatedArrivalMin > 0
    ? `Viento ${dirLabel} intensificándose: ${stationNames} suben +${increaseKt} kt/10min. Frente a ${frontKt} kt. Llegada estimada ~${estimatedArrivalMin} min.`
    : `Viento ${dirLabel} intensificándose: ${stationNames} suben +${increaseKt} kt/10min. Frente a ${frontKt} kt.`;

  return {
    active: true,
    dominantDirection: dominantDir,
    directionLabel: dirLabel,
    upwindStations: intensifyingUpwind,
    downwindStations: downwind,
    estimatedArrivalMin: estimatedArrivalMin > 0 ? estimatedArrivalMin : null,
    avgSpeedIncrease: avgIncrease,
    frontSpeed,
    confidence,
    summary,
  };
}

/**
 * Compute the spread of wind directions across all stations (degrees).
 * Lower values mean more consistent direction.
 */
export function computeDirectionSpread(
  currentReadings: Map<string, NormalizedReading>,
): number | null {
  const dirs: number[] = [];
  for (const r of currentReadings.values()) {
    if (r.windDirection !== null && r.windSpeed !== null && r.windSpeed > 0.5) {
      dirs.push(r.windDirection);
    }
  }
  if (dirs.length < 3) return null;

  // Use circular statistics: R = sqrt(sumSin² + sumCos²) / n
  // Spread ≈ acos(R) in degrees
  const n = dirs.length;
  let sinSum = 0, cosSum = 0;
  for (const d of dirs) {
    const rad = d * Math.PI / 180;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }
  const R = Math.sqrt(sinSum ** 2 + cosSum ** 2) / n;
  // Convert mean resultant length to angular spread
  // R=1 → perfect alignment (0°), R=0 → uniform (180°)
  return Math.acos(Math.min(R, 1)) * 180 / Math.PI;
}
