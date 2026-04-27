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
let isShuttingDown = false;
let cycleCount = 0;

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
    }

    // 4. Run spot analyzer — scoring + transitions + thermal forecast
    await runAnalysis().catch(err =>
      log.warn('Analyzer failed:', (err as Error).message));

    // 5. Webcam vision analysis (every 3 cycles = ~15min, if enabled)
    // Fire-and-forget — Ollama CPU inference takes 6-7min for 12 cameras.
    // MUST NOT block the polling loop (caused 2h freeze in S121).
    runWebcamAnalysis(cycleCount).catch(err =>
      log.warn('Webcam analysis failed:', (err as Error).message));

    // 6. Check if daily summary should be sent (9:00 AM, once per day)
    await checkAndSendDailySummary().catch(err =>
      log.warn('Daily summary check failed:', (err as Error).message));

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

  // Lightning fetcher (S125 Phase 1a) — independent 5min poll.
  // Decoupled from the main weather cycle so a slow station fetch never delays
  // strike persistence (real-time forensics matter for the lightning data).
  // First run after 30s stagger so it doesn't pile on top of the initial cycle.
  setTimeout(() => {
    runLightningCycle().catch((err) => log.error('[Lightning] init err:', (err as Error).message));
  }, 30_000);
  lightningTimer = setInterval(() => {
    runLightningCycle().catch((err) => log.error('[Lightning] timer err:', (err as Error).message));
  }, 5 * 60_000);

  // Synoptic fetcher (S125 Phase 1b TIER 1) — upper-air winds + convection.
  // Open-Meteo refreshes hourly so polling more often is wasted bandwidth.
  // 60s stagger from lightning timer to spread Open-Meteo load over time.
  setTimeout(() => {
    runSynopticCycle().catch((err) => log.error('[Synoptic] init err:', (err as Error).message));
  }, 90_000);
  synopticTimer = setInterval(() => {
    runSynopticCycle().catch((err) => log.error('[Synoptic] timer err:', (err as Error).message));
  }, 60 * 60_000);

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
