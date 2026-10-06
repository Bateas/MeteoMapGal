/**
 * Ingestor Analyzer — evaluates conditions and dispatches alerts.
 *
 * Runs every 5 minutes from the main poll loop.
 * Reads latest data from TimescaleDB, scores spots, detects transitions,
 * and sends alerts via n8n webhook to Telegram.
 *
 * 24/7 operation — independent of frontend browser.
 */

import { getPool, hasColumn, stationAltitudeSql } from './db.js';
import { log } from './logger.js';
import { getAllForecasts } from './forecastFetcher.js';
import { detectThermalForecast } from '../src/services/thermalForecastDetector.js';
import { evaluateMagicWindow } from '../src/services/magicWindowDetector.js';
import { assessSynopticRegime, type UpperWind } from '../src/services/synopticRegime.js';
import { dispatchSpotAlert, dispatchForecastAlert, dispatchLightningAlert, dispatchWindSafetyAlert, type PastSend } from './alertDispatcher.js';
import {
  assessStrongWind, windAlertDue, formatWindSafetyMessage, episodesFromSends, reopenFromHistory, windLogState, windLogDue, safetySpots,
  WIND_EPISODE_GAP_MS, WIND_REOPEN_MAX_MS, WIND_MAX_AGE_MIN, WIND_MAX_ALTITUDE_M, type WindEpisode,
} from './windSafetyLogic.js';
import { dispatchLightningPush, logPushStartup } from './pushDispatcher.js';
import {
  assessSpotLightningRisk,
  formatRiskLine,
  stormNearPoint,
  LIGHTNING_WINDOW_MIN,
  type ProximityStrike,
  type SpotLightningRisk,
} from '../src/services/lightningProximityService.js';
import { degreesToCardinal } from '../src/services/windUtils.js';
import { RIAS_BUOY_STATIONS } from '../src/api/buoyClient.js';
import { getSpotsForSector } from '../src/config/spots.js';
import type { SpotScore } from '../src/services/spotScoringEngine.js';
import { scoreWithEngine, findDivergences, describeDivergences, engineView, alertResult } from './engineShadow.js';
import type { PrecipSample } from '../src/services/precipSemantics.js';
import {
  scoreSpot,
  selectNearbyStations,
  buoyWindToBuoyReading,
  VERDICT_LABEL,
  ALERT_VERDICTS,
  opportunityAlertAllowed,
  stepOpportunityRise,
  canAlertOnResult,
  isWorthAlerting,
  type SpotDef,
  type RiseState,
  type StationReading,
  type BuoyWind,
  type SpotResult,
  type ScoreContext,
  type UpperWindBySector,
} from './analyzerLogic.js';

// ── Spot definitions ────────────────────────────────
// Derived from the frontend config (single source of truth). A hardcoded copy
// lived here before and drifted: Limens was added to spots.ts but never made
// it to Telegram alerts. Surf spots are excluded — the analyzer scores wind,
// which is not the verdict that matters on a beach break.

/** The analyzer historically searched wider radii than the frontend scoring
 *  engine uses per spot. Preserved so verdict behavior does not change.
 *  Cíes-ría left the list on purpose: its radius was re-curated in spots.ts and both
 *  engines must search the same circle. */
const RADIUS_OVERRIDE: Record<string, number> = {
  castrelo: 15, cesantes: 12, lourido: 12, bocana: 12, 'centro-ria': 12,
  castineiras: 10, vao: 8, lanzada: 10, 'illa-arousa': 8,
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
      // Per-spot curation — previously dropped here, so a curated spot
      // (Limens excludes Cangas MG, calibration -2kt) could get a different
      // verdict on Telegram than on the map. The frontend engine is the
      // authoritative scorer; these fields make the analyzer converge to it.
      preferredStations: s.preferredStations,
      excludeStations: s.excludeStations,
      windCalibrationKt: s.windCalibrationKt,
      preferredBuoys: s.preferredBuoys,
    })),
);

