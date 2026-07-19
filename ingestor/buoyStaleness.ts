/**
 * Per-station buoy staleness — pure logic.
 *
 * The ingestor's global "no buoy readings at all this cycle" counter only
 * trips when EVERY station is silent. Two stations once went dark for 40
 * days while the rest kept reporting, so that counter reset on every cycle
 * and the blackout never surfaced. This module answers the narrower
 * question the global counter can't: "which station that used to report
 * has stopped?".
 *
 * Kept in its own module (not index.ts) because index.ts starts the service
 * on import — it can't be pulled into a test.
 */

/** stationId -> epoch ms of the last cycle that returned data for it. */
export type LastSeenMap = ReadonlyMap<number, number>;

export interface StaleBuoy {
  stationId: number;
  /** How long the station has been silent, in ms. */
  silentMs: number;
}

export interface FindStaleBuoysInput {
  now: number;
  lastSeen: LastSeenMap;
  /** stationId -> epoch ms of the last warning emitted for it. */
  lastWarnedAt: LastSeenMap;
  staleAfterMs: number;
  /** Minimum gap between two warnings about the same station. */
  reWarnAfterMs: number;
}

/**
 * Stations silent for longer than `staleAfterMs` that are also due a
 * warning (never warned, or last warned over `reWarnAfterMs` ago).
 *
 * Only stations present in `lastSeen` are considered: a station we have
 * never had data for is "unknown", not "stale", and alarming on it would
 * fire for every decommissioned buoy in the roster.
 *
 * Sorted longest-silent first so the log leads with the worst offender.
 */
export function findStaleBuoys(input: FindStaleBuoysInput): StaleBuoy[] {
  const { now, lastSeen, lastWarnedAt, staleAfterMs, reWarnAfterMs } = input;
  const stale: StaleBuoy[] = [];

  for (const [stationId, seenAt] of lastSeen) {
    const silentMs = now - seenAt;
    if (silentMs < staleAfterMs) continue;

    const warnedAt = lastWarnedAt.get(stationId);
    if (warnedAt !== undefined && now - warnedAt < reWarnAfterMs) continue;

    stale.push({ stationId, silentMs });
  }

  return stale.sort((a, b) => b.silentMs - a.silentMs);
}

/** Compact duration for log lines: "13h", "2d". */
export function formatSilence(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
