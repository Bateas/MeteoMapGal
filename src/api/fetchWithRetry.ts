/**
 * Shared fetch wrapper with retry + exponential backoff.
 * Use for APIs without their own retry logic.
 *
 * @example
 * const data = await fetchWithRetry('/enaire-api/zones', {
 *   label: 'ENAIRE',
 *   timeout: 15000,
 *   maxRetries: 2,
 * });
 */

interface FetchWithRetryOptions extends RequestInit {
  /** Label for console logs (e.g. 'ENAIRE', 'Tide') */
  label?: string;
  /** AbortSignal timeout in ms (default: 15000) */
  timeout?: number;
  /** Max retry attempts on 5xx or network error (default: 2) */
  maxRetries?: number;
  /** Base delay between retries in ms (default: 2000). Doubles each retry. */
  retryBaseMs?: number;
}

/**
 * Fetch with automatic retry on 5xx errors and network failures.
 * Returns the Response object. Throws on final failure.
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const {
    label = 'Fetch',
    timeout = 15000,
    maxRetries = 2,
    retryBaseMs = 2000,
    ...fetchInit
  } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        ...fetchInit,
        signal: fetchInit.signal ?? AbortSignal.timeout(timeout),
      });

      // Retry on 5xx server errors
      if (res.status >= 500 && attempt < maxRetries) {
        const delay = retryBaseMs * Math.pow(2, attempt);
        console.warn(`[${label}] ${res.status} on ${url}, retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      return res;
    } catch (err) {
      // Retry on network errors (not abort/timeout)
      if (attempt < maxRetries && !(err instanceof DOMException && err.name === 'AbortError')) {
        const delay = retryBaseMs * Math.pow(2, attempt);
        console.warn(`[${label}] Network error on ${url}, retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }

  // Should never reach here, but TypeScript needs it
  throw new Error(`[${label}] All ${maxRetries + 1} attempts failed for ${url}`);
}

/**
 * Convenience: fetch JSON with retry.
 * Returns parsed JSON or null on failure (logs warning, never throws).
 */
export async function fetchJsonWithRetry<T = unknown>(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<T | null> {
  const label = options.label ?? 'Fetch';
  try {
    const res = await fetchWithRetry(url, options);
    if (!res.ok) {
      console.warn(`[${label}] ${res.status} ${res.statusText} — ${url}`);
      return null;
    }
    return await res.json() as T;
  } catch (err) {
    console.warn(`[${label}] Failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}
