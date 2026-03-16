/**
 * Forecast Verification Service — "¿Acertó la previsión?"
 *
 * Compares past Open-Meteo forecasts against actual observations from TimescaleDB.
 * Uses Open-Meteo Previous Runs API to retrieve what was predicted yesterday/earlier,
 * then matches against real hourly readings.
 *
 * Pure computation — no React, no stores. Receives data, returns results.
 *
 * Key metrics:
 *   - MAE (Mean Absolute Error): average |forecast − observed|
 *   - Bias: average (forecast − observed), positive = over-prediction
 *   - Accuracy rate: % of hours within threshold (wind ±3kt, temp ±2°C)
 */

import { openMeteoFetch } from '../api/openMeteoQueue';
import { fetchReadings, type HourlyReading } from '../api/historyClient';
import { msToKnots } from './windUtils';

// ── Types ────────────────────────────────────────────────────

export interface VerificationPoint {
  time: Date;
  /** Forecast values */
  fcstWindMs: number | null;
  fcstTemp: number | null;
  fcstHumidity: number | null;
  fcstWindDir: number | null;
  /** Observed values */
  obsWindMs: number | null;
  obsTemp: number | null;
  obsHumidity: number | null;
  /** Deltas (forecast − observed) */
  windDeltaKt: number | null;
  tempDelta: number | null;
  humidityDelta: number | null;
}

export interface VerificationStats {
  /** Number of matched hours */
  n: number;
  /** Wind MAE in knots */
  windMaeKt: number | null;
  /** Wind bias in knots (positive = forecast stronger than reality) */
  windBiasKt: number | null;
  /** Temp MAE in °C */
  tempMae: number | null;
  /** Temp bias in °C (positive = forecast warmer) */
  tempBias: number | null;
  /** Humidity MAE in % */
  humidityMae: number | null;
  /** % of hours where wind forecast was within ±3kt */
  windAccuracyPct: number | null;
  /** % of hours where temp forecast was within ±2°C */
  tempAccuracyPct: number | null;
}

export interface VerificationResult {
  points: VerificationPoint[];
  stats: VerificationStats;
  stationId: string;
  stationName: string;
  period: { from: Date; to: Date };
  modelRun: string; // e.g. "yesterday 00:00"
}

// ── Open-Meteo Previous Runs API ──────────────────────────

interface PreviousRunResponse {
  hourly: {
    time: string[];
    temperature_2m: (number | null)[];
    relative_humidity_2m: (number | null)[];
    wind_speed_10m: (number | null)[];
    wind_direction_10m: (number | null)[];
  };
}

/**
 * Fetch what Open-Meteo predicted for a past period.
 * Uses the Previous Runs API to get the forecast as it was issued.
 *
 * @param lat Latitude
 * @param lon Longitude
 * @param pastDays How many days back (1 = yesterday)
 * @param forecastDays How many forecast days were issued (1-2)
 */
async function fetchPreviousRunForecast(
  lat: number,
  lon: number,
  pastDays = 1,
  forecastDays = 2
): Promise<Map<string, { temp: number | null; humidity: number | null; windMs: number | null; windDir: number | null }>> {
  const params = [
    'temperature_2m', 'relative_humidity_2m',
    'wind_speed_10m', 'wind_direction_10m',
  ].join(',');

  // Use UTC timezone — DB stores UTC, so both sides must match
  const url = `https://previous-runs-api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&hourly=${params}` +
    `&past_days=${pastDays}` +
    `&forecast_days=${forecastDays}` +
    `&wind_speed_unit=ms` +
    `&timezone=GMT`;

  const res = await openMeteoFetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    console.warn(`[ForecastVerification] Previous runs API failed: ${res.status}`);
    return new Map();
  }

  const data: PreviousRunResponse = await res.json();
  const map = new Map<string, { temp: number | null; humidity: number | null; windMs: number | null; windDir: number | null }>();

  for (let i = 0; i < data.hourly.time.length; i++) {
    map.set(data.hourly.time[i], {
      temp: data.hourly.temperature_2m[i],
      humidity: data.hourly.relative_humidity_2m[i],
      windMs: data.hourly.wind_speed_10m[i],
      windDir: data.hourly.wind_direction_10m[i],
    });
  }

  return map;
}

// ── Observation Fetching ──────────────────────────────────

async function fetchHourlyObservations(
  stationId: string,
  from: Date,
  to: Date
): Promise<Map<string, { temp: number | null; humidity: number | null; windMs: number | null }>> {
  const fromStr = from.toISOString();
  const toStr = to.toISOString();

  const readings = await fetchReadings(stationId, fromStr, toStr, 'hourly') as HourlyReading[];

  const map = new Map<string, { temp: number | null; humidity: number | null; windMs: number | null }>();
  for (const r of readings) {
    // Bucket from TimescaleDB: may be "2026-03-13 10:00:00+00" (pg text cast) or ISO with Z
    // Ensure UTC interpretation: append Z if no timezone indicator present
    const raw = r.bucket;
    const utcStr = (raw.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(raw) || /[+-]\d{2}$/.test(raw))
      ? raw.replace(' ', 'T')
      : raw.replace(' ', 'T') + 'Z';
    const date = new Date(utcStr);
    const key = formatTimeKey(date);
    map.set(key, {
      temp: r.avg_temp,
      humidity: r.avg_humidity,
      windMs: r.avg_wind,
    });
  }
  return map;
}

