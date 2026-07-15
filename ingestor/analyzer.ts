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
import { evaluateMagicWindow } from '../src/services/magicWindowDetector.js';
import { dispatchSpotAlert, dispatchForecastAlert, dispatchMagicWindowAlert } from './alertDispatcher.js';
import { degreesToCardinal } from '../src/services/windUtils.js';
import { RIAS_BUOY_STATIONS } from '../src/api/buoyClient.js';
import { getSpotsForSector } from '../src/config/spots.js';
import {
  scoreSpot,
  buoyWindToBuoyReading,
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
// Derived from the frontend config (single source of truth). A hardcoded copy
// lived here before and drifted: Limens was added to spots.ts but never made
// it to Telegram alerts. Surf spots are excluded — the analyzer scores wind,
// which is not the verdict that matters on a beach break.

/** The analyzer historically searched wider radii than the frontend scoring
 *  engine uses per spot. Preserved so verdict behavior does not change. */
const RADIUS_OVERRIDE: Record<string, number> = {
  castrelo: 15, cesantes: 12, lourido: 12, bocana: 12, 'centro-ria': 12,
  'cies-ria': 12, castineiras: 10, vao: 8, lanzada: 10, 'illa-arousa': 8,
};

const SPOTS: SpotDef[] = (['embalse', 'rias'] as const).flatMap((sector) =>
  getSpotsForSector(sector)
    .filter((s) => s.category !== 'surf')
    .map((s) => ({
      id: s.id,
      name: s.shortName,
      lat: s.center[1],
      lon: s.center[0],
      sector,
      radiusKm: RADIUS_OVERRIDE[s.id] ?? s.radiusKm,
      thermalDetection: s.thermalDetection,
    })),
);

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
    // Phase A (TIER 1 P0): extended fields for detector connection
    //   - dew_point, solar_rad, pressure feed Cesantes canalization mouth-humidity
    //     and bocana solar gating
    //   - All optional in StationReading interface — older code keeps working
    const result = await db.query<StationReading>(`
      SELECT DISTINCT ON (r.station_id)
        r.station_id,
        r.wind_speed, r.wind_gust, r.wind_dir,
        r.temperature, r.humidity,
        r.dew_point, r.solar_rad, r.pressure,
        COALESCE(s.latitude, 0.0) as latitude,
        COALESCE(s.longitude, 0.0) as longitude
      FROM readings r
      LEFT JOIN stations s ON s.station_id = r.station_id
      WHERE r.time > NOW() - INTERVAL '30 minutes'
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

/** Buoy name lookup for canalization detector (which reports source buoy in signals) */
const BUOY_NAMES: Record<number, string> = Object.fromEntries(
  RIAS_BUOY_STATIONS.map(b => [b.id, b.name])
);

/**
 * Get latest buoy readings (last 6h) with coordinates and extended fields.
 *
 * Window 6h (was 2h) tolerates PORTUS publish-lag for REDEXT/CETMAR/REMPOR
 * which publish every 30-60min. The 2h window dropped >half the buoys
 * silently during normal operation (S135+2 lesson). Detectors only need
 * "current state" — 6h-old buoy data is still meaningful for SW synoptic.
 *
 * Phase A (TIER 1 P0): includes water_temp, air_temp, humidity, wave_*
 * needed by bocana detector (Rande ΔT) + canalization (mouth buoys SW)
 * + surf verdict (wave_height/period).
 *
 * NB: removed `wind_speed > 0` filter — Rande (1251) has no anemometer
 * but still publishes water/air temp + humidity (key signal for bocana).
 */
async function getLatestBuoys(): Promise<BuoyWind[]> {
  const db = getPool();
  try {
    const result = await db.query<{
      station_id: number;
      wind_speed: number | null;
      wind_dir: number | null;
      water_temp: number | null;
      air_temp: number | null;
      humidity: number | null;
      wave_height: number | null;
      wave_period: number | null;
      wave_dir: number | null;
    }>(`
      SELECT DISTINCT ON (station_id)
        station_id,
        wind_speed, wind_dir,
        water_temp, air_temp, humidity,
        wave_height, wave_period, wave_dir
      FROM buoy_readings
      WHERE time > NOW() - INTERVAL '6 hours'
      ORDER BY station_id, time DESC
    `);
    return result.rows.map(r => ({
      station_id: r.station_id,
      wind_speed: r.wind_speed ?? 0,
      wind_dir: r.wind_dir,
      lat: BUOY_COORDS[r.station_id]?.lat ?? 0,
      lon: BUOY_COORDS[r.station_id]?.lon ?? 0,
      station_name: BUOY_NAMES[r.station_id] ?? `Boya ${r.station_id}`,
      water_temp: r.water_temp,
      air_temp: r.air_temp,
      humidity: r.humidity,
      wave_height: r.wave_height,
      wave_period: r.wave_period,
      wave_dir: r.wave_dir,
    }));
  } catch (err) {
    log.warn(`getLatestBuoys failed: ${(err as Error).message}`);
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
      `INSERT INTO spot_scores
         (time, spot_id, sector, verdict, wind_kt, gust_kt, wind_dir, score,
          station_count, inferred_dir, raw_wind_kt, boosted_by, boost_confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (time, spot_id) DO NOTHING`,
      [
        now, r.spot.id, r.spot.sector, r.verdict, r.avgWindKt, r.maxGustKt, r.avgDir, 0,
        r.stationCount, r.inferredDir || null,
        r.rawWindKt ?? null, r.boostedBy ?? null, r.boostConfidence ?? null,
      ]
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
  const buoys = await getLatestBuoys();

  if (readings.length === 0 && buoys.length === 0) {
    return; // No data, skip
  }

  // 2. Score each spot, detect transitions, and persist to DB
  const scoreRows: SpotResult[] = [];
  const boostedSpots: string[] = [];
  for (const spot of SPOTS) {
    const result = scoreSpot(spot, readings, buoys);
    scoreRows.push(result);

    // Log boosts at cycle end (avoid noisy logs on single transitions).
    // The detector summary is more useful than per-spot WARN entries.
    if (result.boostedBy && result.rawWindKt !== undefined) {
      boostedSpots.push(
        `${spot.id}=${result.rawWindKt}→${result.avgWindKt}kt (${result.boostedBy} ${result.boostConfidence}%)`
      );
    }

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

  // Detector summary log (cycle-level — once per 5min poll instead of per-spot)
  if (boostedSpots.length > 0) {
    log.info(`Detector boosts active: ${boostedSpots.join(', ')}`);
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

  // 4. Magic Window detection (T2-2 S136+3+3, Rías-only sector-wide alert)
  // Evaluated every cycle but with a 6h cooldown so the alert won't spam
  // during a sustained window where the score oscillates around threshold.
  try {
    await evaluateAndDispatchMagicWindow(readings, buoys);
  } catch (err) {
    log.warn(`Magic window evaluation failed: ${(err as Error).message}`);
  }
}

// ── Magic Window helpers (T2-2 S136+3+3) ───────────────

/**
 * Compute mouth-of-ría humidity from station readings — mirror of
 * `computeMouthHumidityFromRows` in analyzerLogic.ts. Mouth bbox: lon < -8.78,
 * lat 42.15-42.30. Uses 75th percentile to be robust to interior dry leaks.
 */
function mouthHumidityFromRows(readings: StationReading[]): number | null {
  const vals: number[] = [];
  for (const r of readings) {
    if (r.longitude > -8.78 || r.latitude < 42.15 || r.latitude > 42.30) continue;
    if (r.humidity == null) continue;
    vals.push(r.humidity);
  }
  if (vals.length === 0) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75));
  return sorted[idx];
}

/**
 * Count lightning strikes near Rías sector center in the last 15 minutes.
 * Used as a veto signal for the magic window (electrical activity
 * contradicts "magic"). Conservative 30km radius.
 */
async function countRecentNearbyStrikes(): Promise<number> {
  const db = getPool();
  try {
    // Rías sector center ~ (42.23, -8.80). 30km ≈ 0.27° latitude.
    const result = await db.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM lightning_strikes
      WHERE time > NOW() - INTERVAL '15 minutes'
        AND lat BETWEEN 41.96 AND 42.50
        AND lon BETWEEN -9.07 AND -8.53
    `);
    return parseInt(result.rows[0]?.count ?? '0', 10) || 0;
  } catch {
    // Silent fallback — magic window will fall back to 0 strikes which
    // is just slightly less conservative.
    return 0;
  }
}

