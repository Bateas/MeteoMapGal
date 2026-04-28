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
 *   GET /api/v1/analytics/lightning-heatmap?from=&to=&minStrikes= → Spatial cells
 *   GET /api/v1/analytics/convection-trend?sector=&days=          → Daily peak CAPE/LI
 *   GET /api/v1/analytics/air-quality-trend?days=&station=        → Daily AQ rollup
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
  queryLightningHeatmap,
  queryConvectionTrend,
  queryAirQualityTrend,
} from './queries.js';
import { getPool } from './db.js';
import { getForecast, getMarineForecast } from './forecastFetcher.js';

// ── Configuration ──────────────────────────────────────

const PORT = parseInt(process.env.API_PORT || '3001', 10);
const HOST = process.env.API_HOST || '127.0.0.1';
const WEBCAM_DIR = process.env.WEBCAM_DIR || '/var/www/meteomapgal/webcam';
const WEBCAM_TOKEN = process.env.WEBCAM_TOKEN || '';
const AEMET_API_KEY = process.env.AEMET_API_KEY || '';
const AEMET_BASE = 'https://opendata.aemet.es/opendata';
const METEOSIX_API_KEY = process.env.METEOSIX_API_KEY || '';
const METEOSIX_BASE = 'https://servizos.meteogalicia.gal/apiv5';
const OBSCOSTEIRO_API_KEY = process.env.OBSCOSTEIRO_API_KEY || '';
const OBSCOSTEIRO_BASE = 'https://apis-ext.xunta.gal/mgplatpubapi/v1/api';
const FIRMS_API_KEY = process.env.FIRMS_API_KEY || '';
const FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
// Galicia + buffer (Asturias W + Norte Portugal — fires often cross borders).
// Hardcoded server-side: prevents the proxy from being used as an open FIRMS gateway.
const FIRMS_BBOX = '-10.0,41.5,-6.0,44.0';

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

// ── Input validation ──────────────────────────────────
const VALID_SOURCES = new Set(['aemet', 'meteogalicia', 'meteoclimatic', 'wunderground', 'netatmo', 'skyx']);
const STATION_ID_RE = /^[a-zA-Z0-9_-]{2,50}$/;

function validateStationId(id: string | undefined): string | null {
  if (!id) return null;
  return STATION_ID_RE.test(id) ? id : null;
}

function validateSource(source: string | undefined): string | null {
  if (!source) return null;
  return VALID_SOURCES.has(source) ? source : null;
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
    try {
      const rows = await queryHourly(station_id, from, to, limit);
      json(res, { count: rows.length, interval: 'hourly', from, to, readings: rows }, 200, origin);
    } catch {
      // Fallback to raw if continuous aggregate fails (not refreshed, compressed chunks, etc.)
      const rows = await queryReadings(station_id, from, to, Math.min(limit, 2000));
      json(res, { count: rows.length, interval: 'raw', from, to, readings: rows }, 200, origin);
    }
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
  const stationId = validateStationId(params.station_id) ?? undefined;
  const source = validateSource(params.source) ?? undefined;
  if (params.station_id && !stationId) { error(res, 'Invalid station_id format', 400, origin); return; }
  if (params.source && !source) { error(res, 'Invalid source', 400, origin); return; }
  const rows = await queryLatest(stationId, source);
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
  const rawId = params.station_id;
  if (rawId && !/^\d{1,6}$/.test(rawId)) { error(res, 'Invalid station_id (numeric only)', 400, origin); return; }
  const stationId = rawId ? parseInt(rawId, 10) : undefined;
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
      cin: h.cin,
      liftedIndex: h.liftedIndex,
      boundaryLayerHeight: h.boundaryLayerHeight,
      visibility: h.visibility,
      snowLevel: h.snowLevel,
      skyState: h.skyState,
      temperature500hPa: h.temperature500hPa ?? null,
      isDay: h.isDay,
    })),
  }, 200, origin);
}

// ── Marine forecast endpoint (surf spots) ──────────────