/** Lightning and wind safety cover EVERY spot, surf included (safetySpots). The wind-verdict
 *  SPOTS list above excludes surf on purpose; this one must not. */
const SAFETY_SPOTS = safetySpots();

// ── Verdict thresholds + scoring imported from analyzerLogic ──────────
// (windVerdict, scoreSpot, inferCastreloDirection — pure functions, tested separately)

// ── State ───────────────────────────────────────────

/** Per spot: armed by a calm/light verdict, counting the cycles a rise has held (stepOpportunityRise). */
const riseStates = new Map<string, RiseState>();
let lastForecastRun = 0;
const FORECAST_INTERVAL_MS = 30 * 60_000; // 30 minutes
/** Whether spot_scores has the engine shadow columns, as last seen by persistSpotScores.
 *  null = not checked yet. Only a change is logged: a missing column warns once, not every cycle. */
let engineColsState: boolean | null = null;
/** Cesantes rain veto as of the last cycle. Logged only when it changes. */
let cesantesRainVetoed = false;

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
    //   - dew_point, solar_rad, pressure feed the Cesantes interior-sun gate,
    //     the magic window's mouth humidity and bocana solar gating
    //   - All optional in StationReading interface — older code keeps working
    const altitude = await stationAltitudeSql();
    const result = await db.query<StationReading>(`
      SELECT DISTINCT ON (r.station_id)
        r.station_id,
        r.time,
        r.wind_speed, r.wind_gust, r.wind_dir,
        r.temperature, r.humidity,
        r.dew_point, r.solar_rad, r.pressure,
        COALESCE(s.latitude, 0.0) as latitude,
        COALESCE(s.longitude, 0.0) as longitude,
        s.name, s.source, ${altitude} AS altitude
      FROM readings r
      LEFT JOIN stations s ON s.station_id = r.station_id
      -- Four hours, not thirty minutes. AEMET publishes hourly and can run two
      -- hours behind, so a 30min window never returned a single AEMET row and
      -- the per-source gate downstream never got to see one. The gate, not this
      -- query, is what decides whether a reading is too old to count — see
      -- staleGateMinFor. This window only has to be wider than the slowest gate.
      WHERE r.time > NOW() - INTERVAL '4 hours'
      ORDER BY r.station_id, r.time DESC
    `);
    return result.rows;
  } catch (err) {
    log.warn(`getLatestReadings failed: ${(err as Error).message}`);
    return [];
  }
}

/**
 * 850 hPa wind at the model hour nearest to now (within 3 h), per sector, from the
 * upper-air table. A front aloft vetoes the thermal boosts (synopticRegime.ts).
 * Missing on error or without data: no veto, never a crash of the cycle.
 */
async function getUpperWindNow(): Promise<UpperWindBySector> {
  const out: UpperWindBySector = {};
  try {
    const result = await getPool().query<{ sector: string; wind_speed_ms: number; wind_dir_deg: number }>(
      `SELECT DISTINCT ON (sector) sector, wind_speed_ms, wind_dir_deg
         FROM upper_air_hourly
        WHERE pressure_hpa = 850
          AND time BETWEEN NOW() - INTERVAL '3 hours' AND NOW() + INTERVAL '3 hours'
          AND wind_speed_ms IS NOT NULL AND wind_dir_deg IS NOT NULL
        ORDER BY sector, abs(extract(epoch FROM time - NOW()))`,
    );
    for (const r of result.rows) {
      if (r.sector !== 'rias' && r.sector !== 'embalse') continue;
      const w: UpperWind = { speedKt: Number(r.wind_speed_ms) * 1.94384, dirDeg: Number(r.wind_dir_deg) };
      if (Number.isFinite(w.speedKt) && Number.isFinite(w.dirDeg)) out[r.sector] = w;
    }
  } catch (err) {
    log.warn(`getUpperWindNow failed: ${(err as Error).message}`);
  }
  return out;
}

