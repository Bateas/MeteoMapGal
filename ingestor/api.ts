/**
 * MeteoMapGal History API
 *
 * Lightweight HTTP server for querying historical weather data
 * stored in TimescaleDB. Runs as a separate process alongside
 * the ingestor on LXC 305.
 *
 * Endpoints:
 *   GET /api/v1/health           → DB status + row counts
 *   GET /api/v1/stations         → All weather stations with last reading
 *   GET /api/v1/readings         → Weather time series (raw or hourly)
 *   GET /api/v1/readings/latest  → Latest weather reading per station
 *   GET /api/v1/readings/compare → Multi-station comparison
 *   GET /api/v1/stats            → Aggregate statistics
 *   GET /api/v1/buoys            → All buoy stations with last reading
 *   GET /api/v1/buoys/readings   → Buoy time series (raw or hourly)
 *   GET /api/v1/buoys/latest     → Latest buoy reading per station
 *
 * Usage:
 *   node --import tsx api.ts
 */

import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { initPool, pingDb, closePool } from './db.js';
import { log } from './logger.js';
import {
  queryHealth,
  queryStations,
  queryReadings,
  queryHourly,
  queryLatest,
  queryStats,
  queryMultiStation,
  queryBuoyStations,
  queryBuoyReadings,
  queryBuoyLatest,
  queryBuoyHourly,
} from './queries.js';
import { getPool } from './db.js';
import { getForecast } from './forecastFetcher.js';

// ── Configuration ──────────────────────────────────────

const PORT = parseInt(process.env.API_PORT || '3001', 10);
const HOST = process.env.API_HOST || '127.0.0.1';
const WEBCAM_DIR = process.env.WEBCAM_DIR || '/var/www/meteomapgal/webcam';
const WEBCAM_TOKEN = process.env.WEBCAM_TOKEN || '';

// CORS: allow frontend origins
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',           // Vite dev
  'http://localhost:4173',           // Vite preview
  'https://meteomapgal.navia3d.com', // Production
]);

// ── Helpers ────────────────────────────────────────────

function corsHeaders(origin: string | undefined): Record<string, string> {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(
  res: http.ServerResponse,
  data: unknown,
  status = 200,
  origin?: string
): void {
  const body = JSON.stringify(data);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=60',
    ...corsHeaders(origin),
  };
  res.writeHead(status, headers);
  res.end(body);
}

function error(
  res: http.ServerResponse,
  message: string,
  status = 400,
  origin?: string
): void {
  json(res, { error: message }, status, origin);
}

function parseSearchParams(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

/**
 * Default time range: last 24 hours.
 * Returns [from, to] as ISO strings.
 */
function defaultTimeRange(
  fromParam?: string,
  toParam?: string
): [string, string] {
  const to = toParam || new Date().toISOString();
  const from =
    fromParam || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return [from, to];
}

// ── Route handlers ─────────────────────────────────────

async function handleHealth(
  _params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string
): Promise<void> {
  const health = await queryHealth();
  json(res, health, health.status === 'ok' ? 200 : 503, origin);
}

async function handleStations(
  _params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string
): Promise<void> {
  const stations = await queryStations();
  json(res, { count: stations.length, stations }, 200, origin);
}

async function handleReadings(
  params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string
): Promise<void> {
  const { station_id, interval, limit: limitStr } = params;

  if (!station_id) {
    error(res, 'Missing required parameter: station_id', 400, origin);
    return;
  }

  const [from, to] = defaultTimeRange(params.from, params.to);
  const limit = Math.min(parseInt(limitStr || '2000', 10), 10000);

  if (interval === 'hourly') {
    const rows = await queryHourly(station_id, from, to, limit);
    json(res, { count: rows.length, interval: 'hourly', from, to, readings: rows }, 200, origin);
  } else {
    const rows = await queryReadings(station_id, from, to, limit);
    json(res, { count: rows.length, interval: 'raw', from, to, readings: rows }, 200, origin);
  }
}

async function handleLatest(
  params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string
): Promise<void> {
  const rows = await queryLatest(params.station_id || undefined);
  json(res, { count: rows.length, readings: rows }, 200, origin);
}

async function handleCompare(
  params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string
): Promise<void> {
  const { station_ids, interval, limit: limitStr } = params;

  if (!station_ids) {
    error(res, 'Missing required parameter: station_ids (comma-separated)', 400, origin);
    return;
  }

  const ids = station_ids.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0 || ids.length > 10) {
    error(res, 'station_ids must contain 1-10 comma-separated station IDs', 400, origin);
    return;
  }

  const [from, to] = defaultTimeRange(params.from, params.to);
  const limit = Math.min(parseInt(limitStr || '5000', 10), 20000);
  const mode = interval === 'hourly' ? 'hourly' : 'raw';

  const rows = await queryMultiStation(ids, from, to, mode, limit);
  json(res, { count: rows.length, interval: mode, from, to, stations: ids, readings: rows }, 200, origin);
}

