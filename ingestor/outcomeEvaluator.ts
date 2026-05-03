/**
 * Prediction outcome evaluator.
 *
 * For each row in `storm_predictions` whose horizon (6h) has fully elapsed
 * AND no outcome row exists yet, evaluate what actually happened in
 * [prediction_time, prediction_time + 6h] by querying:
 *   - `lightning_strikes` within sector bbox
 *   - `convection_grid_hourly.precip_mm` (max across cells in sector)
 *
 * Then write `prediction_outcomes(prediction_time, sector, ...)` with the
 * accuracy verdict.
 *
 * The evaluator runs nightly (3 AM UTC). 6h horizon means predictions made
 * up to 18:00 UTC the day before are evaluable by 00:00 the next day, but
 * we wait an extra 3h for safety against late lightning ingestion.
 *
 * Verdict logic (kept simple + auditable, exposed for unit tests):
 *   - Predicted ACTIVE  (probability >= 60): correct iff strikes >= 5 OR maxRain >= 5
 *   - Predicted QUIET   (probability < 30):  correct iff strikes <  3 AND maxRain < 1
 *   - UNCERTAIN (30-59): was_correct = NULL (don't penalize honest uncertainty)
 *
 * The 5/3/5/1 thresholds are intentionally moderate — most Galician storms
 * produce far more rain/strikes than this in a 6h window, so a real event
 * easily clears the bar; a quiet day is silent enough to clearly fall under.
 * Tweak in the constants below as the dataset matures.
 */

import { getPool } from './db.js';
import { log } from './logger.js';

// ── Sector bboxes (mirrors src/config/sectors.ts geometry) ──

interface SectorBbox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

const SECTOR_BBOXES: Record<string, SectorBbox> = {
  // ~50km radius around each sector center
  embalse: { latMin: 41.9, latMax: 42.7, lonMin: -8.4, lonMax: -7.5 },
  rias:    { latMin: 41.9, latMax: 42.8, lonMin: -9.2, lonMax: -8.2 },
};

// ── Verdict thresholds ────────────────────────────────────

export const VERDICT_THRESHOLDS = {
  /** Prediction is "active" when probability >= this (correct iff event happened). */
  ACTIVE_PROB: 60,
  /** Prediction is "quiet" when probability < this (correct iff calm). */
  QUIET_PROB: 30,
  /** Number of strikes that count as "active event". */
  ACTIVE_STRIKES: 5,
  /** mm/h max precip (any cell in sector) that counts as "active event". */
  ACTIVE_RAIN_MM: 5,
  /** Strikes below this means atmosphere was quiet. */
  QUIET_STRIKES: 3,
  /** mm/h below this in every cell means atmosphere was quiet. */
  QUIET_RAIN_MM: 1,
} as const;

const HORIZON_HOURS = 6;
const SAFETY_LAG_HOURS = 3; // wait extra 3h for lightning ingestion to settle

// ── Pure verdict logic (testable) ─────────────────────────

export interface OutcomeInput {
  predictedProbability: number;
  observedStrikeCount: number;
  /** Open-Meteo grid max precip in window (model analysis, ~10km interpolation) */
  observedMaxRainGridMm: number | null;
  /** Real station max precip in window (direct pluviometer — ground truth) */
  observedMaxRainStationsMm: number | null;
}

/**
 * Compute the verdict (was_correct) given a prediction probability and the
 * observed event metrics. Returns null when the prediction was in the
 * "uncertain" 30-59% band — we don't grade those because the predictor
 * was honestly hedging.
 *
 * Rain decision uses MAX(grid, stations): stations are direct truth where
 * available; the grid covers the gaps in station network. If EITHER source
 * confirms rain ≥ 5mm/h, the event happened.
 */
export function computeVerdict(input: OutcomeInput): boolean | null {
  const { predictedProbability, observedStrikeCount } = input;
  const rain = Math.max(
    input.observedMaxRainGridMm ?? 0,
    input.observedMaxRainStationsMm ?? 0,
  );
  const eventHappened =
    observedStrikeCount >= VERDICT_THRESHOLDS.ACTIVE_STRIKES ||
    rain >= VERDICT_THRESHOLDS.ACTIVE_RAIN_MM;
  const atmosphereQuiet =
    observedStrikeCount < VERDICT_THRESHOLDS.QUIET_STRIKES &&
    rain < VERDICT_THRESHOLDS.QUIET_RAIN_MM;

  if (predictedProbability >= VERDICT_THRESHOLDS.ACTIVE_PROB) {
    return eventHappened;
  }
  if (predictedProbability < VERDICT_THRESHOLDS.QUIET_PROB) {
    return atmosphereQuiet;
  }
  return null; // 30-59% = honest uncertainty, don't grade
}

// ── DB queries ────────────────────────────────────────────

interface PredictionRow {
  time: Date;
  sector: string;
  probability: number;
  horizon: string | null;
  severity: string | null;
}

/**
 * Find predictions ready to evaluate: horizon elapsed + safety lag + no
 * outcome row yet. Bounded LIMIT prevents runaway nightly job in case the
 * outcomes table got out of sync.
 */
async function findPendingPredictions(): Promise<PredictionRow[]> {
  const db = getPool();
  const cutoff = new Date(Date.now() - (HORIZON_HOURS + SAFETY_LAG_HOURS) * 3600_000);
  const result = await db.query(
    `SELECT p.time, p.sector, p.probability, p.horizon, p.severity
     FROM storm_predictions p
     LEFT JOIN prediction_outcomes o
       ON date_trunc('milliseconds', o.prediction_time) = date_trunc('milliseconds', p.time)
       AND o.sector = p.sector
     WHERE p.time <= $1
       AND o.prediction_time IS NULL
     ORDER BY p.time DESC
     LIMIT 5000`,
    [cutoff],
  );
  return result.rows.map((r) => ({
    time: r.time as Date,
    sector: r.sector as string,
    probability: Number(r.probability),
    horizon: r.horizon as string | null,
    severity: r.severity as string | null,
  }));
}

