import type { NormalizedStation, NormalizedReading } from '../types/station';

// ── Types ─────────────────────────────────────────────────

export interface StationTempData {
  stationId: string;
  name: string;
  lat: number;
  lon: number;
  altitude: number;        // meters
  temperature: number;     // °C (always non-null after filtering)
}

/** Result of linear regression: temperature = slope * altitude + intercept */
export interface LapseRateRegression {
  /** °C per 1000 m. Negative = normal cooling with altitude, positive = inversion */
  slopePerKm: number;
  /** Temperature at sea level (°C), from regression */
  interceptC: number;
  /** R² goodness-of-fit (0–1). Higher = altitude explains temperature well */
  rSquared: number;
  /** Number of stations used in regression */
  stationCount: number;
}

export type ThermalStatus =
  | 'normal'
  | 'weak-inversion'
  | 'strong-inversion'
  | 'insufficient-data';

export interface ThermalProfile {
  /** All stations with valid temp+altitude used in the analysis */
  stations: StationTempData[];
  /** Linear regression result (null if insufficient data) */
  regression: LapseRateRegression | null;
  /** Overall lapse rate in °C/km from regression slope */
  overallLapseRate: number | null;
  /** True only when regression confirms a REAL inversion across the area */
  hasInversion: boolean;
  status: ThermalStatus;
  /** Human-readable Spanish description */
  summary: string;
}

// ── Constants ─────────────────────────────────────────────

/** Standard environmental lapse rate (°C per km, negative = cooling with altitude) */
export const STANDARD_LAPSE_RATE = -6.5;

/**
 * Minimum valid altitude (m). Stations below this are excluded because inland
 * Ourense has no real stations at sea level — altitude=0 from WU means "unknown".
 */
export const MIN_VALID_ALTITUDE = 30;

/**
 * Maximum reading age (ms) to consider a station usable for gradient analysis.
 * Temperature changes slowly — a 1-2h old reading is still valid for lapse rate.
 * AEMET rate-limits and MeteoGalicia delays regularly cause 60-90 min gaps,
 * so 2 hours keeps key stations (Ribadavia, Remuíño, Amiudal) in the analysis.
 */
export const MAX_READING_AGE_MS = 120 * 60 * 1000;

/**
 * Minimum station count for reliable regression.
 * With fewer than this, the lapse rate estimate is too noisy.
 */
export const MIN_STATIONS_FOR_ANALYSIS = 4;

/**
 * Minimum R² to trust the regression enough for an inversion alert.
 * If R² is low, altitude doesn't explain temperature well → other factors dominate.
 */
export const MIN_R_SQUARED_FOR_ALERT = 0.25;

/**
 * Minimum altitude spread (m) among stations to make a meaningful comparison.
 * If all stations are at similar altitudes, lapse rate is meaningless.
 */
export const MIN_ALTITUDE_SPREAD = 150;

/**
 * Minimum positive slope (°C/km) to flag an inversion.
 * Slopes between 0 and this value are treated as "isothermal / normal" —
 * not alarming enough to warrant an alert. This prevents false positives
 * from near-zero slopes that could be statistical noise.
 *
 * Real inversions in Ourense valleys typically show +2 to +8 °C/km.
 */
export const MIN_INVERSION_SLOPE = 1.0;

// ── Functions ─────────────────────────────────────────────

/**
 * Extract stations with valid, fresh temperature readings and reliable altitude.
 * Used for **lapse rate regression** — requires altitude ≥ MIN_VALID_ALTITUDE.
 *
 * Filters out:
 * - Stations with altitude < MIN_VALID_ALTITUDE (bad data from APIs returning 0)
 * - Stations with null temperature
 * - Stations with stale readings (older than MAX_READING_AGE_MS)
 */
export function extractStationTemps(
  stations: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
): StationTempData[] {
  return extractTemps(stations, readings, true);
}

/**
 * Extract ALL stations with valid, fresh temperature readings.
 * Used for the **temperature overlay** — no altitude filter, so coastal
 * stations at 0-29m are included for visual display.
 */
export function extractAllStationTemps(
  stations: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
): StationTempData[] {
  return extractTemps(stations, readings, false);
}

function extractTemps(
  stations: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
  requireAltitude: boolean,
): StationTempData[] {
  const now = Date.now();
  const result: StationTempData[] = [];

  for (const s of stations) {
    // Skip stations with unreliable altitude (only for lapse rate analysis)
    if (requireAltitude && s.altitude < MIN_VALID_ALTITUDE) continue;

    const r = readings.get(s.id);
    if (!r || r.temperature === null) continue;

    // Skip stale readings — stations marked "offline" or not updated recently
    const readingAge = now - r.timestamp.getTime();
    if (readingAge > MAX_READING_AGE_MS) continue;

    result.push({
      stationId: s.id,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      altitude: s.altitude,
      temperature: r.temperature,
    });
  }
  return result;
}

