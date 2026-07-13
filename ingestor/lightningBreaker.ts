/**
 * Circuit breaker for ingestor → meteo2api lightning traffic.
 *
 * `fetchRaios` polls meteo2api (`/raios/lenda`) every 5 min, 24/7. The
 * endpoint is a free Xunta public API with no rate limit, so unlike the
 * Open-Meteo / AEMET breakers there's no 429 to react to — the failure mode
 * is a sustained UPSTREAM OUTAGE (DNS, gateway 5xx, connection timeout).
 * During one of those, every cycle logged another WARN forever:
 *
 *   18:00 WARN [Lightning] fetch failed: timeout
 *   18:05 WARN [Lightning] fetch failed: timeout
 *   18:10 WARN [Lightning] fetch failed: timeout
 *   ...12 useless WARNs/hour for as long as the outage lasts
 *
 * Because a single transient blip is normal (and self-recovers next cycle),
 * this breaker opens on REPEATED failure rather than the first one: after
 * FAILURE_THRESHOLD consecutive failures it opens for COOLDOWN_MS, and
 * subsequent cycles skip the fetch silently. Once the cooldown elapses the
 * next cycle probes the endpoint again — a success clears the breaker, a
 * failure re-opens it (one WARN per re-open instead of one per cycle).
 *
 * Module-level state, intentionally — there's one ingestor process polling
 * one upstream, so one shared timer fits the physical reality. Mirrors
 * `aemetBreaker.ts` / `openMeteoBreaker.ts`.
 */

import { log } from './logger.js';

// Middle of the 15-30 min band. meteo2api outages aren't rate-quota driven
// (no per-minute counter to recover), so there's no "wait exactly N min"
// target — 20 min just keeps the probe cadence sane during a long outage.
const COOLDOWN_MS = 20 * 60_000;

// Consecutive failures before opening. At the 5-min poll cadence this means
// ~15 min of real failures before we back off, so a one-off blip never trips
// the breaker.
const FAILURE_THRESHOLD = 3;

let breakerOpenUntil = 0;
let consecutiveFailures = 0;

/** True while we're inside the cooldown window. */
export function isOpen(): boolean {
  return Date.now() < breakerOpenUntil;
}

/** Minutes remaining until the breaker re-opens for traffic. */
export function minutesUntilReset(): number {
  return Math.max(0, Math.ceil((breakerOpenUntil - Date.now()) / 60_000));
}

/**
 * Throw if the breaker is open. Use at the top of any function about to call
 * meteo2api. Callers can catch `LightningBreakerError` to surface a "paused"
 * path without logging an error.
 */
export function checkBreaker(label: string): void {
  if (isOpen()) {
    throw new LightningBreakerError(`${label}: ${minutesUntilReset()}min cooldown`);
  }
}

/**
 * Report a failed meteo2api call (non-OK response or thrown error). Opens the
 * breaker once FAILURE_THRESHOLD consecutive failures have accumulated. The
 * counter is NOT reset on open, so after the cooldown a single probe failure
 * re-opens immediately. Logs exactly once per closed→open transition.
 */
export function reportFailure(label: string): void {
  consecutiveFailures += 1;
  if (consecutiveFailures < FAILURE_THRESHOLD) return;

  const wasOpen = isOpen();
  breakerOpenUntil = Date.now() + COOLDOWN_MS;
  if (!wasOpen) {
    log.warn(
      `[Lightning] ${consecutiveFailures} consecutive failures via ${label} — breaker open ${COOLDOWN_MS / 60_000} min`,
    );
  }
}

/**
 * Report a successful meteo2api call. Resets the failure counter and clears
 * the breaker so the next cycle runs immediately.
 */
export function reportSuccess(): void {
  if (breakerOpenUntil !== 0) {
    log.info('[Lightning] breaker cleared by successful response');
  }
  consecutiveFailures = 0;
  breakerOpenUntil = 0;
}

/** Test-only: reset module state between cases. */
export function _resetLightningBreaker(): void {
  breakerOpenUntil = 0;
  consecutiveFailures = 0;
}

export class LightningBreakerError extends Error {
  name = 'LightningBreakerError' as const;
}