async function handleStats(
  params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string
): Promise<void> {
  const { station_id } = params;

  if (!station_id) {
    error(res, 'Missing required parameter: station_id', 400, origin);
    return;
  }

  const [from, to] = defaultTimeRange(params.from, params.to);
  const stats = await queryStats(station_id, from, to);

  if (!stats) {
    error(res, 'No data found for this station in the given range', 404, origin);
    return;
  }

  json(res, { from, to, stats }, 200, origin);
}

// ── Buoy route handlers ────────────────────────────────

async function handleBuoyStations(
  _params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string
): Promise<void> {
  const stations = await queryBuoyStations();
  json(res, { count: stations.length, stations }, 200, origin);
}

async function handleBuoyReadings(
  params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string
): Promise<void> {
  const { station_id, interval, limit: limitStr } = params;

  if (!station_id) {
    error(res, 'Missing required parameter: station_id (integer)', 400, origin);
    return;
  }

  const id = parseInt(station_id, 10);
  if (isNaN(id)) {
    error(res, 'station_id must be an integer', 400, origin);
    return;
  }

  const [from, to] = defaultTimeRange(params.from, params.to);
  const limit = Math.min(parseInt(limitStr || '2000', 10), 10000);

  if (interval === 'hourly') {
    const rows = await queryBuoyHourly(id, from, to, limit);
    json(res, { count: rows.length, interval: 'hourly', from, to, readings: rows }, 200, origin);
  } else {
    const rows = await queryBuoyReadings(id, from, to, limit);
    json(res, { count: rows.length, interval: 'raw', from, to, readings: rows }, 200, origin);
  }
}

async function handleBuoyLatest(
  params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string
): Promise<void> {
  const stationId = params.station_id ? parseInt(params.station_id, 10) : undefined;
  const rows = await queryBuoyLatest(stationId);
  json(res, { count: rows.length, readings: rows }, 200, origin);
}

// ── Forecast endpoint ─────────────────────────────────

async function handleForecast(
  params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string
): Promise<void> {
  const sector = params.sector as 'embalse' | 'rias' | undefined;
  if (!sector || (sector !== 'embalse' && sector !== 'rias')) {
    error(res, 'Missing or invalid parameter: sector (embalse or rias)', 400, origin);
    return;
  }

  const data = await getForecast(sector);
  json(res, {
    sector,
    count: data.length,
    hourly: data.map(h => ({
      time: h.time.toISOString(),
      temperature: h.temperature,
      humidity: h.humidity,
      windSpeed: h.windSpeed,
      windDirection: h.windDirection,
      windGusts: h.windGusts,
      cloudCover: h.cloudCover,
      precipitation: h.precipitation,
      precipProbability: h.precipProbability,
      pressure: h.pressure,
      solarRadiation: h.solarRadiation,
      cape: h.cape,
      boundaryLayerHeight: h.boundaryLayerHeight,
      visibility: h.visibility,
      isDay: h.isDay,
    })),
  }, 200, origin);
}

// ── Spot scores endpoint ──────────────────────────────

async function handleSpotScores(
  params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string
): Promise<void> {
  const spotId = params.spot_id;
  const days = parseInt(params.days || '7', 10);
  const db = getPool();

  try {
    const result = await db.query(
      `SELECT time::text, spot_id, sector, verdict, wind_kt, gust_kt, wind_dir, station_count
       FROM spot_scores
       WHERE ($1::text IS NULL OR spot_id = $1)
         AND time > NOW() - make_interval(days => $2)
       ORDER BY time DESC
       LIMIT 2000`,
      [spotId || null, days]
    );
    json(res, { count: result.rows.length, scores: result.rows }, 200, origin);
  } catch (err) {
    error(res, (err as Error).message, 500, origin);
  }
}

// ── Webcam vision endpoint ────────────────────────────

async function handleWebcamVision(
  params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string
): Promise<void> {
  const db = getPool();
  const hours = parseInt(params.hours || '3', 10);

  try {
    const result = await db.query(
      `SELECT DISTINCT ON (webcam_id)
         time::text, webcam_id, spot_id, beaufort, confidence,
         fog, visibility, sky, description, provider, latency_ms
       FROM webcam_readings
       WHERE time > NOW() - make_interval(hours => $1)
       ORDER BY webcam_id, time DESC`,
      [hours]
    );
    json(res, { count: result.rows.length, readings: result.rows }, 200, origin);
  } catch (err) {
    error(res, (err as Error).message, 500, origin);
  }
}

