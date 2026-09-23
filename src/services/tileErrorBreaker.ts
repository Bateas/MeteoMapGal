/**
 * Stops a tile layer from asking again and again for tiles that keep failing.
 *
 * A raster layer has no notion of "the server is down". When its tiles come
 * back 5xx or 429, MapLibre simply asks for them again on the next repaint,
 * and every pan or zoom adds a fresh set on top. One session with the SWAN
 * layer open did 1,071 failed requests in five minutes that way, against a
 * source that already asked us to go easy on it.
 *
 * The breaker counts failures in a short window. Past a threshold it trips:
 * the layer is taken down and nothing is asked until a backoff runs out, and
 * each trip in a row doubles it, up to a cap. The next health check that
 * succeeds after the backoff closes it again. The same idea as the tide
 * client: once a source has shown it is failing, it is not asked again until
 * later.
 */

export interface TileBreakerOptions {
  /** Failures inside the window that trip it. */
  threshold?: number;
  windowMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  clock?: () => number;
}

export interface TileBreaker {
  /** Record one failed tile. Returns true if this failure tripped it. */
  recordError(): boolean;
  /** Whether a health check may run now (false while backing off). */
  canTry(): boolean;
  /**
   * A tile loaded: close, and forget the doubling. The recent failures are
   * kept on purpose: when half a burst loads and the other half is refused
   * (what the SWAN layer was doing), clearing them on every success would
   * mean it never trips.
   */
  recordSuccess(): void;
  /** When the current backoff ends, as a timestamp (0 if none). */
  backoffUntil(): number;
}

export function createTileBreaker(opts: TileBreakerOptions = {}): TileBreaker {
  const threshold = opts.threshold ?? 6;
  const windowMs = opts.windowMs ?? 30_000;
  const baseBackoffMs = opts.baseBackoffMs ?? 5 * 60_000;
  const maxBackoffMs = opts.maxBackoffMs ?? 30 * 60_000;
  const clock = opts.clock ?? Date.now;

  let failures: number[] = [];
  let until = 0;
  let nextBackoff = baseBackoffMs;

  return {
    recordError() {
      const now = clock();
      if (now < until) return false; // already tripped: nothing more to count
      failures = failures.filter((t) => now - t < windowMs);
      failures.push(now);
      if (failures.length < threshold) return false;
      until = now + nextBackoff;
      nextBackoff = Math.min(nextBackoff * 2, maxBackoffMs);
      failures = [];
      return true;
    },
    canTry() {
      return clock() >= until;
    },
    recordSuccess() {
      until = 0;
      nextBackoff = baseBackoffMs;
    },
    backoffUntil() {
      return until;
    },
  };
}