interface ObservedMetrics {
  strikeCount: number;
  /** Open-Meteo grid (interpolated model analysis) */
  maxRainGridMm: number | null;
  /** Real station readings (direct pluviometer — ground truth) */
  maxRainStationsMm: number | null;
}

async function observeWindow(
  prediction: PredictionRow,
): Promise<ObservedMetrics> {
  const bbox = SECTOR_BBOXES[prediction.sector];
  if (!bbox) return { strikeCount: 0, maxRainGridMm: null, maxRainStationsMm: null };

  const db = getPool();
  const start = prediction.time;
  const end = new Date(prediction.time.getTime() + HORIZON_HOURS * 3600_000);

  // Lightning strikes count
  const strikesQ = await db.query(
    `SELECT count(*)::int AS n
     FROM lightning_strikes
     WHERE time >= $1 AND time <= $2
       AND lat BETWEEN $3 AND $4
       AND lon BETWEEN $5 AND $6`,
    [start, end, bbox.latMin, bbox.latMax, bbox.lonMin, bbox.lonMax],
  );

  // Max precip across all Open-Meteo grid cells in sector during the window
  const rainGridQ = await db.query(
    `SELECT max(precip_mm) AS max_mm
     FROM convection_grid_hourly
     WHERE time >= $1 AND time <= $2
       AND lat BETWEEN $3 AND $4
       AND lon BETWEEN $5 AND $6`,
    [start, end, bbox.latMin, bbox.latMax, bbox.lonMin, bbox.lonMax],
  );

  // Max precip from REAL station pluviometers in sector during the window.
  // `readings` lacks lat/lon directly so we JOIN with `stations`. Columns
  // in `stations` are: station_id (PK), source, name, latitude, longitude,
  // altitude, updated_at. Only surface stations report `precip` (most do,
  // including AEMET/MG/MC). This is the GROUND TRUTH where coverage exists
  // — direct pluviometer measurement, not model interpolation.
  const rainStationsQ = await db.query(
    `SELECT max(r.precip) AS max_mm
     FROM readings r
     JOIN stations s ON r.station_id = s.station_id
     WHERE r.time >= $1 AND r.time <= $2
       AND r.precip IS NOT NULL
       AND s.latitude  BETWEEN $3 AND $4
       AND s.longitude BETWEEN $5 AND $6`,
    [start, end, bbox.latMin, bbox.latMax, bbox.lonMin, bbox.lonMax],
  );

  return {
    strikeCount: strikesQ.rows[0]?.n ?? 0,
    maxRainGridMm: rainGridQ.rows[0]?.max_mm == null ? null : Number(rainGridQ.rows[0].max_mm),
    maxRainStationsMm: rainStationsQ.rows[0]?.max_mm == null ? null : Number(rainStationsQ.rows[0].max_mm),
  };
}

async function insertOutcome(
  prediction: PredictionRow,
  observed: ObservedMetrics,
  verdict: boolean | null,
): Promise<void> {
  const db = getPool();
  await db.query(
    `INSERT INTO prediction_outcomes
       (prediction_time, sector, evaluated_at,
        predicted_probability, predicted_horizon, predicted_severity,
        observed_lightning_count,
        observed_max_rain_grid_mm, observed_max_rain_stations_mm,
        was_correct)
     VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (prediction_time, sector) DO NOTHING`,
    [
      prediction.time, prediction.sector,
      prediction.probability, prediction.horizon, prediction.severity,
      observed.strikeCount,
      observed.maxRainGridMm, observed.maxRainStationsMm,
      verdict,
    ],
  );
}

// ── Public entry ──────────────────────────────────────────

/**
 * Evaluate all pending storm_predictions. Idempotent — re-runs skip
 * already-evaluated rows. Suitable for nightly cron.
 */
export async function runOutcomeEvaluatorCycle(): Promise<void> {
  const pending = await findPendingPredictions();
  if (pending.length === 0) {
    log.info('[Outcomes] no pending predictions to evaluate');
    return;
  }

  log.info(`[Outcomes] evaluating ${pending.length} pending predictions...`);
  let written = 0;
  let correct = 0;
  let incorrect = 0;
  let uncertain = 0;
  let errors = 0;

  for (const p of pending) {
    try {
      const observed = await observeWindow(p);
      const verdict = computeVerdict({
        predictedProbability: p.probability,
        observedStrikeCount: observed.strikeCount,
        observedMaxRainGridMm: observed.maxRainGridMm,
        observedMaxRainStationsMm: observed.maxRainStationsMm,
      });
      await insertOutcome(p, observed, verdict);
      written++;
      if (verdict === true) correct++;
      else if (verdict === false) incorrect++;
      else uncertain++;
    } catch (err) {
      errors++;
      log.error(`[Outcomes] eval failed for ${p.time.toISOString()}/${p.sector}: ${(err as Error).message}`);
    }
  }

  const total = correct + incorrect;
  const accuracyPct = total > 0 ? Math.round((100 * correct) / total) : 0;
  log.info(
    `[Outcomes] cycle ok — ${written} written, ${correct} correct, ${incorrect} incorrect, ` +
    `${uncertain} uncertain, ${errors} errors. Recent accuracy: ${accuracyPct}%`,
  );
}
