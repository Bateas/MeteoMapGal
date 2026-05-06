/**
 * Global rate limiter for Open-Meteo API requests.
 *
 * Open-Meteo free tier has burst limits (~60 req/min).
 * This queue ensures ALL Open-Meteo calls across the app are serialized:
 *   - Strictly sequential: one request at a time (no concurrency)
 *   - Minimum 1000ms between request starts (~60/min, matching free tier)
 *   - Auto-retry on 429 with exponential backoff
 *
 * Previous implementation had a race condition where `await` inside the
 * while loop allowed `.finally()` callbacks to re-enter `processQueue()`
 * concurrently, breaking the MAX_CONCURRENT limit. This rewrite uses a
 * fully sequential drain loop that is immune to re-entrance.
 *
 * Usage: replace `fetch(url)` with `openMeteoFetch(url)` for any Open-Meteo call.
 * Works with both api.open-meteo.com and archive-api.open-meteo.com.
 */

const MIN_INTERVAL_MS = 1500;  // 1.5s between requests (~40/min, conservative to avoid 429s)
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 8000; // 8s, 16s exponential backoff (longer cooldown after 429)

// Circuit breaker — when the IP gets rate-limited, retrying every queue item
// just produces more 429s and burns minutes per request waiting on backoffs
// for nothing. After N consecutive 429s, freeze ALL Open-Meteo calls for
// COOLDOWN_MS and resolve them as 429 immediately (no retries, no waits).
// Cleared on the first successful response.
const RATE_LIMIT_TRIP_THRESHOLD = 3;          // 3 consecutive 429s trips the breaker
const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;    // 5 min freeze
let consecutive429s = 0;
let rateLimitedUntil = 0;

interface QueueItem {
  url: string;
  options?: RequestInit;
  timeoutMs?: number;
  resolve: (res: Response) => void;
  reject: (err: Error) => void;
}

let lastRequestTime = 0;
const pending: QueueItem[] = [];
let draining = false;

/**
 * Sequential drain loop — processes one request at a time.
 *
 * Immune to re-entrance: `draining` flag stays true for the entire
 * duration of the loop, including across all `await` points. New items
 * pushed to `pending` during processing are picked up by the while loop.
 * Items arriving after the loop exits are handled by the `finally` guard.
 */
async function drain(): Promise<void> {
  if (draining) return;
  draining = true;

  try {
    while (pending.length > 0) {
      const item = pending.shift()!;

      // Enforce minimum interval between request starts
      const elapsed = Date.now() - lastRequestTime;
      if (elapsed < MIN_INTERVAL_MS) {
        await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
      }

      lastRequestTime = Date.now();

      try {
        // Create timeout signal at fetch time (not at queue entry time)
        // to avoid premature timeouts from queue wait time
        const opts = { ...item.options };
        if (item.timeoutMs && !opts.signal) {
          opts.signal = AbortSignal.timeout(item.timeoutMs);
        }
        const res = await fetchWithRetry(item.url, opts);
        item.resolve(res);
      } catch (err) {
        item.reject(err as Error);
      }
    }
  } finally {
    draining = false;
    // Guard: if new items arrived between while-loop exit and here, re-drain
    if (pending.length > 0) {
      drain();
    }
  }
}

async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  attempt = 0
): Promise<Response> {
  // Circuit breaker — short-circuit the request if cooldown is active
  if (Date.now() < rateLimitedUntil) {
    return new Response(null, { status: 429, statusText: 'Cooldown' });
  }

  const res = await fetch(url, options);

  if (res.status === 429) {
    consecutive429s++;
    if (consecutive429s >= RATE_LIMIT_TRIP_THRESHOLD) {
      rateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
      console.warn(
        `[OpenMeteo] ${consecutive429s} consecutive 429s — circuit breaker tripped, ` +
        `pausing all calls for ${RATE_LIMIT_COOLDOWN_MS / 60_000}min`
      );
      return res;
    }
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_BASE_MS * Math.pow(2, attempt);
      console.warn(
        `[OpenMeteo] 429 rate limited, retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`
      );
      await new Promise((r) => setTimeout(r, delay));
      return fetchWithRetry(url, options, attempt + 1);
    }
  } else if (res.ok) {
    // Successful response clears the breaker state
    consecutive429s = 0;
    rateLimitedUntil = 0;
  }

  return res;
}

/**
 * Rate-limited fetch for Open-Meteo API.
 * Drop-in replacement for `fetch()` — same signature and return type.
 *
 * All requests are serialized: one at a time, 1000ms apart minimum.
 *
 * IMPORTANT: Do NOT pass AbortSignal.timeout() in options — the timeout
 * starts counting at creation time, not at fetch time. If this request
 * waits in the queue, the signal may expire before the fetch even begins.
 * Instead, pass timeoutMs as a third parameter — the signal is created
 * at fetch time, after queue wait.
 */
export function openMeteoFetch(
  url: string,
  options?: RequestInit,
  timeoutMs?: number
): Promise<Response> {
  // Strip any pre-created timeout signal from options (queue-safe)
  const cleanOptions = options ? { ...options } : undefined;
  if (cleanOptions?.signal && !timeoutMs) {
    // Caller passed signal directly — extract timeout if possible, else keep as-is
    // For backwards compat, keep the signal but warn it may expire early
  }

  return new Promise<Response>((resolve, reject) => {
    pending.push({ url, options: cleanOptions, timeoutMs, resolve, reject });
    drain();
  });
}

/** Current queue depth (for debugging) */
export function openMeteoQueueDepth(): number {
  return pending.length;
}