async function handleMarineForecast(
  params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string
): Promise<void> {
  const spotId = params.spot;
  if (!spotId) {
    error(res, 'Missing parameter: spot (surf-patos, surf-lanzada, surf-corrubedo)', 400, origin);
    return;
  }

  const data = await getMarineForecast(spotId);
  json(res, {
    spot: spotId,
    count: data.length,
    hourly: data.map(h => ({
      time: h.time.toISOString(),
      waveHeight: h.waveHeight,
      wavePeriod: h.wavePeriod,
      waveDirection: h.waveDirection,
      swellHeight: h.swellHeight,
      swellPeriod: h.swellPeriod,
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

// ── Analytics endpoints (Phase 3) ──────────────────────
// Hit the continuous aggregates created by Phase 2 (schema.sql). Each
// endpoint returns a small bounded payload (≤ 5000 rows) so the frontend can
// render heatmaps / trend lines without paginating.

const MAX_RANGE_DAYS = 365;

/** Parse an ISO timestamp from a query param; returns null if missing/invalid. */
function parseISODate(v: string | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Default `from` when caller omits it: `to` minus N days, clamped to 1 year. */
function defaultFrom(to: Date, defaultDays: number): Date {
  return new Date(to.getTime() - defaultDays * 86_400_000);
}

async function handleAnalyticsLightningHeatmap(
  params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  const to = parseISODate(params.to) ?? new Date();
  const from = parseISODate(params.from) ?? defaultFrom(to, 30);
  if (to < from) { error(res, 'Parameter "to" must be >= "from"', 400, origin); return; }
  const rangeDays = (to.getTime() - from.getTime()) / 86_400_000;
  if (rangeDays > MAX_RANGE_DAYS) {
    error(res, `Range too wide (max ${MAX_RANGE_DAYS} days)`, 400, origin); return;
  }
  const minStrikes = Math.max(1, parseInt(params.minStrikes || '1', 10) || 1);

  try {
    const cells = await queryLightningHeatmap(from, to, minStrikes);
    json(res, {
      from: from.toISOString(),
      to: to.toISOString(),
      minStrikes,
      count: cells.length,
      cells,
    }, 200, origin);
  } catch (err) {
    error(res, (err as Error).message, 500, origin);
  }
}

async function handleAnalyticsConvectionTrend(
  params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  const sector = params.sector;
  if (!sector || (sector !== 'embalse' && sector !== 'rias')) {
    error(res, 'Missing or invalid parameter: sector (embalse or rias)', 400, origin); return;
  }
  const days = Math.min(MAX_RANGE_DAYS, Math.max(1, parseInt(params.days || '30', 10) || 30));

  try {
    const days_ = await queryConvectionTrend(sector, days);
    json(res, { sector, days, count: days_.length, trend: days_ }, 200, origin);
  } catch (err) {
    error(res, (err as Error).message, 500, origin);
  }
}

async function handleAnalyticsAirQualityTrend(
  params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  const days = Math.min(MAX_RANGE_DAYS, Math.max(1, parseInt(params.days || '30', 10) || 30));
  const station = params.station ? params.station.slice(0, 100) : undefined;

  try {
    const rows = await queryAirQualityTrend(days, station);
    json(res, { days, station: station ?? null, count: rows.length, trend: rows }, 200, origin);
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
  // Marine wave forecast for surf spots (cached 30min from Open-Meteo Marine)
  '/api/v1/marine': handleMarineForecast,
  // Spot score history (for verification dashboard)
  '/api/v1/spots/scores': handleSpotScores,
  // Webcam vision latest results
  '/api/v1/webcam-vision': handleWebcamVision,
  // ── Analytics (Phase 3) — pre-computed rollups from continuous aggregates ──
  '/api/v1/analytics/lightning-heatmap':  handleAnalyticsLightningHeatmap,
  '/api/v1/analytics/convection-trend':   handleAnalyticsConvectionTrend,
  '/api/v1/analytics/air-quality-trend':  handleAnalyticsAirQualityTrend,
};

// ── Storm prediction POST handler ──────────────────────

async function handleStormPredictionPost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  let body: any;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    res.writeHead(400, corsHeaders(origin));
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  const { sector, probability, horizon, severity, hasLightning, signals } = body;
  if (typeof probability !== 'number' || typeof sector !== 'string' || !Array.isArray(signals)) {
    res.writeHead(400, corsHeaders(origin));
    res.end(JSON.stringify({ error: 'Missing required fields: sector, probability, signals[]' }));
    return;
  }

  try {
    await getPool().query(
      `INSERT INTO storm_predictions (time, sector, probability, horizon, severity, has_lightning,
        signal_cape, signal_precip, signal_cloud, signal_lightning, signal_approach,
        signal_shadow, signal_gusts, signal_mg_warning, signal_sky_state)
       VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (time, sector) DO NOTHING`,
      [
        sector, probability, horizon ?? null, severity ?? null, hasLightning ?? false,
        signals[0] ?? null, signals[1] ?? null, signals[2] ?? null,
        signals[3] ?? null, signals[4] ?? null, signals[5] ?? null,
        signals[6] ?? null, signals[7] ?? null, signals[8] ?? null,
      ],
    );
    res.writeHead(201, corsHeaders(origin));
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    log.error('Storm prediction insert error:', (err as Error).message);
    error(res, 'DB error', 500, origin);
  }
}

// ── Webcam upload handler ──────────────────────────────

// Rate limit for webcam uploads: max 20 per hour per IP
const webcamUploadCounts = new Map<string, { count: number; resetAt: number }>();
const WEBCAM_UPLOAD_MAX = 20;
const WEBCAM_UPLOAD_WINDOW_MS = 60 * 60_000; // 1 hour

async function handleWebcamUpload(
  spotId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  origin?: string
): Promise<void> {
  // Server-side rate limit per IP
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = webcamUploadCounts.get(ip);
  if (bucket && now < bucket.resetAt) {
    if (bucket.count >= WEBCAM_UPLOAD_MAX) {
      res.writeHead(429, corsHeaders(origin));
      res.end(JSON.stringify({ error: 'Rate limit exceeded (20/hour)' }));
      return;
    }
    bucket.count++;
  } else {
    webcamUploadCounts.set(ip, { count: 1, resetAt: now + WEBCAM_UPLOAD_WINDOW_MS });
  }

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

// ── AEMET proxy (server-side key injection) ────────────
// Frontend calls /api/v1/aemet/api/observacion/... without the key.
// This handler injects AEMET_API_KEY and proxies to opendata.aemet.es.
// Responses cached in-memory for 5 minutes to reduce AEMET load.

const aemetCache = new Map<string, { data: Buffer; contentType: string; ts: number }>();
const AEMET_CACHE_TTL = 5 * 60_000; // 5 minutes

async function handleAemetProxy(
  aemetPath: string,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  if (!AEMET_API_KEY) {
    error(res, 'AEMET_API_KEY not configured on server', 503, origin);
    return;
  }

  // Whitelist allowed AEMET paths to prevent SSRF
  if (!aemetPath.startsWith('/api/') && !aemetPath.startsWith('/opendata/')) {
    error(res, 'Invalid AEMET path', 400, origin);
    return;
  }

  // Check in-memory cache
  const cached = aemetCache.get(aemetPath);
  if (cached && Date.now() - cached.ts < AEMET_CACHE_TTL) {
    res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'HIT' });
    res.end(cached.data);
    return;
  }

  try {
    // Inject api_key server-side
    const sep = aemetPath.includes('?') ? '&' : '?';
    const url = `${AEMET_BASE}${aemetPath}${sep}api_key=${AEMET_API_KEY}`;
    const upstream = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    const contentType = upstream.headers.get('content-type') || 'application/json';
    const buf = Buffer.from(await upstream.arrayBuffer());

    // Cache successful responses
    if (upstream.ok) {
      aemetCache.set(aemetPath, { data: buf, contentType, ts: Date.now() });
      // Prune old entries
      if (aemetCache.size > 50) {
        const now = Date.now();
        for (const [k, v] of aemetCache) {
          if (now - v.ts > AEMET_CACHE_TTL) aemetCache.delete(k);
        }
      }
    }

    res.writeHead(upstream.status, { ...corsHeaders(origin), 'Content-Type': contentType, 'X-Cache': 'MISS' });
    res.end(buf);
  } catch (err) {
    log.error('[AEMET Proxy]', (err as Error).message);
    // Serve stale cache on error
    if (cached) {
      res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'STALE' });
      res.end(cached.data);
      return;
    }
    error(res, 'AEMET upstream error', 502, origin);
  }
}

// ── NASA FIRMS proxy (active wildfires) ──────────────────
// Frontend calls /api/v1/firms?days=N (1-5).
// Key + bbox locked server-side. Cache 30min (FIRMS updates ~every 60min
// on satellite passes; 30min cache keeps load on NASA low without missing
// new passes).

const firmsCache = new Map<number, { data: Buffer; ts: number }>();
const FIRMS_CACHE_TTL = 30 * 60_000; // 30 minutes
const FIRMS_TIMEOUT_MS = 10_000;

async function handleFirmsProxy(
  daysParam: string | null,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  if (!FIRMS_API_KEY) {
    error(res, 'FIRMS_API_KEY not configured on server', 503, origin);
    return;
  }

  // Validate days: 1..5 (FIRMS Area-API limit)
  const days = Math.max(1, Math.min(5, parseInt(daysParam || '1', 10) || 1));

  const cached = firmsCache.get(days);
  if (cached && Date.now() - cached.ts < FIRMS_CACHE_TTL) {
    res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': 'text/csv', 'X-Cache': 'HIT' });
    res.end(cached.data);
    return;
  }

  try {
    // VIIRS_SNPP_NRT — best resolution (375m) + URT pipeline
    const url = `${FIRMS_BASE}/${FIRMS_API_KEY}/VIIRS_SNPP_NRT/${FIRMS_BBOX}/${days}`;
    const upstream = await fetch(url, { signal: AbortSignal.timeout(FIRMS_TIMEOUT_MS) });
    const buf = Buffer.from(await upstream.arrayBuffer());

    if (upstream.ok) {
      firmsCache.set(days, { data: buf, ts: Date.now() });
      // Cap cache to a handful of days entries
      if (firmsCache.size > 10) {
        const now = Date.now();
        for (const [k, v] of firmsCache) {
          if (now - v.ts > FIRMS_CACHE_TTL) firmsCache.delete(k);
        }
      }
    }

    res.writeHead(upstream.status, { ...corsHeaders(origin), 'Content-Type': 'text/csv', 'X-Cache': 'MISS' });
    res.end(buf);
  } catch (err) {
    log.error('[FIRMS Proxy]', (err as Error).message);
    if (cached) {
      res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': 'text/csv', 'X-Cache': 'STALE' });
      res.end(cached.data);
      return;
    }
    error(res, 'FIRMS upstream error', 502, origin);
  }
}

// ── AEMET data proxy (step 2 — signed URLs) ────────────
// AEMET step 1 returns a datos URL like https://opendata.aemet.es/opendata/sh/XXXXX
// Step 2 fetches that URL (no api_key needed, it's a signed URL).

async function handleAemetDataProxy(
  dataPath: string,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  // Check in-memory cache
  const cached = aemetCache.get(`data:${dataPath}`);
  if (cached && Date.now() - cached.ts < AEMET_CACHE_TTL) {
    res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'HIT' });
    res.end(cached.data);
    return;
  }

  try {
    const url = `https://opendata.aemet.es${dataPath}`;
    const upstream = await fetch(url);
    const contentType = upstream.headers.get('content-type') || 'application/json';
    const buf = Buffer.from(await upstream.arrayBuffer());

    if (upstream.ok) {
      aemetCache.set(`data:${dataPath}`, { data: buf, contentType, ts: Date.now() });
    }

    res.writeHead(upstream.status, { ...corsHeaders(origin), 'Content-Type': contentType, 'X-Cache': 'MISS' });
    res.end(buf);
  } catch (err) {
    log.error('[AEMET Data Proxy]', (err as Error).message);
    if (cached) {
      res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'STALE' });
      res.end(cached.data);
      return;
    }
    error(res, 'AEMET data upstream error', 502, origin);
  }
}

