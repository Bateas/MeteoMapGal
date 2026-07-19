/**
 * MeteoMapGal Weather Ingestor
 *
 * Standalone service that polls 6 weather sources every 5 minutes
 * and persists readings into TimescaleDB.
 *
 * Usage:
 *   npm start          # production
 *   npm run dev        # watch mode (auto-restart on file changes)
 */

import 'dotenv/config';
import { initPool, pingDb, getPool, batchUpsert, batchUpsertBuoys, batchUpsertStations, closePool } from './db.js';
import { discoverAllStations } from './discover.js';
import { fetchAllObservations } from './fetchers.js';
import { fetchBuoyObservations } from './buoyFetcher.js';
import { log } from './logger.js';
import { checkAndSendDailySummary } from './dailySummary.js';
import { runAnalysis } from './analyzer.js';
import { runWebcamAnalysis } from './webcamAnalyzer.js';
import { runLightningCycle } from './lightningFetcher.js';
import { runSynopticCycle } from './synopticFetcher.js';
import { runFirmsCycle } from './firmsFetcher.js';
import { runIcaCycle } from './icaFetcher.js';
import { runConvectionGridCycle } from './convectionGridFetcher.js';
import { runOutcomeEvaluatorCycle } from './outcomeEvaluator.js';
import { runFireWatchCycle } from './fireWatch.js';
import { findStaleBuoys, formatSilence } from './buoyStaleness.js';
import type { NormalizedStation } from '../src/types/station.js';

// ── Configuration ────────────────────────────────────

const POLL_INTERVAL_MIN = parseInt(process.env.POLL_INTERVAL_MIN || '5', 10);
const DISCOVER_INTERVAL_MIN = parseInt(process.env.DISCOVER_INTERVAL_MIN || '60', 10);

const POLL_MS = POLL_INTERVAL_MIN * 60_000;
const DISCOVER_MS = DISCOVER_INTERVAL_MIN * 60_000;

// ── State ────────────────────────────────────────────

let stations = new Map<string, NormalizedStation>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let discoverTimer: ReturnType<typeof setInterval> | null = null;
let lightningTimer: ReturnType<typeof setInterval> | null = null;
let synopticTimer: ReturnType<typeof setInterval> | null = null;
let firmsTimer: ReturnType<typeof setInterval> | null = null;
let icaTimer: ReturnType<typeof setInterval> | null = null;
let convGridTimer: ReturnType<typeof setInterval> | null = null;
let outcomesTimer: ReturnType<typeof setInterval> | null = null;
let fireWatchTimer: ReturnType<typeof setInterval> | null = null;
let isShuttingDown = false;
let cycleCount = 0;

// Staleness alarm for buoy data. The 5-min polling cycle gives:
//   12 cycles  = ~1 h    (warn — could be transient)
//   288 cycles = ~24 h   (error — pipeline definitely broken; re-emit daily)
// Calibrated from the incident where buoys were silently dead for
// 40 days (PORTUS IP block in late March 2026, undetected because no log
// alarm was wired up).
let consecutiveEmptyBuoyCycles = 0;
const BUOY_STALE_CYCLES_WARN = 12;
const BUOY_STALE_CYCLES_ERROR = 288;

// Per-station buoy staleness. The counter above answers "did ANY buoy
// report?", which is green as long as one station is alive — that is exactly
// how buoys 2248 + 3223 stayed dead for 40 days without a single log line.
// These maps answer the question that actually matters: "which station that
// used to report has stopped?".
const buoyLastSeen = new Map<number, number>();
const buoyStaleWarnedAt = new Map<number, number>();

// PORTUS publishes with up to ~2h of lag and the REDEXT/CETMAR moorings only
// refresh every 30-60min, so anything under a few hours is normal operation
// rather than a fault. 12h is comfortably clear of every upstream cadence
// while still catching a blackout on its first day instead of its fortieth.
// (buoyFetcher runs a tighter per-cycle check for transient flakiness; this
// one is the escalation, so it must not fire on the same noise.)
const BUOY_STATION_STALE_MS = 12 * 60 * 60_000;
// One line per station per 12h at most — an outage stays visible in the log
// without burying the cycle output.
const BUOY_STATION_REWARN_MS = 12 * 60 * 60_000;

