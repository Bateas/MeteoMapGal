/**
 * Staleness of anything that reports on a schedule — pure logic.
 *
 * The ingestor's global "no readings at all this cycle" counter only trips
 * when EVERYTHING is silent. Two buoys once went dark for 40 days while the
 * rest kept reporting, so that counter reset on every cycle and the blackout
 * never surfaced. This module answers the narrower question the global
 * counter cannot: "which of the things that used to report has stopped?".
 *
 * The same shape of blindness repeats one level up. On 18 August the
 * MeteoGalicia fetcher stopped for over two hours — 150 stations, the whole
 * spine of the interior — and nothing said so, because the other five
 * sources kept the global counter healthy. Which is why the key is generic
 * now: a buoy is identified by a number and a source by a name, and the
 * question being asked of them is word for word the same one.
 *
 * Kept in its own module (not index.ts) because index.ts starts the service
 * on import — it can't be pulled into a test.
 */

/** Whatever identifies the reporter: a buoy's number, a source's name. */
export type ReporterId = string | number;

/** reporter -> epoch ms of the last cycle that returned data for it. */
export type LastSeenMap<K extends ReporterId = number> = ReadonlyMap<K, number>;

export interface StaleReporter<K extends ReporterId = number> {
  stationId: K;
  /** How long it has been silent, in ms. */
  silentMs: number;
}

/** Kept as the old names so the buoy call site reads the same. */
export type StaleBuoy = StaleReporter<number>;
export type FindStaleBuoysInput = FindStaleInput<number>;

export interface FindStaleInput<K extends ReporterId = number> {
  now: number;
  lastSeen: LastSeenMap<K>;
  /** reporter -> epoch ms of the last warning emitted for it. */
  lastWarnedAt: LastSeenMap<K>;
  /**
   * How long silence has to last before it counts. For a source this is its
   * OWN cadence, not a shared number: an hourly network quiet for 40 minutes
   * is punctual, a five-minute one quiet for 40 minutes has missed eight
   * cycles. Same reasoning as `staleGateMinFor` on the scoring side.
   */
  staleAfterMs: number;
  /** Minimum gap between two warnings about the same reporter. */
  reWarnAfterMs: number;
}

/**
 * Stations silent for longer than `staleAfterMs` that are also due a
 * warning (never warned, or last warned over `reWarnAfterMs` ago).
 *
 * Only stations present in `lastSeen` are considered: a station we have
 * never had data for is "unknown", not "stale", and alarming on it would
 * fire for every decommissioned buoy in the roster — and, for a source, would
 * alarm about one that is simply not configured.
 *
 * Sorted longest-silent first so the log leads with the worst offender.
 */
export function findStaleReporters<K extends ReporterId = number>(
  input: FindStaleInput<K>,
): StaleReporter<K>[] {
  const { now, lastSeen, lastWarnedAt, staleAfterMs, reWarnAfterMs } = input;
  const stale: StaleReporter<K>[] = [];

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

/** The buoy call site, unchanged. */
export const findStaleBuoys = findStaleReporters<number>;
