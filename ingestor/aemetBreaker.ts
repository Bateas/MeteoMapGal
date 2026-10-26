/**
 * Shared circuit breaker for ALL ingestor → AEMET traffic.
 *
 * AEMET OpenData has a per-minute rate limit (publicly undocumented but
 * empirically ~25 calls/min). When we trip it, AEMET keeps returning 429
 * for an extended window — sometimes hours — even if we slow down. Each
 * 5-min polling cycle in `fetchAemet` then logs another WARN, producing
 * 12 useless WARNs/hour that drown the real signal.
 *
 * Without coordination:
 *   17:02:47 WARN AEMET rate-limited (429), skipping this cycle
 *   17:07:47 WARN AEMET rate-limited (429), skipping this cycle
 *   17:12:47 WARN AEMET rate-limited (429), skipping this cycle
 *   ...repeat 12× per hour, multiple hours
 *
 * With this breaker, the FIRST 429 (from either polling OR discovery)
 * opens the breaker for 30 min; subsequent calls skip silently. After
 * the cooldown the next cycle tries again. If AEMET is still down it
 * re-opens; if recovered the breaker auto-clears on success.
 *
 * Why 30 min (vs 60 for Open-Meteo): AEMET's rate counter is per-minute
 * not per-hour, so quota typically recovers within 5-15 min. 30 is a
 * conservative middle ground that avoids the cycle-by-cycle hammering
 * without leaving us blind for too long.
 */

import { log } from './logger.js';

const COOLDOWN_MS = 30 * 60_000;

let breakerOpenUntil = 0;

/** True while we're inside the cooldown window. */
export function isOpen(): boolean {
  return Date.now() < breakerOpenUntil;
}

/** Minutes remaining until the breaker re-opens for traffic. */
export function minutesUntilReset(): number {
  return Math.max(0, Math.ceil((breakerOpenUntil - Date.now()) / 60_000));
}

/**
 * Throw if the breaker is open. Use at the top of any function that's about
 * to call AEMET. Callers can catch `AemetBreakerError` to surface
 * "service paused" behaviour without logging an error.
 */
export function checkBreaker(label: string): void {
  if (isOpen()) {
    throw new AemetBreakerError(`${label}: ${minutesUntilReset()}min cooldown`);
  }
}

/**
 * Report a 429 from any AEMET endpoint. Opens the breaker for
 * COOLDOWN_MS. Idempotent — additional calls just refresh the deadline.
 */
export function reportRateLimit(label: string): void {
  const wasOpen = breakerOpenUntil > Date.now();
  breakerOpenUntil = Date.now() + COOLDOWN_MS;
  if (!wasOpen) {
    log.warn(`[AEMET] rate-limited via ${label} — breaker open ${COOLDOWN_MS / 60_000} min`);
  }
}

const KEY_REFUSED_COOLDOWN_MS = 60 * 60_000;
let keyRefusedLoggedAt = 0;

/**
 * Report a 401/403: AEMET refuses the key itself, which no wait fixes. From 25-oct 16:00 UTC the
 * poll got `estado 401` for 28 h and logged a WARN every 5 min that nobody read. Now: pause 60 min
 * and one ERROR per 6 h that says what to do.
 */
export function reportKeyRefused(label: string, status: unknown): void {
  breakerOpenUntil = Date.now() + KEY_REFUSED_COOLDOWN_MS;
  if (Date.now() - keyRefusedLoggedAt >= 6 * 60 * 60_000) {
    keyRefusedLoggedAt = Date.now();
    log.error(
      `[AEMET] la clave es rechazada (${status}) via ${label}: pausa ${KEY_REFUSED_COOLDOWN_MS / 60_000} min. ` +
      'Comprobar AEMET_API_KEY en ingestor/.env y que este proceso se arranco despues del ultimo cambio.',
    );
  }
}

/**
 * Report a successful AEMET call. Clears the breaker so the next
 * cycle can run immediately instead of waiting out the full cooldown.
 */
export function reportSuccess(): void {
  if (breakerOpenUntil !== 0) {
    log.info('[AEMET] breaker cleared by successful response');
  }
  breakerOpenUntil = 0;
}

/** Test-only: reset module state between cases. */
export function _resetAemetBreaker(): void {
  breakerOpenUntil = 0;
  keyRefusedLoggedAt = 0;
}

export class AemetBreakerError extends Error {
  name = 'AemetBreakerError' as const;
}
