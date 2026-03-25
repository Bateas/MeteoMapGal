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
import { msToKnots, degreesToCardinal } from '../src/services/windUtils.js';
import { RIAS_BUOY_STATIONS } from '../src/api/buoyClient.js';

// ── Spot definitions ────────────────────────────────

interface SpotDef {
  id: string;
  name: string;
  lat: number;
  lon: number;
  sector: 'embalse' | 'rias';
  radiusKm: number;
  thermalDetection: boolean;
}

const SPOTS: SpotDef[] = [
  { id: 'castrelo', name: 'Castrelo', lat: 42.2991, lon: -8.1087, sector: 'embalse', radiusKm: 15, thermalDetection: true },
  { id: 'cesantes', name: 'Cesantes', lat: 42.307, lon: -8.619, sector: 'rias', radiusKm: 12, thermalDetection: true },
  { id: 'lourido', name: 'Lourido', lat: 42.365, lon: -8.675, sector: 'rias', radiusKm: 12, thermalDetection: true },
  { id: 'bocana', name: 'Bocana', lat: 42.268, lon: -8.714, sector: 'rias', radiusKm: 12, thermalDetection: false },
  { id: 'centro-ria', name: 'Ria de Vigo (centro)', lat: 42.228, lon: -8.803, sector: 'rias', radiusKm: 12, thermalDetection: true },
  { id: 'cies-ria', name: 'Cies-Ria', lat: 42.22, lon: -8.87, sector: 'rias', radiusKm: 12, thermalDetection: false },
];

// ── Verdict thresholds (matching frontend) ──────────

type Verdict = 'calm' | 'light' | 'sailing' | 'good' | 'strong' | 'unknown';

const VERDICT_LABEL: Record<Verdict, string> = {
  calm: 'CALMA', light: 'FLOJO', sailing: 'NAVEGABLE',
  good: 'BUENO', strong: 'FUERTE', unknown: 'SIN DATOS',
};

const ALERT_VERDICTS: Set<Verdict> = new Set(['sailing', 'good', 'strong']);
const LOW_VERDICTS: Set<Verdict> = new Set(['calm', 'light', 'unknown']);

/** Match frontend spotScoringEngine thresholds exactly */
function windVerdict(avgKt: number, spotId: string): Verdict {
  const kt = Math.round(avgKt);
  // Cies-Ria: ocean conditions — higher thresholds
  if (spotId === 'cies-ria') {
    if (kt < 5) return 'calm';
    if (kt < 10) return 'light';
    if (kt < 14) return 'sailing';
    if (kt < 18) return 'good';
    return 'strong';
  }
  // All other spots: ria/embalse thresholds
  if (kt < 6) return 'calm';
  if (kt < 8) return 'light';
  if (kt < 12) return 'sailing';
  if (kt < 18) return 'good';
  return 'strong';
}

// ── State ───────────────────────────────────────────

const previousVerdicts = new Map<string, Verdict>();
let lastForecastRun = 0;
const FORECAST_INTERVAL_MS = 30 * 60_000; // 30 minutes

// ── Shared helpers (imported from src/) ─────────────
// distanceKm → haversineDistance (geoUtils)
// degreesToCardinal, msToKnots → windUtils
// BUOY_COORDS → RIAS_BUOY_STATIONS (buoyClient)

// ── DB queries ──────────────────────────────────────

interface StationReading {
  station_id: string;
  latitude: number;
  longitude: number;
  wind_speed: number | null;
  wind_gust: number | null;
  wind_dir: number | null;
  temperature: number | null;
  humidity: number | null;
}

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

interface BuoyWind {
  station_id: number;
  wind_speed: number;
  wind_dir: number | null;
  lat: number;
  lon: number;
}

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

// ── Scoring ─────────────────────────────────────────

interface SpotResult {
  spot: SpotDef;
  avgWindKt: number;
  maxGustKt: number;
  avgDir: number | null;
  verdict: Verdict;
  stationCount: number;
  /** Inferred direction for spots without vane (e.g. Castrelo SkyX) */
  inferredDir?: string | null;
}

/**
 * Score a spot based on nearby station wind consensus.
 * Filters stations by distance to spot (radiusKm).
 * Matches frontend spotScoringEngine logic.
 */
