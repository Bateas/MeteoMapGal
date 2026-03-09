/**
 * Global rate limiter for Open-Meteo API requests.
 *
 * Open-Meteo free tier allows ~60 requests/minute with burst limits.
 * This queue ensures ALL Open-Meteo calls across the app are coordinated:
 *   - Max 3 concurrent requests
 *   - Minimum 350ms between request starts (~170 req/min theoretical max)
 *   - Auto-retry on 429 with exponential backoff
 *
 * Usage: replace `fetch(url)` with `openMeteoFetch(url)` for any Open-Meteo call.
 */

const MAX_CONCURRENT = 3;
const MIN_INTERVAL_MS = 350;
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 3000; // 3s, 6s exponential backoff

interface QueueItem {
  url: string;
  options?: RequestInit;
  resolve: (res: Response) => void;
  reject: (err: Error) => void;
}

let activeCount = 0;
let lastRequestTime = 0;
const pending: QueueItem[] = [];
let processing = false;

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  while (pending.length > 0 && activeCount < MAX_CONCURRENT) {
    const item = pending.shift();
    if (!item) break;

    // Enforce minimum interval between request starts
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
    }

    activeCount++;
    lastRequestTime = Date.now();

    // Fire request (don't await — let it resolve independently)
    fetchWithRetry(item.url, item.options)
      .then(item.resolve)
      .catch(item.reject)
      .finally(() => {
        activeCount--;
        // Re-trigger queue processing
        if (pending.length > 0) {
          processing = false;
          processQueue();
        }
      });
  }

  processing = false;
}

async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  attempt = 0
): Promise<Response> {
  const res = await fetch(url, options);

  if (res.status === 429 && attempt < MAX_RETRIES) {
    const delay = RETRY_BASE_MS * Math.pow(2, attempt);
    console.warn(
      `[OpenMeteo] 429 rate limited, retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`
    );
    await new Promise((r) => setTimeout(r, delay));
    return fetchWithRetry(url, options, attempt + 1);
  }

  return res;
}

/**
 * Rate-limited fetch for Open-Meteo API.
 * Drop-in replacement for `fetch()` — same signature and return type.
 */
export function openMeteoFetch(
  url: string,
  options?: RequestInit
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    pending.push({ url, options, resolve, reject });
    processQueue();
  });
}

/** Current queue depth (for debugging) */
export function openMeteoQueueDepth(): number {
  return pending.length;
}
