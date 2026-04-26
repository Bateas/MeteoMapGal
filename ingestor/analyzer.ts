/**
 * Ingestor Analyzer — evaluates conditions and dispatches alerts.
 *
 * Runs every 5 minutes from the main poll loop.
 * Reads latest data from TimescaleDB, scores spots, detects transitions,
 * and sends alerts via n8n webhook to Telegram.
 *
 * 24/7 operation — independent of frontend browser.
 */

import { getPool } from './db.js';
import { log } from './logger.js';
import { getAllForecasts } from './forecastFetcher.js';
import { detectThermalForecast } from '../src/services/thermalForecastDetector.js';
import { dispatchSpotAlert, dispatchForecastAlert } from './alertDispatcher.js';
import { haversineDistance } from '../src/services/geoUtils.js';
import { degreesToCardinal } from '../src/services/windUtils.js';
import { RIAS_BUOY_STATIONS } from '../src/api/buoyClient.js';
import {
  windVerdict,
  scoreSpot,
  VERDICT_LABEL,
  ALERT_VERDICTS,
  LOW_VERDICTS,
  type SpotDef,
  type Verdict,
  type StationReading,
  type BuoyWind,
  type SpotResult,
} from './analyzerLogic.js';

// ── Spot definitions ────────────────────────────────

const SPOTS: SpotDef[] = [
  { id: 'castrelo', name: 'Castrelo', lat: 42.2991, lon: -8.1087, sector: 'embalse', radiusKm: 15, thermalDetection: true },
  { id: 'cesantes', name: 'Cesantes', lat: 42.307, lon: -8.619, sector: 'rias', radiusKm: 12, thermalDetection: true },
  { id: 'lourido', name: 'Lourido', lat: 42.365, lon: -8.675, sector: 'rias', radiusKm: 12, thermalDetection: true },
  { id: 'bocana', name: 'Bocana', lat: 42.268, lon: -8.714, sector: 'rias', radiusKm: 12, thermalDetection: false },
  { id: 'centro-ria', name: 'Ria de Vigo (centro)', lat: 42.228, lon: -8.803, sector: 'rias', radiusKm: 12, thermalDetection: true },
  { id: 'cies-ria', name: 'Cies-Ria', lat: 42.22, lon: -8.87, sector: 'rias', radiusKm: 12, thermalDetection: false },
  { id: 'castineiras', name: 'Castiñeiras', lat: 42.528, lon: -9.001, sector: 'rias', radiusKm: 10, thermalDetection: false },
  { id: 'vao', name: 'Vao', lat: 42.199, lon: -8.793, sector: 'rias', radiusKm: 8, thermalDetection: false },
  { id: 'lanzada', name: 'A Lanzada', lat: 42.449, lon: -8.880, sector: 'rias', radiusKm: 10, thermalDetection: false },
  { id: 'illa-arousa', name: 'Illa Arousa', lat: 42.546, lon: -8.860, sector: 'rias', radiusKm: 8, thermalDetection: true },
];

// ── Verdict thresholds + scoring imported from analyzerLogic ──────────
// (windVerdict, scoreSpot, inferCastreloDirection — pure functions, tested separately)

// ── State ───────────────────────────────────────────

const previousVerdicts = new Map<string, Verdict>();
let lastForecastRun = 0;
const FORECAST_INTERVAL_MS = 30 * 60_000; // 30 minutes

// ── Shared helpers (imported from src/) ─────────────
// distanceKm → haversineDistance (geoUtils)
// degreesToCardinal, msToKnots → windUtils
// BUOY_COORDS → RIAS_BUOY_STATIONS (buoyClient)

// ── DB queries ──────────────────────────────────────

/**
 * Get latest reading per station (last 30 min) with coordinates.
 * Joins readings with stations table for lat/lon.
 */
async function getLatestReadings(): Promise<StationReading[]> {
  const db = getPool();
  try {
    const result = await db.query<StationReading>(`
      SELECT DISTINCT ON (r.station_id)
        r.station_id,
        r.wind_speed, r.wind_gust, r.wind_dir,
        r.temperature, r.humidity,
        COALESCE(s.latitude, 0.0) as latitude,
        COALESCE(s.longitude, 0.0) as longitude
      FROM readings r
      LEFT JOIN stations s ON s.station_id = r.station_id
      WHERE r.time > NOW() - INTERVAL '30 minutes'
        AND r.wind_speed IS NOT NULL
      ORDER BY r.station_id, r.time DESC
    `);
    return result.rows;
  } catch (err) {
    log.warn(`getLatestReadings failed: ${(err as Error).message}`);
    return [];
  }
}

