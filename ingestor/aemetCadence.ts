/**
 * How often the server asks AEMET for its observation file.
 *
 * The file covers all of Spain (3.2 MB) and its readings are HOURLY, so a
 * 5-min poll repeated the same answer eleven times out of twelve. A good
 * answer is kept for 15 min (new hours still land within a quarter of an
 * hour of publication); a failed or empty one does not count, so the next
 * cycle tries again.
 */
export const AEMET_MIN_GAP_MS = 15 * 60_000;

export function aemetPollDue(lastGoodAt: number | null, now: number, gapMs = AEMET_MIN_GAP_MS): boolean {
  return lastGoodAt == null || now - lastGoodAt >= gapMs;
}

/** AEMET can answer HTTP 200 with `"estado": 429` inside: that is a quota
 *  answer too and must open the breaker, not just log «unexpected status». */
export function isAemetQuotaAnswer(httpStatus: number, estado: unknown): boolean {
  return httpStatus === 429 || estado === 429 || estado === '429';
}
