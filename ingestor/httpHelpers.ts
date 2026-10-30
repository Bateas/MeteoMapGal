import type http from 'node:http';
import { log } from './logger.js';

// CORS: allow frontend origins. The local Vite ones only outside production
// (the units set NODE_ENV=production): there they would let any page served on a
// visitor's own machine call the API, and send it data, with that visitor's browser.
export function allowedOrigins(nodeEnv: string | undefined): Set<string> {
  return new Set([
    'https://meteomapgal.navia3d.com', // Production
    ...(nodeEnv === 'production' ? [] : [
      'http://localhost:5173',         // Vite dev
      'http://localhost:4173',         // Vite preview
    ]),
  ]);
}

export const ALLOWED_ORIGINS = allowedOrigins(process.env.NODE_ENV);

export function corsHeaders(origin: string | undefined): Record<string, string> {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    // Never let a browser guess a type from the body (security audit 28-oct, item 10).
    'X-Content-Type-Options': 'nosniff',
  };
}

/**
 * Default freshness. A handler that knows better sets its own Cache-Control
 * with res.setHeader() before answering and it is respected: writeHead's own
 * headers win over setHeader, so hardcoding it here silently overrode every
 * per-route value (the historical baseline asked for 300 s and got 60).
 */
const DEFAULT_CACHE_CONTROL = 'public, max-age=60';

export function json(
  res: http.ServerResponse,
  data: unknown,
  status = 200,
  origin?: string,
  cacheControl?: string
): void {
  const body = JSON.stringify(data);
  const chosen = cacheControl ?? res.getHeader('Cache-Control') ?? DEFAULT_CACHE_CONTROL;
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': String(chosen),
    ...corsHeaders(origin),
  };
  res.writeHead(status, headers);
  res.end(body);
}

export function error(
  res: http.ServerResponse,
  message: string,
  status = 400,
  origin?: string
): void {
  // Never cacheable: a failure answered with the default minute would be
  // served to everyone for that minute by any cache in front of us.
  json(res, { error: message }, status, origin, 'no-store');
}

/**
 * Handler failure: log the real cause server-side, tell the client nothing.
 * Driver messages name schemas, columns and constraints — useful in the log,
 * free reconnaissance in a response body.
 */
export function dbError(
  res: http.ServerResponse,
  err: unknown,
  handler: string,
  origin?: string
): void {
  log.error(`[${handler}]`, (err as Error).message);
  error(res, 'Internal error', 500, origin);
}

/**
 * `limit` from the query: absent or empty -> `def`; a whole number from 1 up -> capped at `max`;
 * anything else -> null, and the route answers 400. `parseInt` alone gave NaN for «abc» and a
 * negative for «-5», and both reached the SQL as a 500 (security audit 28-oct).
 */
export function parseLimit(raw: string | undefined, def: number, max: number): number | null {
  if (raw === undefined || raw === '') return def;
  if (!/^\d{1,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? Math.min(n, max) : null;
}

export function parseSearchParams(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}
