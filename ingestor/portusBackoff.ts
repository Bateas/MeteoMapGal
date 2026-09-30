/**
 * A PORTUS station that answers every request with an error is asked once an hour instead of
 * every cycle. Case: Rande (1251) has answered HTTP 500 since 20-sep. Asked every 5 min plus
 * the retry, that was about 570 failed requests a day to a provider that once warned us about
 * a block over bad requests, for data that reaches us through the Xunta anyway. A station that
 * answers again goes back to every cycle at once.
 *
 * Only a real failure counts (an HTTP error or no answer). A 200 with an empty or old payload
 * is a working station that has not published yet, and keeps being asked every cycle.
 */

/** Consecutive failed cycles before a station is asked once an hour. */
export const PORTUS_BACKOFF_AFTER_FAILS = 3;
/** While failing, one request per hour to notice when it comes back. */
export const PORTUS_BACKOFF_PROBE_MS = 60 * 60_000;

export interface PortusBackoff {
  /** Consecutive cycles with a failed request */
  fails: number;
  /** When the current run of failures started (epoch ms) */
  since: number;
  /** Last time it was asked (epoch ms) */
  lastTry: number;
}

/** Ask this station in this cycle? */
export function shouldAskPortus(state: PortusBackoff | undefined, nowMs: number): boolean {
  if (!isBackingOff(state)) return true;
  return nowMs - state!.lastTry >= PORTUS_BACKOFF_PROBE_MS;
}

/** A station known to be failing: skip the immediate retry, the hourly probe is enough. */
export function isBackingOff(state: PortusBackoff | undefined): boolean {
  return (state?.fails ?? 0) >= PORTUS_BACKOFF_AFTER_FAILS;
}

/** State after one request. undefined = healthy (nothing to remember). */
export function nextPortusBackoff(
  state: PortusBackoff | undefined,
  failed: boolean,
  nowMs: number,
): PortusBackoff | undefined {
  if (!failed) return undefined;
  return { fails: (state?.fails ?? 0) + 1, since: state?.since ?? nowMs, lastTry: nowMs };
}