// How far back to look when seeding the roster at startup. Without seeding,
// a station that died BEFORE the process started is simply "never seen" and
// can never be flagged — a restart would erase the very outage we are hunting.
// 90 days both covers the 40-day case and retires stations decommissioned a
// quarter ago, so a permanently removed buoy stops warning on its own.
const BUOY_SEED_LOOKBACK_DAYS = 90;

/**
 * Seed `buoyLastSeen` from the DB so staleness survives a restart.
 * Best-effort: on failure the map stays empty and tracking degrades to
 * "stations observed since boot", which is still better than nothing.
 */
async function seedBuoyLastSeen(): Promise<void> {
  try {
    const { rows } = await getPool().query<{ station_id: number; last_time: Date }>(
      `SELECT station_id, MAX(time) AS last_time
         FROM buoy_readings
        WHERE time > NOW() - ($1 || ' days')::INTERVAL
        GROUP BY station_id`,
      [String(BUOY_SEED_LOOKBACK_DAYS)],
    );
    for (const row of rows) {
      buoyLastSeen.set(Number(row.station_id), new Date(row.last_time).getTime());
    }
    log.info(`[Buoys] staleness roster seeded: ${rows.length} stations seen in the last ${BUOY_SEED_LOOKBACK_DAYS} days`);
  } catch (err) {
    log.warn(`[Buoys] could not seed staleness roster — per-station alarm only covers stations seen since boot: ${(err as Error).message}`);
  }
}

/**
 * Record which stations reported this cycle, then log any known station that
 * has gone quiet for longer than the threshold.
 */
function checkBuoyStationStaleness(stationIds: number[]): void {
  const now = Date.now();
  for (const id of stationIds) buoyLastSeen.set(id, now);

  const stale = findStaleBuoys({
    now,
    lastSeen: buoyLastSeen,
    lastWarnedAt: buoyStaleWarnedAt,
    staleAfterMs: BUOY_STATION_STALE_MS,
    reWarnAfterMs: BUOY_STATION_REWARN_MS,
  });
  if (stale.length === 0) return;

  for (const s of stale) buoyStaleWarnedAt.set(s.stationId, now);
  const detail = stale.map((s) => `${s.stationId} (${formatSilence(s.silentMs)})`).join(', ');
  log.error(
    `[Buoys] STALE STATIONS: no data for ${detail}. ` +
      `Other buoys are reporting, so this is a per-station outage — ` +
      `check the station upstream, or disable it in buoyFetcher if it is gone for good.`,
  );
}

// ── Core cycle ───────────────────────────────────────