// ── Router ─────────────────────────────────────────────

type RouteHandler = (
  params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string
) => Promise<void>;

const routes: Record<string, RouteHandler> = {
  '/api/v1/health': handleHealth,
  '/api/v1/stations': handleStations,
  '/api/v1/readings': handleReadings,
  '/api/v1/readings/latest': handleLatest,
  '/api/v1/readings/compare': handleCompare,
  '/api/v1/stats': handleStats,
  // Buoy endpoints
  '/api/v1/buoys': handleBuoyStations,
  '/api/v1/buoys/readings': handleBuoyReadings,
  '/api/v1/buoys/latest': handleBuoyLatest,
  // Forecast (served from ingestor cache, avoids frontend Open-Meteo 429s)
  '/api/v1/forecast': handleForecast,
  // Spot score history (for verification dashboard)
  '/api/v1/spots/scores': handleSpotScores,
  // Webcam vision latest results
  '/api/v1/webcam-vision': handleWebcamVision,
};

// ── Webcam upload handler ──────────────────────────────

async function handleWebcamUpload(
  spotId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  origin?: string
): Promise<void> {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (WEBCAM_TOKEN && token !== WEBCAM_TOKEN) {
    res.writeHead(401, corsHeaders(origin));
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  if (!/^[a-z0-9-]+$/.test(spotId)) {
    res.writeHead(400, corsHeaders(origin));
    res.end(JSON.stringify({ error: 'Invalid spot id' }));
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);

  if (body.length < 100) {
    res.writeHead(400, corsHeaders(origin));
    res.end(JSON.stringify({ error: 'Empty image' }));
    return;
  }

  try {
    fs.mkdirSync(WEBCAM_DIR, { recursive: true });
    const imgPath  = path.join(WEBCAM_DIR, `${spotId}.jpg`);
    const metaPath = path.join(WEBCAM_DIR, `${spotId}.json`);
    fs.writeFileSync(imgPath, body);
    fs.writeFileSync(metaPath, JSON.stringify({ ts: new Date().toISOString(), bytes: body.length }));
    log.info(`[Webcam] ${spotId} ${(body.length / 1024).toFixed(0)}KB`);
    res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    log.error('[Webcam] Save error:', (err as Error).message);
    res.writeHead(500, corsHeaders(origin));
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

// ── Server ─────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  // Webcam upload: POST /api/webcam/:spotId
  if (req.method === 'POST') {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    const m = url.pathname.match(/^\/api\/webcam\/([a-z0-9-]+)$/);
    if (m) {
      await handleWebcamUpload(m[1], req, res, origin);
    } else {
      error(res, 'Method not allowed', 405, origin);
    }
    return;
  }

  // Only GET allowed for everything else
  if (req.method !== 'GET') {
    error(res, 'Method not allowed', 405, origin);
    return;
  }

  try {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    const pathname = url.pathname.replace(/\/+$/, ''); // strip trailing slash
    const handler = routes[pathname];

    if (!handler) {
      // List available endpoints
      error(
        res,
        `Not found. Available endpoints: ${Object.keys(routes).join(', ')}`,
        404,
        origin
      );
      return;
    }

    const params = parseSearchParams(url);
    await handler(params, res, origin);
  } catch (err) {
    log.error('Request error:', (err as Error).message);
    error(res, 'Internal server error', 500, origin);
  }
});

// ── Startup ────────────────────────────────────────────

async function start(): Promise<void> {
  log.info('╔══════════════════════════════════════════╗');
  log.info('║   MeteoMapGal History API v1.0.0         ║');
  log.info('╚══════════════════════════════════════════╝');

  // 1. Initialize database pool
  initPool();
  const dbOk = await pingDb();
  if (!dbOk) {
    log.error('Cannot connect to TimescaleDB — check .env configuration');
    process.exit(1);
  }
  log.ok('Connected to TimescaleDB');

  // 2. Start HTTP server
  server.listen(PORT, HOST, () => {
    log.ok(`API listening on http://${HOST}:${PORT}`);
    log.info('Endpoints:');
    for (const path of Object.keys(routes)) {
      log.info(`  GET ${path}`);
    }
  });
}

// ── Graceful shutdown ──────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  log.info(`\n${signal} received — shutting down...`);
  server.close();
  await closePool();
  log.ok('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection:', String(reason));
});

// ── Go! ────────────────────────────────────────────────

start().catch((err) => {
  log.error('Fatal startup error:', (err as Error).message);
  process.exit(1);
});