// ── MeteoSIX proxy (server-side key injection) ─────────
// Frontend calls /api/v1/meteosix/getNumericForecastInfo?coords=...
// This handler injects METEOSIX_API_KEY. Cached 3min.

const meteosixCache = new Map<string, { data: Buffer; contentType: string; ts: number }>();
const METEOSIX_CACHE_TTL = 3 * 60_000;

async function handleMeteoSixProxy(
  msPath: string,
  query: string,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  if (!METEOSIX_API_KEY) {
    error(res, 'METEOSIX_API_KEY not configured on server', 503, origin);
    return;
  }

  // SSRF whitelist — only allow forecast API paths
  if (!msPath.startsWith('/getNumericForecastInfo')) {
    error(res, 'Invalid MeteoSIX path', 400, origin);
    return;
  }

  const cacheKey = `${msPath}?${query}`;
  const cached = meteosixCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < METEOSIX_CACHE_TTL) {
    res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'HIT' });
    res.end(cached.data);
    return;
  }

  try {
    const sep = query ? '&' : '';
    const url = `${METEOSIX_BASE}${msPath}?${query}${sep}API_KEY=${METEOSIX_API_KEY}`;
    const upstream = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    const contentType = upstream.headers.get('content-type') || 'application/json';
    const buf = Buffer.from(await upstream.arrayBuffer());

    if (upstream.ok) {
      meteosixCache.set(cacheKey, { data: buf, contentType, ts: Date.now() });
      if (meteosixCache.size > 100) {
        const now = Date.now();
        for (const [k, v] of meteosixCache) { if (now - v.ts > METEOSIX_CACHE_TTL) meteosixCache.delete(k); }
      }
    }

    res.writeHead(upstream.status, { ...corsHeaders(origin), 'Content-Type': contentType, 'X-Cache': 'MISS' });
    res.end(buf);
  } catch (err) {
    log.error('[MeteoSIX Proxy]', (err as Error).message);
    if (cached) {
      res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'STALE' });
      res.end(cached.data);
      return;
    }
    error(res, 'MeteoSIX upstream error', 502, origin);
  }
}

