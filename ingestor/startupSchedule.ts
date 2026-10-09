/**
 * When a periodic job runs for the first time after a start: when it would have run anyway.
 *
 * Every start used to run the Open-Meteo jobs straight away. On 29-sep seven deploys asked for
 * the 600-point convection grid seven times, the daily quota ran out in the evening and the
 * storm predictor had no CAPE until 02:00. With the time of the last run read from the
 * database, the first run waits for its turn; with nothing stored it goes after `minDelayMs`,
 * as before. Pure, so the arithmetic is tested without a clock or a database.
 */
export function firstRunDelayMs(lastRunMs: number | null, intervalMs: number, minDelayMs: number, nowMs: number): number {
  if (lastRunMs == null || !Number.isFinite(lastRunMs)) return minDelayMs;
  return Math.max(minDelayMs, lastRunMs + intervalMs - nowMs);
}

/**
 * Milliseconds to the next fixed slot of the clock: `offsetMs` past each multiple of `slotMs`.
 * A job that only ever runs on its slots cannot run twice in less than `slotMs`, whatever
 * restarts it: a deploy or a crash loop waits for the next slot instead of asking again at once.
 * Exactly on a slot counts as past it (the next one is a whole slot away). Pure.
 */
export function msToNextSlot(nowMs: number, slotMs: number, offsetMs = 0): number {
  const into = (((nowMs - offsetMs) % slotMs) + slotMs) % slotMs;
  return slotMs - into;
}

/**
 * After a run: the delay to the first slot at least half a slot away. A timer that fires a
 * moment before its slot (or a run that finishes right on the next boundary) must not run again
 * a moment later.
 */
export function msToSlotAfterRun(nowMs: number, slotMs: number, offsetMs = 0): number {
  return msToNextSlot(nowMs + slotMs / 2, slotMs, offsetMs) + slotMs / 2;
}
