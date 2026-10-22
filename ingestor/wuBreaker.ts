/**
 * Pause for Weather Underground when its shared public key is refused.
 *
 * The key we poll with is the one embedded in wunderground.com, shared by every
 * visitor and scraper. When it is throttled the answer is `401 API key is
 * throttled` to EVERY request, from any address. Before this module the poll
 * kept sending all ~130 stations every 5 minutes (~37,000 requests a day) into a
 * wall that was answering none of them, and logged the same WARN 12 times an hour.
 *
 * Contract:
 *   - a cycle where EVERY request is refused (401/403/429) opens the pause;
 *   - while it is open the poll and the discovery stay silent (no requests);
 *   - when the pause ends, ONE station is asked (the probe). Any answer that is
 *     not a refusal — even a 204 for a station off the air — proves the key
 *     works again and resumes the full poll; a refusal doubles the pause;
 *   - a partly-refused cycle is the ordinary case (a few timeouts) and never
 *     opens it: only a cycle where nothing got through does.
 *
 * Pause: 60 min, doubling to a cap of 4 h. State is module-level.
 */

const BASE_COOLDOWN_MS = 60 * 60_000;
const MAX_COOLDOWN_MS = 4 * 60 * 60_000;

let openUntil = 0;
let strikes = 0;

export type WuPlan = 'all' | 'probe' | 'skip';

/** What to do this cycle: ask every station, ask just one, or stay silent. */
export function planCycle(now: number = Date.now()): WuPlan {
  if (strikes === 0) return 'all';
  return now < openUntil ? 'skip' : 'probe';
}

/** True for the answers that are about the KEY and not about one station. */
export function isRefusal(reason: string): boolean {
  return /^HTTP (401|403|429)$/.test(reason);
}

/** Verdict of one batch: nothing got through, or at least one request was answered. */
export function judgeBatch(attempted: number, refused: number): 'refused' | 'answered' | 'none' {
  if (attempted <= 0) return 'none';
  return refused >= attempted ? 'refused' : 'answered';
}

export function cooldownMinutes(): number {
  return Math.round(Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * 2 ** Math.max(0, strikes - 1)) / 60_000);
}

/**
 * The key was refused. Opens (or lengthens) the pause. Returns true when this
 * call is the one that changed the state — callers log only then. Calls inside
 * an open pause are ignored, so a discovery that fires 12 requests at once
 * does not stack 12 strikes.
 */
export function reportRefused(now: number = Date.now()): boolean {
  if (strikes > 0 && now < openUntil) return false;
  strikes += 1;
  openUntil = now + Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * 2 ** (strikes - 1));
  return true;
}

/** The key answered. Closes the pause; true when it had been open. */
export function reportAnswered(): boolean {
  const wasOpen = strikes > 0;
  strikes = 0;
  openUntil = 0;
  return wasOpen;
}

/** Test-only: reset module state between cases. */
export function _resetWuBreaker(): void {
  strikes = 0;
  openUntil = 0;
}