/** Format date to UTC time key matching Open-Meteo GMT format: "2026-03-13T10:00" */
function formatTimeKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const h = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}`;
}

// ── Main Verification ────────────────────────────────────

/**
 * Run forecast verification for a single station.
 * Fetches previous model run from Open-Meteo and compares to actual readings.
 *
 * @param stationId Station ID (e.g. "aemet_1387")
 * @param stationName Human-readable name
 * @param lat Station latitude (for Open-Meteo grid point)
 * @param lon Station longitude
 * @param pastDays How many days ago (1 = yesterday)
 */
export async function verifyForecast(
  stationId: string,
  stationName: string,
  lat: number,
  lon: number,
  pastDays = 1
): Promise<VerificationResult> {
  const now = new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - pastDays);
  from.setUTCHours(0, 0, 0, 0);

  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 1);
  to.setUTCHours(23, 59, 59, 999);

  // Fetch forecast and observations in parallel
  const [forecastMap, obsMap] = await Promise.all([
    fetchPreviousRunForecast(lat, lon, pastDays, 2),
    fetchHourlyObservations(stationId, from, to),
  ]);

  // Debug: log key counts and sample keys to diagnose mismatches
  if (forecastMap.size > 0 || obsMap.size > 0) {
    const fcstKeys = [...forecastMap.keys()].slice(0, 3);
    const obsKeys = [...obsMap.keys()].slice(0, 3);
    console.debug(
      `[ForecastVerification] fcst=${forecastMap.size} keys (${fcstKeys.join(', ')}), ` +
      `obs=${obsMap.size} keys (${obsKeys.join(', ')})`
    );
  }

  // Match hours
  const points: VerificationPoint[] = [];
  for (const [timeKey, fcst] of forecastMap) {
    const obs = obsMap.get(timeKey);
    const time = new Date(timeKey);

    // Only include hours within our target day
    if (time < from || time > to) continue;

    const windDeltaKt = fcst.windMs !== null && obs?.windMs !== null && obs?.windMs !== undefined
      ? msToKnots(fcst.windMs) - msToKnots(obs.windMs)
      : null;

    const tempDelta = fcst.temp !== null && obs?.temp !== null && obs?.temp !== undefined
      ? fcst.temp - obs.temp
      : null;

    const humidityDelta = fcst.humidity !== null && obs?.humidity !== null && obs?.humidity !== undefined
      ? fcst.humidity - obs.humidity
      : null;

    points.push({
      time,
      fcstWindMs: fcst.windMs,
      fcstTemp: fcst.temp,
      fcstHumidity: fcst.humidity,
      fcstWindDir: fcst.windDir,
      obsWindMs: obs?.windMs ?? null,
      obsTemp: obs?.temp ?? null,
      obsHumidity: obs?.humidity ?? null,
      windDeltaKt,
      tempDelta,
      humidityDelta,
    });
  }

  // Sort by time
  points.sort((a, b) => a.time.getTime() - b.time.getTime());

  const stats = computeStats(points);

  return {
    points,
    stats,
    stationId,
    stationName,
    period: { from, to },
    modelRun: `hace ${pastDays} día${pastDays > 1 ? 's' : ''}`,
  };
}

// ── Stats Computation ────────────────────────────────────

function computeStats(points: VerificationPoint[]): VerificationStats {
  const windDeltas = points.map(p => p.windDeltaKt).filter((d): d is number => d !== null);
  const tempDeltas = points.map(p => p.tempDelta).filter((d): d is number => d !== null);
  const humDeltas = points.map(p => p.humidityDelta).filter((d): d is number => d !== null);

  const n = Math.max(windDeltas.length, tempDeltas.length);

  return {
    n,
    windMaeKt: windDeltas.length >= 3 ? mean(windDeltas.map(Math.abs)) : null,
    windBiasKt: windDeltas.length >= 3 ? mean(windDeltas) : null,
    tempMae: tempDeltas.length >= 3 ? mean(tempDeltas.map(Math.abs)) : null,
    tempBias: tempDeltas.length >= 3 ? mean(tempDeltas) : null,
    humidityMae: humDeltas.length >= 3 ? mean(humDeltas.map(Math.abs)) : null,
    windAccuracyPct: windDeltas.length >= 3
      ? (windDeltas.filter(d => Math.abs(d) <= 3).length / windDeltas.length) * 100
      : null,
    tempAccuracyPct: tempDeltas.length >= 3
      ? (tempDeltas.filter(d => Math.abs(d) <= 2).length / tempDeltas.length) * 100
      : null,
  };
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ── Formatting Helpers ───────────────────────────────────

export function formatBias(bias: number | null, unit: string): string {
  if (bias === null) return '—';
  const sign = bias > 0 ? '+' : '';
  return `${sign}${bias.toFixed(1)} ${unit}`;
}

export function formatMae(mae: number | null, unit: string): string {
  if (mae === null) return '—';
  return `±${mae.toFixed(1)} ${unit}`;
}

export function formatAccuracy(pct: number | null): string {
  if (pct === null) return '—';
  return `${pct.toFixed(0)}%`;
}

/** Color for accuracy percentage */
export function accuracyColor(pct: number | null): string {
  if (pct === null) return '#94a3b8'; // slate-400
  if (pct >= 80) return '#22c55e'; // green-500
  if (pct >= 60) return '#eab308'; // yellow-500
  if (pct >= 40) return '#f97316'; // orange-500
  return '#ef4444'; // red-500
}

/** Color for bias (how far off center) */
export function biasColor(bias: number | null, threshold: number): string {
  if (bias === null) return '#94a3b8';
  const abs = Math.abs(bias);
  if (abs <= threshold * 0.5) return '#22c55e';
  if (abs <= threshold) return '#eab308';
  return '#ef4444';
}
