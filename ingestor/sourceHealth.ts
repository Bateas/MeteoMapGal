/**
 * Per-SOURCE health — pure logic.
 *
 * On 18 August the MeteoGalicia fetcher stopped for over two hours. 150
 * stations, the whole spine of the interior, gone from every spot consensus,
 * and nothing anywhere said so. The cycle log looked healthy because the
 * other five sources kept writing, and the global "no readings this cycle"
 * counter never came close to tripping.
 *
 * The evidence, when we finally read the log, was an ABSENCE: every source
 * prints its own line when it finishes, so a fetcher that returns early —
 * breaker open, thrown and swallowed, hung — prints nothing at all. It does
 * not fail. It disappears. And a log with no errors in it looks exactly like
 * a log where everything ran.
 *
 * So the heartbeat below always names ALL six, including the ones that
 * brought nothing. `MG 0` is a sentence; a missing line is not.
 */

import { staleGateMinFor, sourceOf } from '../src/services/spotScoringEngine.js';
import { findStaleReporters, formatSilence, type LastSeenMap } from './buoyStaleness.js';

/** Every source the ingestor polls. Fixed roster on purpose: the whole point
 *  is to notice the one that is missing, which a list derived from what
 *  arrived can never do. */
export const POLLED_SOURCES = [
  'meteogalicia',
  'wunderground',
  'netatmo',
  'meteoclimatic',
  'aemet',
  'skyx',
] as const;

export type PolledSource = (typeof POLLED_SOURCES)[number];

/** Short labels, so a six-source line still fits on one row of a terminal. */
const SHORT: Record<PolledSource, string> = {
  meteogalicia: 'MG',
  wunderground: 'WU',
  netatmo: 'NT',
  meteoclimatic: 'MC',
  aemet: 'AEMET',
  skyx: 'SkyX',
};

/**
 * How many readings each source contributed. Sources that brought nothing are
 * present with a zero — that is the entire point.
 *
 * The network is derived from the station id, because a `NormalizedReading`
 * does not carry one: the prefix (`mg_`, `wu_`, `nt_`…) is the only place the
 * source survives normalisation. `sourceOf` owns that mapping.
 */
export function countBySource(
  readings: readonly { stationId: string }[],
): Map<PolledSource, number> {
  const counts = new Map<PolledSource, number>(POLLED_SOURCES.map((s) => [s, 0]));
  for (const r of readings) {
    const key = sourceOf(r.stationId) as PolledSource;
    if (counts.has(key)) counts.set(key, counts.get(key)! + 1);
  }
  return counts;
}

/** One line naming all six: `MG 154 · WU 79 · NT 87 · MC 32 · AEMET 23 · SkyX 0`. */
export function formatHeartbeat(counts: ReadonlyMap<PolledSource, number>): string {
  return POLLED_SOURCES.map((s) => `${SHORT[s]} ${counts.get(s) ?? 0}`).join(' · ');
}

export interface SilentSource {
  source: PolledSource;
  silentMs: number;
  /** Its own gate, so the log can say why this counts as silent. */
  gateMin: number;
}

export interface FindSilentSourcesInput {
  now: number;
  lastSeen: LastSeenMap<PolledSource>;
  lastWarnedAt: LastSeenMap<PolledSource>;
  reWarnAfterMs: number;
}

/**
 * Sources quiet for longer than THEIR OWN cadence allows.
 *
 * The threshold is per source and comes from `staleGateMinFor`, the same
 * function the scoring engine uses, so an hourly network is never called
 * stale for being hourly — the mistake that kept AEMET out of every spot
 * consensus until v2.136.0.
 *
 * A source we have never seen is not reported: it is unconfigured or has no
 * stations in range, and alarming on it would cry wolf on every cycle.
 */
export function findSilentSources(input: FindSilentSourcesInput): SilentSource[] {
  const { now, lastSeen, lastWarnedAt, reWarnAfterMs } = input;
  const out: SilentSource[] = [];

  for (const source of POLLED_SOURCES) {
    const seenAt = lastSeen.get(source);
    if (seenAt === undefined) continue;

    const gateMin = staleGateMinFor(source);
    const hits = findStaleReporters<PolledSource>({
      now,
      lastSeen: new Map([[source, seenAt]]),
      lastWarnedAt,
      staleAfterMs: gateMin * 60_000,
      reWarnAfterMs,
    });
    if (hits.length > 0) out.push({ source, silentMs: hits[0].silentMs, gateMin });
  }

  return out.sort((a, b) => b.silentMs - a.silentMs);
}

