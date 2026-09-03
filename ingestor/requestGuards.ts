/**
 * Request guards — pure, no I/O, so the API's abuse rules can be tested
 * without a socket. Three questions the handlers kept answering wrongly:
 *
 *   1. Who is the client? Not `X-Forwarded-For[0]`: the reverse proxy and
 *      Cloudflare both APPEND to that header, so its first element is
 *      whatever the client wrote. Every per-IP bucket in the API was
 *      therefore keyed on a value the attacker chose. The tunnel puts the
 *      real address in `CF-Connecting-IP`, which nothing can forge from
 *      outside because Cloudflare overwrites it.
 *   2. How big may a number be? A `days` the client sets to 100000 is a
 *      full-table scan on a 2 GB database host that has already been
 *      OOM-killed once by exactly that shape of query.
 *   3. Where may we send a push? `https://` alone let anyone register any
 *      URL as a "browser", which turned the dispatcher into a request
 *      amplifier and put the real lightning warnings behind junk.
 */

import type { IncomingHttpHeaders } from 'node:http';

/** Header value as a single trimmed string, or null. */
function headerOf(headers: IncomingHttpHeaders, name: string): string | null {
  const v = headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  const t = s?.trim();
  return t ? t : null;
}

/**
 * The client address the rate limiters should key on.
 *
 * Order matters: `CF-Connecting-IP` is set by the tunnel and cannot be
 * supplied by the client; `X-Real-IP` is set by the proxy from the socket;
 * `X-Forwarded-For` is only trusted for its LAST element (the one the proxy
 * appended); the socket address is the dev-server fallback.
 */
export function clientIpOf(headers: IncomingHttpHeaders, socketAddress: string | undefined): string {
  const cf = headerOf(headers, 'cf-connecting-ip');
  if (cf) return cf;
  const real = headerOf(headers, 'x-real-ip');
  if (real) return real;
  const xff = headerOf(headers, 'x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return socketAddress || 'unknown';
}

/** Integer from a query param, clamped to [min, max]; `fallback` when absent or not a number. */
export function clampInt(raw: string | null | undefined, min: number, max: number, fallback: number): number {
  const n = raw == null || raw === '' ? NaN : Number.parseInt(raw, 10);
  const v = Number.isFinite(n) ? n : fallback;
  return Math.min(max, Math.max(min, v));
}

/**
 * Push services browsers actually use. Anything else is not a browser
 * subscription, whatever the payload says.
 *   Chrome / Edge-Chromium / Brave / Opera / Samsung  -> fcm.googleapis.com
 *   Firefox                                           -> updates.push.services.mozilla.com
 *   Legacy Edge (WNS)                                 -> *.notify.windows.com
 *   Safari (macOS 13+, iOS 16.4+)                     -> web.push.apple.com
 */
const PUSH_HOSTS_EXACT = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
]);
const PUSH_HOST_SUFFIXES = ['.notify.windows.com', '.push.apple.com'];

/** True only for an https URL on a known browser push service. */
export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (PUSH_HOSTS_EXACT.has(host)) return true;
  return PUSH_HOST_SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length);
}

/**
 * Keep a TTL cache bounded. The proxy caches used to prune only EXPIRED
 * entries once they grew past N, so a client that varied the query string
 * could park thousands of unexpired responses in memory inside one TTL.
 * Drops expired entries first, then the OLDEST until `max` remain (a Map
 * iterates in insertion order).
 */
export function pruneCache<K>(cache: Map<K, { ts: number }>, ttlMs: number, max: number, now = Date.now()): void {
  for (const [k, v] of cache) {
    if (now - v.ts > ttlMs) cache.delete(k);
  }
  if (cache.size <= max) return;
  for (const k of cache.keys()) {
    cache.delete(k);
    if (cache.size <= max) break;
  }
}

/**
 * Memoise an async producer for `ttlMs`, and share ONE in-flight call among
 * concurrent callers. This is the whole defence for the two public routes
 * that aggregate the readings hypertable: whatever the request rate, the
 * database sees at most one query per TTL.
 */
export function memoAsync<T>(ttlMs: number, produce: () => Promise<T>, clock: () => number = Date.now): () => Promise<T> {
  let value: T | undefined;
  let storedAt = -Infinity;
  let inflight: Promise<T> | null = null;
  return () => {
    if (value !== undefined && clock() - storedAt < ttlMs) return Promise.resolve(value);
    if (inflight) return inflight;
    inflight = produce()
      .then((v) => {
        value = v;
        storedAt = clock();
        return v;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}
