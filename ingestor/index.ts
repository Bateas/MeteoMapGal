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
import { initPool, pingDb, batchUpsert, batchUpsertBuoys, batchUpsertStations, closePool } from './db.js';
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

    if (buoyReadings.length > 0) {
      const { inserted: bInserted, skipped: bSkipped } = await batchUpsertBuoys(buoyReadings);
      log.info(`Buoys: ${buoyReadings.length} readings → ${bInserted} new, ${bSkipped} dedup`);
      consecutiveEmptyBuoyCycles = 0;  // success — clear the staleness counter
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
  // Open-Meteo refreshes hourly so polling more often is wasted bandwidth.
  // 60s stagger from lightning timer to spread Open-Meteo load over time.
  setTimeout(() => {
    runSynopticCycle().catch((err) => log.error('[Synoptic] init err:', (err as Error).message));
  }, 90_000);
  synopticTimer = setInterval(() => {
    runSynopticCycle().catch((err) => log.error('[Synoptic] timer err:', (err as Error).message));
  }, 60 * 60_000);

  // FIRMS fetcher — wildfire hotspots persistence.
  // 30min cadence matches FIRMS NRT latency and the proxy's cache TTL.
  // 150s stagger so it lands after lightning + synoptic to spread network load.
  setTimeout(() => {
    runFirmsCycle().catch((err) => log.error('[FIRMS Fetcher] init err:', (err as Error).message));
  }, 150_000);
  firmsTimer = setInterval(() => {
    runFirmsCycle().catch((err) => log.error('[FIRMS Fetcher] timer err:', (err as Error).message));
  }, 30 * 60_000);

  // ICA fetcher — Xunta air-quality persistence.
  // 30min cadence matches Xunta's hourly publication with margin.
  // 210s stagger so it lands after FIRMS to spread Xunta API load.
  setTimeout(() => {
    runIcaCycle().catch((err) => log.error('[ICA Fetcher] init err:', (err as Error).message));
  }, 210_000);
  icaTimer = setInterval(() => {
    runIcaCycle().catch((err) => log.error('[ICA Fetcher] timer err:', (err as Error).message));
  }, 30 * 60_000);

  // Convection grid fetcher — spatial CAPE/LI grid persistence.
  // Replaces frontend-direct Open-Meteo multi-point queries (which hit free-tier
  // burst limit). 30min cadence matches forecast model refresh; ~90 batched
  // calls per cycle at 10km / ~270 at 5km — well under quota from a single IP.
  // 270s stagger so it lands after ICA to spread Open-Meteo load.
  setTimeout(() => {
    runConvectionGridCycle().catch((err) => log.error('[ConvGrid] init err:', (err as Error).message));
  }, 270_000);
  convGridTimer = setInterval(() => {
    runConvectionGridCycle().catch((err) => log.error('[ConvGrid] timer err:', (err as Error).message));
  }, 30 * 60_000);

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