async function runCycle(): Promise<void> {
  if (isShuttingDown) return;
  cycleCount++;

  const cycleStart = Date.now();
  log.info(`── Cycle ${cycleCount} ──────────────────────────────`);

  if (stations.size === 0) {
    log.warn('No stations discovered — skipping weather fetch (buoys still run)');
  }

  try {
    // 1. Fetch weather observations from all 5 sources (requires stations)
    if (stations.size > 0) {
      const readings = await fetchAllObservations(stations);

      if (readings.length === 0) {
        log.warn('No weather readings fetched this cycle');
      } else {
        // 2. Persist weather readings to TimescaleDB
        const { inserted, skipped } = await batchUpsert(readings);
        log.info(`Weather: ${readings.length} readings → ${inserted} new, ${skipped} dedup`);
      }
    }

    // 3. Fetch buoy observations (PORTUS + Observatorio Costeiro)
    const buoyReadings = await fetchBuoyObservations();

    // Per-station tracking runs on EVERY cycle, including empty ones: a cycle
    // with zero readings is still evidence that no station reported.
    checkBuoyStationStaleness(buoyReadings.map((r) => r.stationId));

    if (buoyReadings.length > 0) {
      const { inserted: bInserted, skipped: bSkipped } = await batchUpsertBuoys(buoyReadings);
      log.info(`Buoys: ${buoyReadings.length} readings → ${bInserted} new, ${bSkipped} dedup`);
      consecutiveEmptyBuoyCycles = 0;  // success — clear the GLOBAL counter only
    } else {
      // Track empty cycles. Five-minute polling × 288 cycles/day = >50 empty
      // cycles in a row means buoys have been silent for a couple of hours.
      // The audit caught a 40-DAY blackout (PORTUS IP block) that
      // went unnoticed because the analyzer happily ran with stale data.
      // Escalate the log level so this CAN'T be missed again.
      consecutiveEmptyBuoyCycles++;
      if (consecutiveEmptyBuoyCycles === BUOY_STALE_CYCLES_WARN) {
        log.warn(
          `[Buoys] no readings for ${consecutiveEmptyBuoyCycles} cycles ` +
            `(~${Math.round((consecutiveEmptyBuoyCycles * 5) / 60)} h) — investigate PORTUS / ObsCosteiro`,
        );
      } else if (
        consecutiveEmptyBuoyCycles >= BUOY_STALE_CYCLES_ERROR &&
        consecutiveEmptyBuoyCycles % BUOY_STALE_CYCLES_ERROR === 0
      ) {
        // Re-emit error every 24h while the situation persists.
        log.error(
          `[Buoys] STALE: zero readings for ${consecutiveEmptyBuoyCycles} cycles ` +
            `(~${Math.round((consecutiveEmptyBuoyCycles * 5) / 60 / 24)} days). ` +
            `Pipeline almost certainly broken — ` +
            `check PORTUS reachability and ObsCosteiro auth.`,
        );
      }
    }

    // 4. Run spot analyzer — scoring + transitions + thermal forecast
    // Failure here means alert pipeline is broken — promoted to error after
    // audit (was warn — masking real pipeline outage).
    await runAnalysis().catch(err =>
      log.error('Analyzer failed:', (err as Error).message));

    // 5. Webcam vision analysis (every 3 cycles = ~15min, if enabled)
    // Fire-and-forget — Ollama CPU inference takes 6-7min for 12 cameras.
    // MUST NOT block the polling loop (caused 2h freeze in).
    // Failure = vision pipeline down, not transient → log.error.
    runWebcamAnalysis(cycleCount).catch(err =>
      log.error('Webcam analysis failed:', (err as Error).message));

    // 6. Check if daily summary should be sent (9:00 AM, once per day)
    // Failure here means user does NOT receive Telegram morning summary —
    // critical visibility, log.error mandatory.
    await checkAndSendDailySummary().catch(err =>
      log.error('Daily summary check failed:', (err as Error).message));

    const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
    log.ok(`Cycle ${cycleCount} complete (${elapsed}s)`);
  } catch (err) {
    log.error('Cycle failed:', (err as Error).message);
  }
}

async function rediscover(): Promise<void> {
  if (isShuttingDown) return;

  try {
    const newStations = await discoverAllStations();
    const prevCount = stations.size;
    stations = newStations;

    // Persist station coordinates to DB for analyzer distance queries
    const upserted = await batchUpsertStations(stations);
    log.info(`Stations persisted: ${upserted} upserted to DB`);

    if (stations.size !== prevCount) {
      log.info(`Station count changed: ${prevCount} → ${stations.size}`);
    }
  } catch (err) {
    log.error('Station re-discovery failed:', (err as Error).message);
    // Keep existing station map on failure
  }
}

// ── Startup ──────────────────────────────────────────

