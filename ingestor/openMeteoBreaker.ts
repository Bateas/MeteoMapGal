/**
 * Shared circuit breaker for ALL ingestor → Open-Meteo traffic.
 *
 * Open-Meteo's free tier counts each coordinate as 1 API call against the
 * burst quota (~600/min, IP-level). The ingestor has THREE callers
 * (convection grid, forecast, synoptic) plus the marine endpoint, and
 * they all live in the same LXC behind the same external IP.
 *
 * Without coordination, each fetcher tripped 429 independently and kept
 * hammering the dead upstream:
 *
 *   15:30 forecast 429 (eat 30s of backoff)
 *   15:31 forecast 429 again (sector 2)
 *   15:35 ConvGrid 429 ×3 batches (eat 6s, abort cycle)
 *   15:43 forecast 429 again
 *   15:45 synoptic 429 ×2 (eat 6s)
 *   15:48 ConvGrid 429 ×3 (next 30-min cycle, same wall)
 *
 * With this shared module, the FIRST 429 from any caller opens the breaker
 * for 60 min; the rest skip silently. The 60-min window matches Open-Meteo's
 * rolling-quota recovery — long enough to not chase the limit, short enough
 * that the next forecast/grid cycle picks up clean as soon as the IP is
 * unbanned.
 *
 * This is module-level state, intentionally — there's exactly one Open-Meteo
 * IP shared by all fetchers, so one shared timer fits the physical reality.
 */

import { log } from './logger.js';

const COOLDOWN_MS = 60 * 60_000;

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
 * to call Open-Meteo. Callers can catch `OpenMeteoBreakerError` to surface
 * "service paused" behaviour without logging an error.
 */
export function checkBreaker(label: string): void {
  if (isOpen()) {
    throw new OpenMeteoBreakerError(`${label}: ${minutesUntilReset()}min cooldown`);
  }
}

/**
 * Report a 429 from any Open-Meteo endpoint. Opens the breaker for
 * COOLDOWN_MS. Idempotent — additional calls just refresh the deadline.
 */
export function reportRateLimit(label: string): void {
  breakerOpenUntil = Date.now() + COOLDOWN_MS;
  log.warn(`[OpenMeteo] rate-limited via ${label} — breaker open ${COOLDOWN_MS / 60_000} min`);
}

/**
 * Report a successful Open-Meteo call. Clears the breaker so the next
 * cycle can run immediately instead of waiting out the full cooldown.
 */
export function reportSuccess(): void {
  if (breakerOpenUntil !== 0) {
    log.info('[OpenMeteo] breaker cleared by successful response');
  }
  breakerOpenUntil = 0;
}

/** Test-only: reset module state between cases. */
export function _resetOpenMeteoBreaker(): void {
  breakerOpenUntil = 0;
}

export class OpenMeteoBreakerError extends Error {
  name = 'OpenMeteoBreakerError' as const;
}
