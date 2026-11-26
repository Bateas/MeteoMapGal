/**
 * Whether a polled feed is up to date, as the API tells the map (F-01 of the 26-nov-2026 audit).
 * Pure: the API reads `feed_status` (written by the ingestor, another process) and hands the row
 * here. Three answers, on purpose:
 *   - fresh true:  the last good answer is recent;
 *   - fresh false: there is a row and the last good answer is old, or there never was one: the
 *     map must say «sin dato», because an empty list would read as calm;
 *   - fresh null:  no row, no table or no grant: nobody can say, and the map behaves as before.
 */

/** Three missed polls of 5 minutes. */
export const FEED_STALE_MS = 15 * 60_000;

export interface FeedFreshness {
  /** The last good answer of the provider (ISO), or null. */
  polledAt: string | null;
  fresh: boolean | null;
}

/** `row` undefined = nothing to read; `lastOkAt` null = a row without any good answer yet. */
export function feedFreshness(row: { lastOkAt: Date | null } | undefined, nowMs: number): FeedFreshness {
  if (!row) return { polledAt: null, fresh: null };
  if (!row.lastOkAt) return { polledAt: null, fresh: false };
  return { polledAt: row.lastOkAt.toISOString(), fresh: nowMs - row.lastOkAt.getTime() <= FEED_STALE_MS };
}
