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
