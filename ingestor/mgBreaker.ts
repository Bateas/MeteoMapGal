/**
 * Circuit breaker for ingestor → MeteoGalicia network failures.
 *
 * `fetchMeteoGalicia` fetches ~150-440 stations independently every cycle.
 * servizos.meteogalicia.gal periodically drops off DNS entirely
 * (NameResolutionError / ENOTFOUND) from the deploy host — unlike AEMET
 * (one call, rate-limited) or meteo2api lightning (one call, outage), this
 * failure mode hits EVERY station fetch in the cycle at once. `allSettledLimit`
 * isolates them so nothing crashes, but the resolver still gets hit 8-at-a-time
 * for the whole station list, every 5 minutes, for as long as the outage lasts:
 *
 *   17:05 MeteoGalicia: 0/187 readings   (187 failed DNS lookups)
 *   17:10 MeteoGalicia: 0/187 readings   (187 more)
 *   17:15 MeteoGalicia: 0/187 readings   (187 more)
 *   ...for as long as the outage lasts
 *
 * A single fully-failed cycle can be a transient blip (mirrors
 * lightningBreaker's consecutive-threshold, not aemetBreaker's open-on-first):
 * only after FAILURE_THRESHOLD consecutive cycles where EVERY attempted
 * station failed does this open, and the next cycles skip the station list
 * entirely until the cooldown elapses. A cycle with ANY successful station
 * clears it immediately — a real outage fails stations together, not one at
 * a time, so a mixed cycle is never the failure this exists for, and it is
 * never mistaken for the ordinary case of individual stations having no
 * fresh 10-minute entry yet (that resolves to `null`, not a rejection).
 *
 * The existing per-source heartbeat (`sourceHealth.ts` / `checkSourceHealth`)
 * still shows `MG 0` every cycle and escalates to a SILENT SOURCE alarm if
 * it stays there — this breaker only stops the network hammering, it does
 * not hide the outage.
 */

import { log } from './logger.js';

// meteogalicia.gal outages aren't quota-driven (no per-minute counter to
// wait out, unlike AEMET) — 15 min just keeps the probe cadence sane
// during a long outage without leaving the interior spine blind too long.
const COOLDOWN_MS = 15 * 60_000;

// 2 fully-failed 5-min cycles (10 min of real outage) before opening, so a
// one-off DNS hiccup that clears within the same cycle's retries never trips it.
const FAILURE_THRESHOLD = 2;

let breakerOpenUntil = 0;
let consecutiveFullFailures = 0;

/** True while we're inside the cooldown window. */
export function isOpen(): boolean {
  return Date.now() < breakerOpenUntil;
}

/** Minutes remaining until the breaker re-opens for traffic. */
export function minutesUntilReset(): number {
  return Math.max(0, Math.ceil((breakerOpenUntil - Date.now()) / 60_000));
}

/**
 * Throw if the breaker is open. Use at the top of `fetchMeteoGalicia`,
 * before firing any station fetch. Callers can catch `MgBreakerError` to
 * skip the whole cycle without logging an error.
 */
export function checkBreaker(label: string): void {
  if (isOpen()) {
    throw new MgBreakerError(`${label}: ${minutesUntilReset()}min cooldown`);
  }
}

/**
 * Report how a cycle's station fan-out went: `attempted` stations tried,
 * `failed` of them rejected (network/timeout — NOT "station had no fresh
 * entry yet", which resolves to `null` and is never a rejection). Only a
 * cycle where EVERYTHING attempted failed counts toward the threshold;
 * any success resets it immediately.
 */
export function reportCycleResult(attempted: number, failed: number): void {
  if (attempted === 0) return;
  if (failed < attempted) {
    reportSuccess();
    return;
  }

  consecutiveFullFailures += 1;
  if (consecutiveFullFailures < FAILURE_THRESHOLD) return;

  const wasOpen = isOpen();
  breakerOpenUntil = Date.now() + COOLDOWN_MS;
  if (!wasOpen) {
    log.warn(
      `[MeteoGalicia] ${consecutiveFullFailures} consecutive fully-failed cycles ` +
        `(${attempted} stations each) — breaker open ${COOLDOWN_MS / 60_000} min`,
    );
  }
}

/** Report a cycle with at least one successful station. Clears the breaker. */
export function reportSuccess(): void {
  if (breakerOpenUntil !== 0) {
    log.info('[MeteoGalicia] breaker cleared by a successful cycle');
  }
  consecutiveFullFailures = 0;
  breakerOpenUntil = 0;
}

/** Test-only: reset module state between cases. */
export function _resetMgBreaker(): void {
  breakerOpenUntil = 0;
  consecutiveFullFailures = 0;
}

export class MgBreakerError extends Error {
  name = 'MgBreakerError' as const;
}