function scoreSpot(spot: SpotDef, readings: StationReading[], buoyWinds: BuoyWind[]): SpotResult {
  // Filter to stations within spot radius
  const nearby = readings.filter(r =>
    r.latitude !== 0 && r.longitude !== 0 &&
    haversineDistance(spot.lat, spot.lon, r.latitude, r.longitude) <= spot.radiusKm
  );

  let windSum = 0, gustMax = 0, dirCount = 0, count = 0;
  // Circular mean for wind direction (avoids 350+10 = 180 bug)
  let sinSum = 0, cosSum = 0;

  for (const r of nearby) {
    if (r.wind_speed != null) {
      const kt = msToKnots(r.wind_speed);
      windSum += kt;
      count++;
      if (r.wind_gust != null) {
        const gKt = msToKnots(r.wind_gust);
        if (gKt > gustMax) gustMax = gKt;
      }
      if (r.wind_dir != null) {
        const rad = r.wind_dir * Math.PI / 180;
        sinSum += Math.sin(rad);
        cosSum += Math.cos(rad);
        dirCount++;
      }
    }
  }

  // Include buoy winds — filtered by distance
  const nearbyBuoys = buoyWinds.filter(b =>
    b.lat !== 0 && b.lon !== 0 &&
    haversineDistance(spot.lat, spot.lon, b.lat, b.lon) <= spot.radiusKm
  );
  for (const b of nearbyBuoys) {
    const kt = msToKnots(b.wind_speed);
    windSum += kt;
    count++;
    if (b.wind_dir != null) {
      const rad = b.wind_dir * Math.PI / 180;
      sinSum += Math.sin(rad);
      cosSum += Math.cos(rad);
      dirCount++;
    }
  }

  if (count === 0) {
    return { spot, avgWindKt: 0, maxGustKt: 0, avgDir: null, verdict: 'unknown', stationCount: 0 };
  }

  const avgWindKt = Math.round(windSum / count);
  const avgDir = dirCount > 0
    ? (Math.round(Math.atan2(sinSum / dirCount, cosSum / dirCount) * 180 / Math.PI) + 360) % 360
    : null;
  const verdict = windVerdict(avgWindKt, spot.id);

  // For spots without direction data (e.g. Castrelo SkyX has no vane),
  // infer direction from temporal context + nearby station consensus
  let inferredDir: string | null = null;
  if (avgDir === null && avgWindKt >= 3 && spot.id === 'castrelo') {
    inferredDir = inferCastreloDirection(readings);
  }

  return { spot, avgWindKt, maxGustKt: Math.round(gustMax), avgDir, verdict, stationCount: count, inferredDir };
}

/**
 * Infer wind direction for Castrelo when SkyX has no vane.
 * Uses nearby stations with direction (AEMET Ribadavia, MG stations)
 * + time-of-day heuristic (14-18h sunny = likely SW thermal).
 */
function inferCastreloDirection(readings: StationReading[]): string | null {
  // Find stations within 15km of Castrelo that have wind direction
  const castreloLat = 42.2991, castreloLon = -8.1087;
  const nearby = readings.filter(r =>
    r.wind_dir != null && r.wind_speed != null && r.wind_speed > 1.0 &&
    r.latitude !== 0 && r.longitude !== 0 &&
    distanceKm(castreloLat, castreloLon, r.latitude, r.longitude) <= 15
  );

  if (nearby.length === 0) return null;

  // Circular mean of nearby directions
  let sinSum = 0, cosSum = 0;
  for (const r of nearby) {
    const rad = r.wind_dir! * Math.PI / 180;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }
  const avgDeg = (Math.round(Math.atan2(sinSum / nearby.length, cosSum / nearby.length) * 180 / Math.PI) + 360) % 360;
  const cardinal = degreesToCardinal(avgDeg);

  // Time-of-day heuristic: afternoon + SW-ish = thermal
  const hour = new Date().getHours();
  const isSWish = avgDeg >= 200 && avgDeg <= 280;
  const isAfternoon = hour >= 13 && hour <= 19;

  if (isSWish && isAfternoon) {
    return `${cardinal} (termico probable)`;
  }

  return cardinal;
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

    // Detect transition: low → good
    if (LOW_VERDICTS.has(prev) && ALERT_VERDICTS.has(result.verdict)) {
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
