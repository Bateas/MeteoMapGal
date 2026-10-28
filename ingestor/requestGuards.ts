/**
 * Request guards — pure, no I/O, so the API's abuse rules can be tested
 * without a socket. Three questions the handlers kept answering wrongly:
 *
 *   1. Who is the client? Not `X-Forwarded-For[0]`: the reverse proxy and
 *      Cloudflare both APPEND to that header, so its first element is
 *      whatever the client wrote. Every per-IP bucket in the API was
 *      therefore not a safe key. The tunnel puts the
 *      real address in `CF-Connecting-IP`, which nothing can forge from
 *      outside because Cloudflare overwrites it.
 *   2. How big may a number be? A `days` the client sets to 100000 is a
 *      full-table scan; every such parameter is bounded so no query
 *      can grow without limit.
 *   3. Where may we send a push? `https://` alone let anyone register any
 *      URL as a "browser"; only the push services browsers really use
 *      are accepted (see isAllowedPushEndpoint).
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

/**
 * A subscription must opt into 1..20 curated spots. An empty list is never
 * selected by the dispatcher, so such a row is never contacted and never
 * pruned: it would only fill the store. The real client never sends one
 * (removing the last spot calls /push/unsubscribe).
 */
export function isValidPushSpotList(spotIds: unknown, valid: ReadonlySet<string>): spotIds is string[] {
  return Array.isArray(spotIds) && spotIds.length >= 1 && spotIds.length <= 20
    && spotIds.every((id: unknown) => typeof id === 'string' && valid.has(id));
}

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

/**
 * One fixed-window rate-limit hit. Returns false when the key is over `max`
 * inside its window. A new window moves the key to the end of the Map, and
 * the oldest keys go once there are more than `cap`, so the Map cannot grow
 * with every client that ever posted (the storm and push buckets used to).
 */
export function hitBucket(
  buckets: Map<string, { count: number; resetAt: number }>,
  key: string,
  now: number,
  max: number,
  windowMs: number,
  cap = 5000,
): boolean {
  const b = buckets.get(key);
  if (b && now < b.resetAt) {
    if (b.count >= max) return false;
    b.count++;
    return true;
  }
  buckets.delete(key);
  buckets.set(key, { count: 1, resetAt: now + windowMs });
  for (const k of buckets.keys()) {
    if (buckets.size <= cap) break;
    buckets.delete(k);
  }
  return true;
}

/**
 * from/to of the historical routes: last 24 h by default; otherwise both must
 * be dates, to >= from, and the span at most `maxDays`. The strings go to SQL
 * unchanged (parameterised), so a valid request means exactly what it meant.
 */
export function parseTimeRange(
  fromParam: string | undefined,
  toParam: string | undefined,
  maxDays: number,
  now: number = Date.now(),
): { from: string; to: string } | { error: string } {
  const to = toParam || new Date(now).toISOString();
  const from = fromParam || new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const tf = Date.parse(from);
  const tt = Date.parse(to);
  if (!Number.isFinite(tf) || !Number.isFinite(tt)) return { error: 'Invalid from/to' };
  if (tt < tf) return { error: 'to must not be before from' };
  if (tt - tf > maxDays * 24 * 60 * 60 * 1000) return { error: `Range too wide (max ${maxDays} days)` };
  return { from, to };
}
