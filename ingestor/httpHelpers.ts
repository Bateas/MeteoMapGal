import type http from 'node:http';
import { log } from './logger.js';

// CORS: allow frontend origins
export const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',           // Vite dev
  'http://localhost:4173',           // Vite preview
  'https://meteomapgal.navia3d.com', // Production
]);

export function corsHeaders(origin: string | undefined): Record<string, string> {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
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

export function parseSearchParams(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}