/**
 * Compute linear regression: temperature = slope * altitude + intercept
 * using ordinary least squares.
 *
 * Returns null if there aren't enough stations or altitude spread.
 */
export function computeLinearRegression(
  stationTemps: StationTempData[],
): LapseRateRegression | null {
  const n = stationTemps.length;
  if (n < MIN_STATIONS_FOR_ANALYSIS) return null;

  // Check altitude spread
  const altitudes = stationTemps.map((s) => s.altitude);
  const altMin = Math.min(...altitudes);
  const altMax = Math.max(...altitudes);
  if (altMax - altMin < MIN_ALTITUDE_SPREAD) return null;

  // OLS: y = temperature, x = altitude
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (const s of stationTemps) {
    sumX += s.altitude;
    sumY += s.temperature;
    sumXY += s.altitude * s.temperature;
    sumX2 += s.altitude * s.altitude;
    sumY2 += s.temperature * s.temperature;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return null; // degenerate

  const slope = (n * sumXY - sumX * sumY) / denom;        // °C per meter
  const intercept = (sumY - slope * sumX) / n;             // °C at 0m

  // R² (coefficient of determination)
  const ssRes = sumY2 - intercept * sumY - slope * sumXY;
  const meanY = sumY / n;
  const ssTot = sumY2 - n * meanY * meanY;
  const rSquared = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;

  return {
    slopePerKm: slope * 1000,  // convert from °C/m to °C/km
    interceptC: intercept,
    rSquared,
    stationCount: n,
  };
}

/**
 * Build the thermal profile using linear regression across ALL valid stations.
 *
 * This is much more robust than pairwise comparison because:
 * - One outlier station doesn't trigger a false inversion
 * - R² tells us how much altitude actually explains temperature variation
 * - The regression slope represents the OVERALL trend, not cherry-picked pairs
 *
 * An inversion is only flagged when:
 * 1. The regression slope is positive (temperature increases with altitude)
 * 2. R² is above threshold (the correlation is meaningful, not noise)
 * 3. We have enough stations and altitude spread
 */
export function analyzeThermalProfile(stationTemps: StationTempData[]): ThermalProfile {
  if (stationTemps.length < MIN_STATIONS_FOR_ANALYSIS) {
    return {
      stations: stationTemps,
      regression: null,
      overallLapseRate: null,
      hasInversion: false,
      status: 'insufficient-data',
      summary: `Datos insuficientes (${stationTemps.length} estaciones, mínimo ${MIN_STATIONS_FOR_ANALYSIS})`,
    };
  }

  const regression = computeLinearRegression(stationTemps);

  if (!regression) {
    return {
      stations: stationTemps,
      regression: null,
      overallLapseRate: null,
      hasInversion: false,
      status: 'insufficient-data',
      summary: 'Insuficiente rango de altitudes para calcular gradiente',
    };
  }

  const { slopePerKm, rSquared, stationCount } = regression;

  // Determine status — VERY conservative about flagging inversions.
  // ALL of these must be true to flag:
  //   1. Positive slope above MIN_INVERSION_SLOPE (not just barely positive)
  //   2. R² above threshold (altitude really explains the temperature pattern)
  //   3. Enough stations + altitude spread (already checked above)
  let status: ThermalStatus;
  let hasInversion = false;

  if (
    slopePerKm >= MIN_INVERSION_SLOPE &&
    rSquared >= MIN_R_SQUARED_FOR_ALERT
  ) {
    // Regression confidently shows temperature INCREASES with altitude
    hasInversion = true;
    status = slopePerKm >= 5 ? 'strong-inversion' : 'weak-inversion';
  } else {
    status = 'normal';
  }

  // Build summary
  let summary: string;
  const rateStr = `${slopePerKm > 0 ? '+' : ''}${slopePerKm.toFixed(1)}°C/km`;
  const r2Str = `R²=${rSquared.toFixed(2)}`;

  if (status === 'normal') {
    summary = `Gradiente normal: ${rateStr} (${stationCount} est., ${r2Str})`;
  } else if (status === 'weak-inversion') {
    summary = `Inversión débil: ${rateStr} (${stationCount} est., ${r2Str})`;
  } else {
    summary = `INVERSIÓN FUERTE: ${rateStr} (${stationCount} est., ${r2Str})`;
  }

  return {
    stations: stationTemps,
    regression,
    overallLapseRate: slopePerKm,
    hasInversion,
    status,
    summary,
  };
}
