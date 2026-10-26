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

/**
 * What to say about the key's own expiry, once a day. Since 15-oct-2026 AEMET withdraws the keys issued without an
 * expiry date (opendata.aemet.es/centrodedescargas/novedades, notices of 6, 15 and 20 Oct): they answer 401 more and
 * more often until they stop. New keys last 3 months, so the renewal has to be seen coming.
 */
export function aemetKeyNotice(expMs: number | null, nowMs: number): { level: 'info' | 'warn' | 'error'; text: string } {
  if (expMs == null) {
    return { level: 'warn', text: 'la clave de AEMET no tiene fecha de caducidad: AEMET retira esas claves desde el 15-oct-2026 (401 cada vez mas a menudo). Pedir una nueva en opendata.aemet.es y ponerla en AEMET_API_KEY' };
  }
  const days = Math.floor((expMs - nowMs) / 86_400_000);
  const when = new Date(expMs).toISOString().slice(0, 10);
  if (expMs <= nowMs) return { level: 'error', text: `la clave de AEMET caduco el ${when}. Pedir una nueva y ponerla en AEMET_API_KEY` };
  if (days < 14) return { level: 'warn', text: `la clave de AEMET caduca el ${when} (en ${days} dias). Pedir la nueva antes` };
  return { level: 'info', text: `la clave de AEMET caduca el ${when} (en ${days} dias)` };
}

/** 401/403, as HTTP status or as `estado` inside the answer: AEMET refuses the key itself. No
 *  wait fixes it, so it is told apart from the quota (25-26 oct: 28 h of `estado 401`). */
export function isAemetKeyRefusal(httpStatus: number, estado: unknown): boolean {
  const e = Number(estado);
  return httpStatus === 401 || httpStatus === 403 || e === 401 || e === 403;
}