/** `MeteoGalicia silent 2h (publishes every 40min)`. */
export function describeSilence(s: SilentSource): string {
  return `${s.source} silent ${formatSilence(s.silentMs)} (expected within ${s.gateMin}min)`;
}

// ── The Netatmo sweep: the blind spot the six-source line cannot see ─────
//
// Netatmo is fetched two ways: the two sectors every cycle (~18 readings) and
// the rest of Galicia every half hour (~78 more). If the sweep dies — token
// refused, empty bodies, sweep points gone from discovery — the sector fetch
// keeps `NT 18` on the heartbeat and `lastSeen` fresh, so `findSilentSources`
// never fires. And `NT 18` is exactly what a HEALTHY cycle prints between
// sweeps. The only way to tell "18 because it is not sweep time" from "18
// because the sweep is dead" is to remember when the sweep last brought
// anything, which is what the fetcher records in a `SweepStatus`.

export interface SweepStatus {
  /** Epoch ms of the first cycle that ever ran the sweep; null before it.
   *  Needed because `attemptedAt` advances every half hour even when every
   *  sweep is empty, so measured from it a sweep dead since boot would never
   *  look silent for longer than one interval. */
  firstAttemptAt: number | null;
  /** Epoch ms of the last cycle that ran the sweep; null before the first. */
  attemptedAt: number | null;
  /** Epoch ms of the last sweep that brought at least one reading. */
  productiveAt: number | null;
  /** Readings the last sweep brought, beyond the sectors. */
  readings: number;
}

/** Sweeps in a row allowed to bring nothing before it counts as dead. One
 *  empty sweep is weather (a rate limit, a timeout); two in a row is not. */
export const DEAD_SWEEP_INTERVALS = 2.5;

export interface FindDeadSweepInput {
  now: number;
  status: SweepStatus;
  /** How often the sweep is meant to run. */
  intervalMs: number;
  /** Epoch ms of the last warning, or null if never warned. */
  lastWarnedAt: number | null;
  reWarnAfterMs: number;
}

/**
 * Silence measured from the last PRODUCTIVE sweep — or from the FIRST
 * attempt, if none has ever produced — longer than `DEAD_SWEEP_INTERVALS`
 * intervals. Null when there is nothing to say or the warning is not due.
 * A sweep never attempted is not judged: the fetcher may not have run yet.
 */
export function findDeadSweep(input: FindDeadSweepInput): { silentMs: number } | null {
  const { now, status, intervalMs, lastWarnedAt, reWarnAfterMs } = input;
  if (status.firstAttemptAt === null) return null;
  const since = status.productiveAt ?? status.firstAttemptAt;
  const silentMs = now - since;
  if (silentMs < intervalMs * DEAD_SWEEP_INTERVALS) return null;
  if (lastWarnedAt !== null && now - lastWarnedAt < reWarnAfterMs) return null;
  return { silentMs };
}

/** "12min", "1h35", "2d" — minutes matter here, the interval is half an hour. */
export function formatMinutes(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min}min`;
  if (min < 48 * 60) return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
  return `${Math.floor(min / (24 * 60))}d`;
}

/** `Netatmo Galicia sweep has brought nothing for 1h35 (it runs every 30min)`. */
export function describeDeadSweep(silentMs: number, intervalMs: number): string {
  return (
    `Netatmo Galicia sweep has brought nothing for ${formatMinutes(silentMs)} ` +
    `(it runs every ${formatMinutes(intervalMs)})`
  );
}

/**
 * What the per-cycle Netatmo line says about the sweep on a NON-sweep cycle,
 * so a reader can tell `NT 18` apart from a dead sweep without waiting for
 * the alarm: `last sweep 78 readings 12min ago`.
 */
export function describeSweep(status: SweepStatus, now: number): string {
  if (status.attemptedAt === null) return 'no sweep yet';
  const ago = formatMinutes(now - status.attemptedAt);
  if (status.readings > 0) return `last sweep ${status.readings} readings ${ago} ago`;
  const productive =
    status.productiveAt === null
      ? 'never productive'
      : `last productive ${formatMinutes(now - status.productiveAt)} ago`;
  return `last sweep brought nothing ${ago} ago, ${productive}`;
}