/**
 * Persist a magic window detection (idempotent via ON CONFLICT — one row per
 * minute even if the cycle runs faster than that).
 */
async function persistMagicWindow(score: number, summary: string, estimatedHours: number): Promise<void> {
  const db = getPool();
  try {
    await db.query(
      `INSERT INTO magic_windows (time, sector, score, summary, estimated_hours)
       VALUES (date_trunc('minute', NOW()), 'rias', $1, $2, $3)
       ON CONFLICT (time, sector) DO NOTHING`,
      [score, summary, estimatedHours],
    );
  } catch (err) {
    // Table may not exist on older schemas — log but don't crash the cycle.
    log.warn(`Magic window persist failed (table missing?): ${(err as Error).message}`);
  }
}

/**
 * Run the magic window evaluation against current data and dispatch alert
 * + persist if active. Sector-scoped to Rías; Embalse returns null fast.
 */
async function evaluateAndDispatchMagicWindow(
  readings: StationReading[],
  buoys: BuoyWind[],
): Promise<void> {
  const buoyReadings = buoys.map(buoyWindToBuoyReading);
  const mouthHum = mouthHumidityFromRows(readings);

  // Find airTemp near Rías sector center (~42.23, -8.80) — closest land station
  const sectorLat = 42.23, sectorLon = -8.80;
  const closestTempStation = readings
    .filter(r => r.temperature != null && r.latitude !== 0 && r.longitude !== 0)
    .map(r => ({
      r,
      d: Math.sqrt(Math.pow(r.latitude - sectorLat, 2) + Math.pow(r.longitude - sectorLon, 2)),
    }))
    .sort((a, b) => a.d - b.d)[0]?.r;
  const airTemp = closestTempStation?.temperature ?? null;

  const recentStrikes = await countRecentNearbyStrikes();

  const result = evaluateMagicWindow({
    sector: 'rias',
    buoys: buoyReadings,
    mouthHumidity: mouthHum,
    airTempLocal: airTemp,
    recentStrikesNearby: recentStrikes,
  });

  if (!result) return; // Sector not applicable

  if (result.active) {
    log.info(`Magic Window ACTIVE — score=${result.score}/100, ~${result.estimatedHours}h`);
    await persistMagicWindow(result.score, result.summary, result.estimatedHours);
    await dispatchMagicWindowAlert('Rias Baixas', result.score, result.summary, result.estimatedHours);
  } else if (result.score >= 60) {
    // Heartbeat (loud): close to threshold, log it so we can verify the
    // detector nearly fires.
    log.info(`Magic Window near-miss — score=${result.score}/100. ${result.summary}`);
  } else {
    // Heartbeat compact (log.info): every cycle a single ~60-char line so
    // `tail` always shows the detector ran. Pattern from CLAUDE.md (S136+3+2):
    // silent-by-design detectors must heartbeat so 'no log' doesn't read as
    // 'code broken'. Prefer log.info over log.debug because INGESTOR_DEBUG
    // is off in prod and the heartbeat would be invisible there.
    const sw = result.signals.hasSynopticSW ? `SW${result.signals.synopticWindMs?.toFixed(0)}` : 'no-SW';
    const dt = result.signals.deltaT !== null ? `dT${result.signals.deltaT.toFixed(1)}` : 'no-dT';
    const hr = result.signals.mouthHumidity !== null ? `HR${result.signals.mouthHumidity.toFixed(0)}` : 'no-HR';
    log.info(`Magic Window quiet — score=${result.score}/100 (${sw}, ${dt}, ${hr}, h=${result.signals.hour})`);
  }
}