// ── ObsCosteiro proxy (server-side key injection) ───────
// Frontend calls /api/v1/obscosteiro/ultimo/recente/{boiaId}
// This handler injects apikey header. Cached 3min.

const obsCache = new Map<string, { data: Buffer; contentType: string; ts: number }>();
const OBS_CACHE_TTL = 3 * 60_000;

async function handleObsCosteiroProxy(
  obsPath: string,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  if (!OBSCOSTEIRO_API_KEY) {
    error(res, 'OBSCOSTEIRO_API_KEY not configured on server', 503, origin);
    return;
  }

  // SSRF whitelist — only allow observation data paths
  if (!obsPath.startsWith('/ultimo/')) {
    error(res, 'Invalid ObsCosteiro path', 400, origin);
    return;
  }

  const cached = obsCache.get(obsPath);
  if (cached && Date.now() - cached.ts < OBS_CACHE_TTL) {
    res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'HIT' });
    res.end(cached.data);
    return;
  }

  try {
    const url = `${OBSCOSTEIRO_BASE}${obsPath}`;
    const upstream = await fetch(url, {
      headers: { apikey: OBSCOSTEIRO_API_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    const contentType = upstream.headers.get('content-type') || 'application/json';
    const buf = Buffer.from(await upstream.arrayBuffer());

    if (upstream.ok) {
      obsCache.set(obsPath, { data: buf, contentType, ts: Date.now() });
      if (obsCache.size > 50) {
        const now = Date.now();
        for (const [k, v] of obsCache) { if (now - v.ts > OBS_CACHE_TTL) obsCache.delete(k); }
      }
    }

    res.writeHead(upstream.status, { ...corsHeaders(origin), 'Content-Type': contentType, 'X-Cache': 'MISS' });
    res.end(buf);
  } catch (err) {
    log.error('[ObsCosteiro Proxy]', (err as Error).message);
    if (cached) {
      res.writeHead(200, { ...corsHeaders(origin), 'Content-Type': cached.contentType, 'X-Cache': 'STALE' });
      res.end(cached.data);
      return;
    }
    error(res, 'ObsCosteiro upstream error', 502, origin);
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

  // POST routes
  if (req.method === 'POST') {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    const webcamMatch = url.pathname.match(/^\/api\/webcam\/([a-z0-9-]+)$/);
    if (webcamMatch) {
      await handleWebcamUpload(webcamMatch[1], req, res, origin);
    } else if (url.pathname === '/api/v1/storm-predictions') {
      await handleStormPredictionPost(req, res, origin);
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

    // ── API key proxy routes (keys stay server-side) ──
    if (pathname.startsWith('/api/v1/aemet/')) {
      const aemetPath = pathname.slice('/api/v1/aemet'.length);
      await handleAemetProxy(aemetPath, res, origin);
      return;
    }
    if (pathname.startsWith('/api/v1/aemet-data/')) {
      const dataPath = pathname.slice('/api/v1/aemet-data'.length);
      await handleAemetDataProxy(dataPath, res, origin);
      return;
    }
    if (pathname.startsWith('/api/v1/meteosix/')) {
      const msPath = pathname.slice('/api/v1/meteosix'.length); // e.g. /getNumericForecastInfo
      const query = url.search.slice(1); // strip leading ?
      await handleMeteoSixProxy(msPath, query, res, origin);
      return;
    }
    if (pathname.startsWith('/api/v1/obscosteiro/')) {
      const obsPath = pathname.slice('/api/v1/obscosteiro'.length); // e.g. /ultimo/recente/15009
      await handleObsCosteiroProxy(obsPath, res, origin);
      return;
    }
    if (pathname === '/api/v1/firms') {
      await handleFirmsProxy(url.searchParams.get('days'), res, origin);
      return;
    }

    const handler = routes[pathname];

    if (!handler) {
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
