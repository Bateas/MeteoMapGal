/**
 * MeteoMapGal Weather Ingestor
 *
 * Standalone service that polls 5 weather sources every 5 minutes
 * and persists readings into TimescaleDB.
 *
 * Usage:
 *   npm start          # production
 *   npm run dev        # watch mode (auto-restart on file changes)
 */

import 'dotenv/config';
import { initPool, pingDb, batchUpsert, closePool } from './db.js';
import { discoverAllStations } from './discover.js';
import { fetchAllObservations } from './fetchers.js';
import { log } from './logger.js';
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
let isShuttingDown = false;
let cycleCount = 0;

// ── Core cycle ───────────────────────────────────────

async function runCycle(): Promise<void> {
  if (isShuttingDown) return;
  cycleCount++;

  const cycleStart = Date.now();
  log.info(`── Cycle ${cycleCount} ──────────────────────────────`);

  if (stations.size === 0) {
    log.warn('No stations discovered — skipping fetch cycle');
    return;
  }

  try {
    // 1. Fetch observations from all 5 sources
    const readings = await fetchAllObservations(stations);

    if (readings.length === 0) {
      log.warn('No readings fetched this cycle');
      return;
    }

    // 2. Persist to TimescaleDB
    const { inserted, skipped } = await batchUpsert(readings);

    const elapsed = ((Date.now() - cycleStart) / 1000).toFixed(1);
    log.ok(
      `Cycle ${cycleCount} complete: ${readings.length} readings → ${inserted} new, ${skipped} dedup (${elapsed}s)`
    );
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

  // 2. Initial station discovery
  stations = await discoverAllStations();
  if (stations.size === 0) {
    log.warn('No stations found — will retry on next discovery cycle');
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