async function start(): Promise<void> {
  log.info('╔══════════════════════════════════════════╗');
  log.info('║   MeteoMapGal Weather Ingestor v1.0.0   ║');
  log.info('╚══════════════════════════════════════════╝');
  log.info(`Poll interval: ${POLL_INTERVAL_MIN}min | Re-discover: ${DISCOVER_INTERVAL_MIN}min`);

  // 1. Initialize database pool
  initPool();
  const dbOk = await pingDb();
  if (!dbOk) {
    log.error('Cannot connect to TimescaleDB — check .env configuration');
    process.exit(1);
  }
  log.ok('Connected to TimescaleDB');

  // Must run before the first cycle so a station that died before this
  // process started is already on the roster and can be flagged.
  await seedBuoyLastSeen();

  // 2. Initial station discovery + persist coords
  stations = await discoverAllStations();
  if (stations.size === 0) {
    log.warn('No stations found — will retry on next discovery cycle');
  } else {
    await batchUpsertStations(stations);
    log.ok(`${stations.size} station coords persisted to DB`);
  }

  // 3. First fetch cycle immediately
  await runCycle();

  // 4. Set up recurring timers
  pollTimer = setInterval(() => {
    runCycle().catch((err) => log.error('Poll timer error:', (err as Error).message));
  }, POLL_MS);

  discoverTimer = setInterval(() => {
    rediscover().catch((err) => log.error('Discover timer error:', (err as Error).message));
  }, DISCOVER_MS);

  // Lightning fetcher — independent 5min poll.
  // Decoupled from the main weather cycle so a slow station fetch never delays
  // strike persistence (real-time forensics matter for the lightning data).
  // First run after 30s stagger so it doesn't pile on top of the initial cycle.
  setTimeout(() => {
    runLightningCycle().catch((err) => log.error('[Lightning] init err:', (err as Error).message));
  }, 30_000);
  lightningTimer = setInterval(() => {
    runLightningCycle().catch((err) => log.error('[Lightning] timer err:', (err as Error).message));
  }, 5 * 60_000);

  // Synoptic fetcher — upper-air winds + convection.
  // Bumped 1h → 2h to fit within Open-Meteo free tier daily quota.
  // Real upper-air radiosonde launches happen twice/day (00 UTC + 12 UTC) — 2h
  // refresh from the model is already overkill. Halves the synoptic share of
  // the daily quota with zero operational loss.
  setTimeout(() => {
    runSynopticCycle().catch((err) => log.error('[Synoptic] init err:', (err as Error).message));
  }, 90_000);
  synopticTimer = setInterval(() => {
    runSynopticCycle().catch((err) => log.error('[Synoptic] timer err:', (err as Error).message));
  }, 2 * 60 * 60_000);

  // FIRMS fetcher — wildfire hotspots persistence.
  // 60min cadence (bumped from 30min, S136+3+5 audit): FIRMS NRT latency is
  // ~1h, so 30min polling re-fetched the same hotspots ~half the time. 60min
  // matches the data's real refresh and halves NASA FIRMS API calls. Fire
  // positions don't move fast enough to need sub-hourly refresh.
  // 150s stagger so it lands after lightning + synoptic to spread network load.
  setTimeout(() => {
    runFirmsCycle().catch((err) => log.error('[FIRMS Fetcher] init err:', (err as Error).message));
  }, 150_000);
  firmsTimer = setInterval(() => {
    runFirmsCycle().catch((err) => log.error('[FIRMS Fetcher] timer err:', (err as Error).message));
  }, 60 * 60_000);

  // ICA fetcher — Xunta air-quality persistence.
  // 60min cadence (bumped from 30min, S136+3+5 audit): Xunta publishes ICA
  // hourly, so the 30min poll produced ~50% duplicate inserts (ON CONFLICT
  // no-ops). 60min matches the actual publication rate with zero data loss.
  // 210s stagger so it lands after FIRMS to spread Xunta API load.
  setTimeout(() => {
    runIcaCycle().catch((err) => log.error('[ICA Fetcher] init err:', (err as Error).message));
  }, 210_000);
  icaTimer = setInterval(() => {
    runIcaCycle().catch((err) => log.error('[ICA Fetcher] timer err:', (err as Error).message));
  }, 60 * 60_000);

  // Convection grid fetcher — spatial CAPE/LI grid persistence.
  // Replaces frontend-direct Open-Meteo multi-point queries (which hit free-tier
  // burst limit). 120min cadence (bumped 90→120min, S136+3+5 audit): each cycle
  // costs ~600 coordinate-equivalent calls (Open-Meteo charges per coord). This
  // is the single biggest Open-Meteo consumer. History: 30min=~28,800/day
  // (quota blown), 90min=~9,600/day (~90% of the 10k daily limit, too tight
  // alongside forecast+synoptic), 120min=~7,200/day (comfortable headroom).
  // Operationally fine: CAPE ramps gradually, 120min refresh is plenty for
  // "where do storms form this afternoon" — it's a predictive overlay, not live.
  // 270s stagger so it lands after ICA to spread Open-Meteo load.
  setTimeout(() => {
    runConvectionGridCycle().catch((err) => log.error('[ConvGrid] init err:', (err as Error).message));
  }, 270_000);
  convGridTimer = setInterval(() => {
    runConvectionGridCycle().catch((err) => log.error('[ConvGrid] timer err:', (err as Error).message));
  }, 120 * 60_000);

  // Outcome evaluator — nightly job that evaluates each storm_prediction
  // against real lightning + rain (Open-Meteo grid + station pluviometers).
  // Runs every 6h instead of "true 3 AM cron" — simpler scheduling and the
  // job is idempotent (skips already-evaluated rows) so re-running is free.
  // 360s stagger so it lands after ConvGrid first cycle, ensuring data is in.
  setTimeout(() => {
    runOutcomeEvaluatorCycle().catch((err) => log.error('[Outcomes] init err:', (err as Error).message));
  }, 360_000);
  outcomesTimer = setInterval(() => {
    runOutcomeEvaluatorCycle().catch((err) => log.error('[Outcomes] timer err:', (err as Error).message));
  }, 6 * 60 * 60_000);

  // Fire watch — dry-lightning post-storm vigilance (August fire season).
  // Ground strikes without rain ignite fires that surface 7-18h later (the
  // lightning-to-fire attribution validated 106/106 June hotspots in that
  // window), so 30min cadence warns HOURS before FIRMS sees the hotspot.
  // Fire-and-forget like webcam/dailySummary — NEVER awaited in the poll
  // loop, and runFireWatchCycle() is internally fail-soft (log.warn only).
  // 420s stagger so it lands after the outcome evaluator's first run.
  setTimeout(() => {
    runFireWatchCycle().catch((err) => log.warn('[FireWatch] init err: ' + (err as Error).message));
  }, 420_000);
  fireWatchTimer = setInterval(() => {
    runFireWatchCycle().catch((err) => log.warn('[FireWatch] timer err: ' + (err as Error).message));
  }, 30 * 60_000);

  log.ok(`Ingestor running — next poll in ${POLL_INTERVAL_MIN}min`);
}

// ── Graceful shutdown ────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log.info(`\n${signal} received — shutting down gracefully...`);

  // Clear timers
  if (pollTimer) clearInterval(pollTimer);
  if (discoverTimer) clearInterval(discoverTimer);
  if (lightningTimer) clearInterval(lightningTimer);
  if (synopticTimer) clearInterval(synopticTimer);
  if (firmsTimer) clearInterval(firmsTimer);
  if (icaTimer) clearInterval(icaTimer);
  if (convGridTimer) clearInterval(convGridTimer);
  if (outcomesTimer) clearInterval(outcomesTimer);
  if (fireWatchTimer) clearInterval(fireWatchTimer);

  // Close database pool
  await closePool();
  log.ok('Database pool closed');

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Catch unhandled errors
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection:', String(reason));
});

// ── Go! ──────────────────────────────────────────────

start().catch((err) => {
  log.error('Fatal startup error:', (err as Error).message);
  process.exit(1);
});