/** Last regime line logged, so the log says when it changes, not every cycle. */
let lastRegimeLine = '';
/** Alerts from the map's engine (default) or from the port in scoreSpot (ANALYZER_WIND=pipeline). */
const ALERTS_FROM_ENGINE = process.env.ANALYZER_WIND !== 'pipeline';
let lastAlertModeLine = '';

/**
 * Precipitation samples per station over the last `windowMin` minutes, for the Cesantes
 * rain veto. 150 = the veto's 120-min window plus the 30 min a day-total counter
 * (wu_, mc_) may reach back for the reading it measures growth from.
 * Empty on error: no rain data means no veto, never a crash of the cycle.
 */
async function getRecentPrecip(ids: string[], windowMin = 150): Promise<Map<string, PrecipSample[]>> {
  const out = new Map<string, PrecipSample[]>();
  if (ids.length === 0) return out;
  const db = getPool();
  try {
    const result = await db.query<{ station_id: string; time: Date; precip: number }>(
      `SELECT station_id, time, precip FROM readings
        WHERE time > NOW() - make_interval(mins => $1::int)
          AND precip IS NOT NULL
          AND station_id = ANY($2::text[])
        ORDER BY station_id, time`,
      [windowMin, ids],
    );
    for (const row of result.rows) {
      const mm = Number(row.precip);
      const t = new Date(row.time).getTime();
      if (!Number.isFinite(mm) || !Number.isFinite(t)) continue;
      const list = out.get(row.station_id) ?? [];
      list.push({ t, mm });
      out.set(row.station_id, list);
    }
  } catch (err) {
    log.warn(`getRecentPrecip failed: ${(err as Error).message}`);
    return new Map();
  }
  return out;
}

/** Buoy coords from shared frontend config */
const BUOY_COORDS: Record<number, { lat: number; lon: number }> = Object.fromEntries(
  RIAS_BUOY_STATIONS.map(b => [b.id, { lat: b.lat, lon: b.lon }])
);

/** Buoy name lookup (station_name on each buoy row) */
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
 * needed by bocana detector (Rande ΔT) + canalization (water temp near Cesantes)
 * + magic window (mouth buoys SW) + surf verdict (wave_height/period).
 *
 * NB: removed `wind_speed > 0` filter — Rande (1251) has no anemometer
 * but still publishes water/air temp + humidity (key signal for bocana).
 */