/** Buoy coords from shared frontend config */
const BUOY_COORDS: Record<number, { lat: number; lon: number }> = Object.fromEntries(
  RIAS_BUOY_STATIONS.map(b => [b.id, { lat: b.lat, lon: b.lon }])
);

/**
 * Get latest buoy readings (last 2h) with coordinates.
 */
async function getLatestBuoyWinds(): Promise<BuoyWind[]> {
  const db = getPool();
  try {
    const result = await db.query<{ station_id: number; wind_speed: number; wind_dir: number | null }>(`
      SELECT DISTINCT ON (station_id)
        station_id, wind_speed, wind_dir
      FROM buoy_readings
      WHERE time > NOW() - INTERVAL '2 hours'
        AND wind_speed IS NOT NULL AND wind_speed > 0
      ORDER BY station_id, time DESC
    `);
    return result.rows.map(r => ({
      ...r,
      lat: BUOY_COORDS[r.station_id]?.lat ?? 0,
      lon: BUOY_COORDS[r.station_id]?.lon ?? 0,
    }));
  } catch (err) {
    return [];
  }
}

// ── Main analyzer ───────────────────────────────────

/**
 * Persist spot scores to DB for verification and accuracy tracking.
 */
async function persistSpotScores(results: SpotResult[]): Promise<void> {
  const db = getPool();
  const now = new Date();
  for (const r of results) {
    if (r.verdict === 'unknown') continue;
    await db.query(
      `INSERT INTO spot_scores (time, spot_id, sector, verdict, wind_kt, gust_kt, wind_dir, score, station_count, inferred_dir)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (time, spot_id) DO NOTHING`,
      [now, r.spot.id, r.spot.sector, r.verdict, r.avgWindKt, r.maxGustKt, r.avgDir, 0, r.stationCount, r.inferredDir || null]
    );
  }
}

/**
 * Run analysis cycle. Called from main poll loop every 5 minutes.
 */
export async function runAnalysis(): Promise<void> {
  const now = Date.now();

  // 1. Get latest readings from DB
  const readings = await getLatestReadings();
  const buoyWinds = await getLatestBuoyWinds();

  if (readings.length === 0 && buoyWinds.length === 0) {
    return; // No data, skip
  }

  // 2. Score each spot, detect transitions, and persist to DB
  const scoreRows: SpotResult[] = [];
  for (const spot of SPOTS) {
    const result = scoreSpot(spot, readings, buoyWinds);
    scoreRows.push(result);
    const prev = previousVerdicts.get(spot.id) ?? 'unknown';

    // Detect transition: low → good (skip marginal sailing <10kt — too noisy)
    const worthAlerting = result.verdict === 'good' || result.verdict === 'strong'
      || (result.verdict === 'sailing' && result.avgWindKt >= 10);
    if (LOW_VERDICTS.has(prev) && ALERT_VERDICTS.has(result.verdict) && worthAlerting) {
      const dir = result.avgDir != null ? degreesToCardinal(result.avgDir) : '';
      await dispatchSpotAlert(
        spot.id, spot.name, spot.sector === 'embalse' ? 'Embalse' : 'Rías Baixas',
        VERDICT_LABEL[result.verdict], result.avgWindKt, dir,
        { gustKt: result.maxGustKt > 0 ? result.maxGustKt : undefined },
      );
    }

    previousVerdicts.set(spot.id, result.verdict);
  }

  // 3. Persist spot scores to DB (for verification dashboard)
  await persistSpotScores(scoreRows).catch(err =>
    log.warn(`Score persist failed: ${(err as Error).message}`));

  // 3. Thermal forecast (every 30 min)
  if ((now - lastForecastRun) >= FORECAST_INTERVAL_MS) {
    lastForecastRun = now;

    try {
      const forecasts = await getAllForecasts();

      for (const [sector, hourly] of forecasts) {
        if (hourly.length === 0) continue;

        // Only analyze for spots with thermalDetection in this sector
        const hasThermalSpots = SPOTS.some(s => s.sector === sector && s.thermalDetection);
        if (!hasThermalSpots) continue;

        const signals = detectThermalForecast(hourly as any);
        for (const signal of signals) {
          await dispatchForecastAlert(
            sector === 'embalse' ? 'Embalse' : 'Rías Baixas',
            signal.label,
            signal.confidence,
          );
        }
      }
    } catch (err) {
      log.warn(`Forecast analysis failed: ${(err as Error).message}`);
    }
  }
}
