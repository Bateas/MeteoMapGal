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