async function getLatestBuoys(): Promise<BuoyWind[]> {
  const db = getPool();
  try {
    const result = await db.query<{
      station_id: number;
      time: Date;
      wind_speed: number | null;
      wind_dir: number | null;
      wind_gust: number | null;
      water_temp: number | null;
      air_temp: number | null;
      humidity: number | null;
      wave_height: number | null;
      wave_period: number | null;
      wave_dir: number | null;
    }>(`
      SELECT DISTINCT ON (station_id)
        station_id,
        time,
        wind_speed, wind_dir, wind_gust,
        water_temp, air_temp, humidity,
        wave_height, wave_period, wave_dir
      FROM buoy_readings
      WHERE time > NOW() - INTERVAL '6 hours'
      ORDER BY station_id, time DESC
    `);
    return result.rows.map(r => ({
      station_id: r.station_id,
      time: r.time,
      wind_speed: r.wind_speed ?? 0,
      wind_dir: r.wind_dir,
      wind_gust: r.wind_gust,
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
async function persistSpotScores(results: SpotResult[], engine: Map<string, SpotScore> | null): Promise<void> {
  const db = getPool();
  const now = new Date();
  // Writing the engine columns before they exist would reject every score row, not just those fields.
  const withEngine = engine !== null && await hasColumn('spot_scores', 'engine_wind_kt');
  // Without the columns the shadow is dropped silently, so say so once, and once more when
  // they appear (hasColumn re-checks a missing column every 30 min, no restart needed).
  if (engine !== null) {
    if (!withEngine && engineColsState !== false) {
      log.warn('[Analyzer] spot_scores sin columnas engine_verdict/engine_wind_kt: la sombra del motor no se guarda; aplicar el ALTER de schema.sql en la base de datos');
      engineColsState = false;
    } else if (withEngine && engineColsState === false) {
      log.info('[Analyzer] columnas engine_* presentes: la sombra del motor ya se guarda');
      engineColsState = true;
    } else if (withEngine && engineColsState === null) {
      engineColsState = true;
    }
  }
  for (const r of results) {
    if (r.verdict === 'unknown') continue;
    const e = withEngine ? engineView(engine!.get(r.spot.id)) : null;
    await db.query(
      `INSERT INTO spot_scores
         (time, spot_id, sector, verdict, wind_kt, gust_kt, wind_dir, score,
          station_count, inferred_dir, raw_wind_kt, boosted_by, boost_confidence${withEngine ? ', engine_verdict, engine_wind_kt' : ''})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13${withEngine ? ', $14, $15' : ''})
       ON CONFLICT (time, spot_id) DO NOTHING`,
      [
        now, r.spot.id, r.spot.sector, r.verdict, r.avgWindKt, r.maxGustKt, r.avgDir, 0,
        r.stationCount, r.inferredDir || null,
        r.rawWindKt ?? null, r.boostedBy ?? null, r.boostConfidence ?? null,
        ...(withEngine ? [e?.verdict ?? null, e?.windKt ?? null] : []),
      ]
    );
  }
}

/**
 * Run analysis cycle. Called from main poll loop every 5 minutes.
 */
export async function runAnalysis(): Promise<void> {
  // One-time push-channel heartbeat ("[Push] enabled, N subscriptions") in
  // THIS process's log too — internally guarded, no-op after the first call.
  void logPushStartup();

  const now = Date.now();

  // 1. Get latest readings from DB
  const readings = await getLatestReadings();
  const buoys = await getLatestBuoys();

  if (readings.length === 0 && buoys.length === 0) {
    return; // No data, skip
  }

  // Rain at the Cesantes stations, for the rain veto of its thermal breeze. ONE query, for
  // exactly the stations the spot is scored on; the map's engine gets the same samples.
  const cesantesDef = SPOTS.find((s) => s.id === 'cesantes');
  const precipIds = cesantesDef ? selectNearbyStations(cesantesDef, readings).map((n) => n.r.station_id) : [];
  const upperWind = await getUpperWindNow();
  const ctx: ScoreContext = { precip: await getRecentPrecip(precipIds), nowMs: now, upperWind };
  const riasRegime = assessSynopticRegime(upperWind.rias);
  const regimeLine = !riasRegime ? 'sin dato de altura (sin veto)'
    : riasRegime.vetoed ? `frente en Rías — ${riasRegime.reason}`
    : `brisa posible en Rías (${Math.round(upperWind.rias!.speedKt)} kt ${degreesToCardinal(upperWind.rias!.dirDeg)} a 850 hPa)`;
  if (regimeLine !== lastRegimeLine) {
    log.info(`[Analyzer] Régimen: ${regimeLine}`);
    lastRegimeLine = regimeLine;
  }

  // The map's engine on the same rows (engineShadow.ts). Since 1-oct the alerts are built from
  // it (alertResult) so Telegram says what the map says; ANALYZER_WIND=pipeline goes back to the
  // port. A failure here only costs that: every spot falls back to the port's result.
  let engineScores: Map<string, SpotScore> | null = null;
  try {
    engineScores = scoreWithEngine(readings, buoys, ctx.precip, ctx.upperWind);
  } catch (err) {
    log.warn(`Engine failed, alerts use the pipeline this cycle: ${(err as Error).message}`);
  }
  const alertsFromEngine = ALERTS_FROM_ENGINE && engineScores !== null;
  const modeLine = alertsFromEngine ? 'motor del mapa' : ALERTS_FROM_ENGINE ? 'calculo propio (el motor fallo)' : 'calculo propio (ANALYZER_WIND=pipeline)';
  if (modeLine !== lastAlertModeLine) {
    log.info(`[Analyzer] Avisos con el viento del ${modeLine}`);
    lastAlertModeLine = modeLine;
  }

  // Strikes of the last LIGHTNING_WINDOW_MIN, once per cycle: they hold back «go sailing» alerts
  // with a storm near.
  const strikesNow = await getRecentStrikes();

  // 2. Score each spot, detect transitions, and persist to DB
  const scoreRows: SpotResult[] = [];
  const pipelineRows: SpotResult[] = [];
  const boostedSpots: string[] = [];
  for (const spot of SPOTS) {
    const pipelineResult = scoreSpot(spot, readings, buoys, ctx);
    pipelineRows.push(pipelineResult);
    const result = alertsFromEngine ? alertResult(pipelineResult, engineScores!.get(spot.id)) : pipelineResult;
    scoreRows.push(result);

    if (spot.id === 'cesantes') {
      const vetoed = result.rainVeto != null;
      if (vetoed !== cesantesRainVetoed) {
        log.info(vetoed
          ? `[Analyzer] Cesantes: veto de lluvia activo — ${result.rainVeto}`
          : '[Analyzer] Cesantes: veto de lluvia levantado');
        cesantesRainVetoed = vetoed;
      }
    }

    // Log boosts at cycle end (avoid noisy logs on single transitions).
    // The detector summary is more useful than per-spot WARN entries.
    if (result.boostedBy && result.rawWindKt !== undefined) {
      boostedSpots.push(
        `${spot.id}=${result.rawWindKt}→${result.avgWindKt}kt (${result.boostedBy} ${result.boostConfidence}%)`
      );
    }

    // A rise from calm/light into a sailable verdict, held for OPPORTUNITY_CONFIRM_CYCLES
    // cycles (stepOpportunityRise). A spot is only armed once it has been SEEN calm or light,
    // so a restart never announces whatever the wind happened to be doing at that moment.
    const ok = ALERT_VERDICTS.has(result.verdict)
      && isWorthAlerting(result.verdict, result.avgWindKt) && canAlertOnResult(result);
    const step = stepOpportunityRise(riseStates.get(spot.id), result.verdict, ok);
    riseStates.set(spot.id, step.state);
    const rises = step.confirmed;
    const storm = rises ? stormNearPoint(spot.lat, spot.lon, strikesNow) : null;
    if (storm) {
      log.info(`[Analyzer] ${spot.name} ${VERDICT_LABEL[result.verdict]} ${Math.round(result.avgWindKt)}kt: aviso no enviado, tormenta cerca (${storm.count} rayos, el mas cercano a ${storm.nearestKm} km)`);
    } else if (rises && !opportunityAlertAllowed(spot.sector, upperWind)) {
      log.info(`[Analyzer] ${spot.name} ${VERDICT_LABEL[result.verdict]} ${Math.round(result.avgWindKt)}kt: aviso no enviado, hay frente (veto 850 hPa)`);
    } else if (rises) {
      const dir = result.avgDir != null ? degreesToCardinal(result.avgDir) : '';
      await dispatchSpotAlert(
        spot.id, spot.name, spot.sector === 'embalse' ? 'Embalse' : 'Rías Baixas',
        VERDICT_LABEL[result.verdict], result.avgWindKt, dir,
        { gustKt: result.maxGustKt > 0 ? result.maxGustKt : undefined },
      );
    }
  }

  // Detector summary log (cycle-level — once per 5min poll instead of per-spot)
  if (boostedSpots.length > 0) {
    log.info(`Detector boosts active: ${boostedSpots.join(', ')}`);
  }

  // Buoys now carry the x1.5 over-water weight, so a buoy feed that quietly
  // goes stale takes real authority out of the consensus. Say so: the last
  // blackout ran 40 days before anyone noticed.
  const staleBuoys = scoreRows.reduce((n, r) => n + (r.staleBuoysDropped ?? 0), 0);
  if (staleBuoys > 0) {
    log.warn(`Buoy readings past the freshness gate this cycle: ${staleBuoys}`);
  }

  // Where the old port would have said something else (pipelineRows, never sent while the
  // alerts come from the engine): kept in the log for the first days of the switch.
  if (engineScores) {
    const line = describeDivergences(findDivergences(pipelineRows, engineScores), pipelineRows.length);
    if (line) log.info(line);
  }

  // 3. Persist spot scores to DB (for verification dashboard)
  await persistSpotScores(scoreRows, engineScores).catch(err =>
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
        // A thermal-wind forecast is an invitation too. On 29-sep it announced «Viento probable
        // 12-19h» for the reservoir with 47-54 kt from the SSW at 850 hPa over it: a front, not a
        // thermal. Same veto as the spot alert and the breeze boosts.
        if (signals.length > 0 && (sector === 'rias' || sector === 'embalse')
            && !opportunityAlertAllowed(sector, upperWind)) {
          log.info(`[Analyzer] Previsión térmica ${sector}: aviso no enviado, hay frente (veto 850 hPa)`);
          continue;
        }
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
    await evaluateAndDispatchMagicWindow(readings, buoys, ctx.upperWind?.rias ?? null);
  } catch (err) {
    log.warn(`Magic window evaluation failed: ${(err as Error).message}`);
  }

  // 5. LOCAL lightning safety runs after every lightning poll instead (runLightningSafety).

  // 6. Strong-wind SAFETY alert (windSafetyLogic.ts): measured gusts, two sources near a spot.
  try {
    await checkStrongWind(readings, buoys, now);
  } catch (err) {
    log.warn(`Strong wind check failed: ${(err as Error).message}`);
  }
}

// ── Strong wind (SAFETY) ──────────────────────────────

const windEpisodes = new Map<string, WindEpisode>();

/** Restore the strong-wind episodes from the sends actually made (sentAlerts.ts), so a restart in
 *  the middle of a gale does not announce it again. A send older than the episode gap ended its
 *  episode already, and a new one is announced as usual. */
export function seedWindEpisodes(sends: PastSend[], nowMs = Date.now()): number {
  let n = 0;
  for (const [sector, ep] of episodesFromSends(sends, nowMs)) { windEpisodes.set(sector, ep); n++; }
  return n;
}

/** Second half of the restore: an episode whose last send is older than the gap but whose gale
 *  the readings show still blowing stays open (reopenFromHistory). Reads the last gap plus the
 *  freshness window, only when some sector needs it. Returns how many episodes were reopened. */
export async function reopenWindEpisodesFromHistory(sends: PastSend[], nowMs = Date.now()): Promise<number> {
  const needed = sends.some((s) => s.key.startsWith('wind:') && !windEpisodes.has(s.key.slice(5))
    && nowMs - s.atMs > WIND_EPISODE_GAP_MS && nowMs - s.atMs <= WIND_REOPEN_MAX_MS);
  if (!needed) return 0;
  const minutes = Math.round(WIND_EPISODE_GAP_MS / 60_000) + WIND_MAX_AGE_MIN;
  try {
    const db = getPool();
    const altitude = await stationAltitudeSql();
    const [st, bu] = await Promise.all([
      db.query<StationReading>(`
        SELECT r.station_id, r.time, r.wind_speed, r.wind_gust, r.wind_dir,
               s.latitude, s.longitude, s.name, s.source, ${altitude} AS altitude,
               NULL::float8 AS temperature, NULL::float8 AS humidity
          FROM readings r JOIN stations s ON s.station_id = r.station_id
         WHERE r.time > NOW() - ($1::int * INTERVAL '1 minute')
           AND r.wind_gust IS NOT NULL AND ${altitude} <= $2`,
        [minutes, Math.max(...Object.values(WIND_MAX_ALTITUDE_M))]),
      db.query<{ station_id: number; time: Date; wind_speed: number | null; wind_dir: number | null; wind_gust: number }>(`
        SELECT station_id, time, wind_speed, wind_dir, wind_gust
          FROM buoy_readings
         WHERE time > NOW() - ($1::int * INTERVAL '1 minute') AND wind_gust IS NOT NULL`,
        [minutes]),
    ]);
    const buoys: BuoyWind[] = bu.rows.map((r) => ({
      station_id: r.station_id, time: r.time, wind_speed: r.wind_speed ?? 0, wind_dir: r.wind_dir, wind_gust: r.wind_gust,
      lat: BUOY_COORDS[r.station_id]?.lat ?? 0, lon: BUOY_COORDS[r.station_id]?.lon ?? 0,
      station_name: BUOY_NAMES[r.station_id] ?? `Boya ${r.station_id}`,
    }));
    const reopened = reopenFromHistory(sends, new Set(windEpisodes.keys()), SAFETY_SPOTS, st.rows, buoys, nowMs);
    for (const [sector, ep] of reopened) windEpisodes.set(sector, ep);
    return reopened.size;
  } catch (err) {
    log.warn(`Strong wind episode replay failed: ${(err as Error).message}`);
    return 0;
  }
}
/** Last state logged per sector (windLogDue): the log says when it changes, plus an hourly heartbeat. */
const lastWindLog = new Map<string, { state: string; atMs: number }>();

async function checkStrongWind(readings: StationReading[], buoys: BuoyWind[], nowMs: number): Promise<void> {
  for (const a of assessStrongWind(SAFETY_SPOTS, readings, buoys, nowMs)) {
    const state = windLogState(a);
    if (windLogDue(lastWindLog.get(a.sector), state, nowMs)) {
      const detail = a.evidence.map((e) => `${e.name} ${Math.round(e.gustKt)}/${Math.round(e.meanKt)}`).join(', ');
      log.info(`[Viento fuerte] ${a.sector}: ${state}${detail ? ` — ${detail}` : ''}`);
      lastWindLog.set(a.sector, { state, atMs: nowMs });
    }
    const { due, episode } = windAlertDue(windEpisodes.get(a.sector), a.level, nowMs);
    if (episode) windEpisodes.set(a.sector, episode); else windEpisodes.delete(a.sector);
    if (!due || !a.level || !episode) continue;
    const { title, message } = formatWindSafetyMessage(a);
    if (await dispatchWindSafetyAlert(a.sector, a.level, title, message)) episode.sentLevel = a.level;
  }
}

// ── Lightning proximity (LOCAL safety) ────────────────

/**
 * Cloud-to-ground strikes in the proximity window, Galicia bbox only.
 * Cheap query — lightning_strikes is time-indexed and the window is short.
 */
async function getRecentStrikes(): Promise<ProximityStrike[]> {
  const db = getPool();
  try {
    const result = await db.query<{ time: Date; lat: number; lon: number }>(`
      SELECT time, lat, lon
      FROM lightning_strikes
      WHERE time > NOW() - ($1::int * INTERVAL '1 minute')
        AND cloud_to_cloud = FALSE
        AND is_galicia = TRUE
    `, [LIGHTNING_WINDOW_MIN]);
    return result.rows.map(r => ({ lat: r.lat, lon: r.lon, time: r.time }));
  } catch (err) {
    log.warn(`getRecentStrikes failed: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Assess per-spot lightning risk and dispatch ONE message per sector listing
 * the affected spots — a storm over the ría would otherwise fire the same
 * information five times, once per spot.
 */
/**
 * LOCAL lightning safety — "rayo a X km de TU spot". Observed strikes (certified source), not a
 * model; the per-spot distance is the signal the sector-wide storm probability structurally
 * cannot give. index.ts runs it right after each lightning poll (every 2 min in a storm, 5 in
 * calm), so a warning follows the strikes as they reach the table, not the 5-min analysis
 * cycle on top of the poll (6-oct: Telegram ran 8-13 min behind the strikes, the map ~5).
 */
export async function runLightningSafety(): Promise<void> {
  try {
    await checkLightningProximity(await getRecentStrikes());
  } catch (err) {
    log.warn(`Lightning proximity check failed: ${(err as Error).message}`);
  }
}

async function checkLightningProximity(strikes: ProximityStrike[]): Promise<void> {
  if (strikes.length === 0) return; // quiet weather — no heartbeat needed

  const risks = assessSpotLightningRisk(SAFETY_SPOTS, strikes);
  if (risks.length === 0) {
    // Heartbeat only while there IS activity: shows the detector ran and
    // judged the storm too far from every spot.
    log.info(`Lightning proximity quiet — ${strikes.length} strikes in window, none near a spot`);
    return;
  }

  // Web Push fan-out — PER SPOT (the whole point of the channel is "rayo a
  // X km de TU spot", not a sector digest). Fire-and-forget: the dispatcher
  // catches everything internally and push IO must never block the 5min
  // polling loop (only sub-10s tasks may be awaited here).
  for (const r of risks) {
    void dispatchLightningPush(r.spotId, r.spotName, r.sector ?? 'rias', r);
  }

  const bySector = new Map<string, SpotLightningRisk[]>();
  for (const r of risks) {
    const key = r.sector ?? 'rias';
    const list = bySector.get(key) ?? [];
    list.push(r);
    bySector.set(key, list);
  }

  for (const [sector, list] of bySector) {
    const worst = list[0].level; // list preserves worst-first sort
    const lines = list.slice(0, 4).map(formatRiskLine);
    await dispatchLightningAlert(
      sector === 'embalse' ? 'Embalse' : 'Rias Baixas', worst, lines,
      Math.min(...list.map((r) => r.nearestKm)),
    );
  }
}

// ── Magic Window helpers (T2-2 S136+3+3) ───────────────

/**
 * Compute mouth-of-ría humidity from station readings, for the magic window.
 * Mouth bbox: lon < -8.78, lat 42.15-42.30. Uses 75th percentile to be robust
 * to interior dry leaks.
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
async function countRecentNearbyStrikes(minutes = 15): Promise<number> {
  const db = getPool();
  try {
    // Rías sector center ~ (42.23, -8.80). 30km ≈ 0.27° latitude.
    const result = await db.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM lightning_strikes
      WHERE time > NOW() - make_interval(mins => $1)
        AND lat BETWEEN 41.96 AND 42.50
        AND lon BETWEEN -9.07 AND -8.53
    `, [minutes]);
    return parseInt(result.rows[0]?.count ?? '0', 10) || 0;
  } catch (err) {
    // 0 strikes DISABLES the magic-window veto, so this failure opens a
    // safety gate rather than closing it. Never let it be silent.
    log.warn(`Magic window strike-veto query failed (veto disabled this cycle): ${(err as Error).message}`);
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
  /** 850 hPa over the Rías: a front aloft vetoes the window (synopticRegime.ts) */
  upperWindRias: UpperWind | null,
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
  const stormDayStrikes = await countRecentNearbyStrikes(360);

  const result = evaluateMagicWindow({
    sector: 'rias',
    buoys: buoyReadings,
    mouthHumidity: mouthHum,
    airTempLocal: airTemp,
    recentStrikesNearby: recentStrikes,
    stormDayStrikes,
    regime: assessSynopticRegime(upperWindRias),
  });

  if (!result) return; // Sector not applicable

  if (result.active) {
    log.info(`Magic Window ACTIVE — score=${result.score}/100, ~${result.estimatedHours}h`);
    await persistMagicWindow(result.score, result.summary, result.estimatedHours);
    // Off Telegram until validated (6-oct): it is a textbook detector with no check against what
    // the water did. Still computed, stored and logged, so its firings can be graded.
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
