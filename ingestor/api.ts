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
 *   GET /api/v1/analytics/convection-grid?hourOffset=             → Spatial CAPE/LI grid
 *   GET /api/v1/analytics/upper-air?sector=&hours=                → Sounding 850/700/500 hPa
 *   GET /api/v1/fires?days=                                       → Active fires + lightning attribution
 *   GET /api/v1/fires/events?days=&galicia=&province=             → EFFIS named fire events (commune + hectares)
 *   GET /api/v1/push/vapid-key                                    → Web Push VAPID public key
 *   POST /api/v1/push/{subscribe,unsubscribe,test}                → Lightning-safety push channel
 *
 * Usage:
 *   node --import tsx api.ts
 */

import 'dotenv/config';
import http from 'node:http';
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
  queryConvectionGrid,
  queryHistoricalBaseline,
  queryFireAttribution,
  queryUpperAir,
} from './queries.js';
import { getPool } from './db.js';
import { clientIpOf, clampInt, isAllowedPushEndpoint, pruneCache, memoAsync } from './requestGuards.js';
import { getForecast, getMarineForecast } from './forecastFetcher.js';
import { getSpotsForSector } from '../src/config/spots.js';
import { getVapidPublicKey, sendTestPush, logPushStartup } from './pushDispatcher.js';
import { EFFIS_ATTRIBUTION, isGalicianProvince, normalizeProvince } from './effisFetcher.js';
import { corsHeaders, json, error, dbError, parseSearchParams, ALLOWED_ORIGINS } from './httpHelpers.js';
import { handleWebcamUpload } from './webcamHandler.js';
import {
  handleAemetProxy,
  handleAemetDataProxy,
  handleMeteoSixProxy,
  handleObsCosteiroProxy,
  handleFirmsProxy,
  handleMetarProxy,
} from './proxyHandlers.js';

// ── Configuration ──────────────────────────────────────

const PORT = parseInt(process.env.API_PORT || '3001', 10);
const HOST = process.env.API_HOST || '127.0.0.1';

// ── Input validation ──────────────────────────────────
// Every network the ingestor writes, plus ipma: the frontend already asks for
// `?source=ipma` whenever it has discovered IPMA stations, and while ipma was
// missing here each of those polls got a 400. Until the ingestor writes IPMA
// rows the answer is empty and the map falls back as before.
const VALID_SOURCES = new Set(['aemet', 'meteogalicia', 'meteoclimatic', 'wunderground', 'netatmo', 'skyx', 'ipma']);
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

// Both of these aggregate the readings hypertable. Memoised with in-flight
// sharing so the database sees at most one such query per TTL no matter how
// hard a client polls: the same query shape OOM-killed the DB host once.
const cachedStations = memoAsync(5 * 60_000, queryStations);
const cachedHealth = memoAsync(60_000, queryHealth);

async function handleHealth(
  _params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string
): Promise<void> {
  const health = await cachedHealth();
  json(res, health, health.status === 'ok' ? 200 : 503, origin);
}

async function handleStations(
  _params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string
): Promise<void> {
  const stations = await cachedStations();
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
    } catch (err) {
      // Fallback to raw if the continuous aggregate fails (missing GRANT on the
      // materialized view, aggregate not refreshed, compressed chunks...).
      // The client still gets a usable 200, but the fallback silently truncates
      // long ranges to 2000 raw rows — which looks like a normal short history
      // rather than a broken aggregate. Log it so the cause is diagnosable
      // instead of showing up as "the chart is missing old data".
      log.warn(
        `[API] hourly aggregate failed for ${station_id}, serving raw instead: ${(err as Error).message}`,
      );
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
  const days = clampInt(params.days, 1, 30, 7);
  const db = getPool();

  try {
    const result = await db.query(
      `SELECT time::text, spot_id, sector, verdict, wind_kt, gust_kt, wind_dir, station_count,
              raw_wind_kt, boosted_by, boost_confidence
       FROM spot_scores
       WHERE ($1::text IS NULL OR spot_id = $1)
         AND time > NOW() - make_interval(days => $2)
       ORDER BY time DESC
       LIMIT 2000`,
      [spotId || null, days]
    );
    json(res, { count: result.rows.length, scores: result.rows }, 200, origin);
  } catch (err) {
    dbError(res, err, 'handleSpotScores', origin);
  }
}

// ── Webcam vision endpoint ────────────────────────────

async function handleWebcamVision(
  params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string
): Promise<void> {
  const db = getPool();
  const hours = clampInt(params.hours, 1, 48, 3);

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
    dbError(res, err, 'handleWebcamVision', origin);
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
    dbError(res, err, 'handleAnalyticsLightningHeatmap', origin);
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
    dbError(res, err, 'handleAnalyticsConvectionTrend', origin);
  }
}

async function handleAnalyticsUpperAir(
  params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  const sector = params.sector;
  if (!sector || (sector !== 'embalse' && sector !== 'rias')) {
    error(res, 'Missing or invalid parameter: sector (embalse or rias)', 400, origin); return;
  }
  // Hours, not a row cap: three pressure levels per hour means a row limit
  // would silently return a partial sounding, which reads as a real one.
  const hours = Math.min(168, Math.max(1, parseInt(params.hours || '48', 10) || 48));

  try {
    const levels = await queryUpperAir(sector, hours);
    json(res, { sector, hours, count: levels.length, levels }, 200, origin);
  } catch (err) {
    dbError(res, err, 'handleAnalyticsUpperAir', origin);
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
    dbError(res, err, 'handleAnalyticsAirQualityTrend', origin);
  }
}

/**
 * Spatial convection grid — CAPE/LI/CIN per cell over Galicia.
 *
 * Query params:
 *   - hourOffset: 0 (default = closest hour to now), 1..5 = future hours
 *
 * Response shape (compact tuples to keep payload small at 5km resolution):
 *   {
 *     forecastTime: "2026-05-03T14:00:00.000Z",
 *     fetchedAt:    "2026-05-03T13:32:11.000Z",
 *     resolutionKm: 10,
 *     peakCape: 1820, minLiftedIndex: -3.4, peakRisk: 6.2,
 *     cells: [{ lat, lon, cape, liftedIndex, cin, risk }, ...]
 *   }
 *
 * Cache 5min — the fetcher runs every 30min so 5min stale is acceptable
 * and cuts DB load when many users hit it simultaneously.
 */
async function handleAnalyticsConvectionGrid(
  params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  const hourOffset = Math.min(5, Math.max(0, parseInt(params.hourOffset || '0', 10) || 0));

  try {
    const result = await queryConvectionGrid(hourOffset);
    // Set cache header before sending
    res.setHeader('Cache-Control', 'public, max-age=300');
    json(res, { hourOffset, ...result }, 200, origin);
  } catch (err) {
    dbError(res, err, 'handleAnalyticsConvectionGrid', origin);
  }
}

/**
 * GET /api/v1/analytics/historical-baseline?station_id=X&metric=wind&days=30
 * Returns avg + p50/p75/p90 + max_gust from the `readings_hourly` CAGG.
 *
 * Powers the "Hoy vs media histórica" badge in SpotPopup. Browser caches
 * 1 h since baselines are slow-moving (rolling 30d window).
 */
async function handleAnalyticsHistoricalBaseline(
  params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  const stationId = params.station_id;
  if (!stationId || stationId.length > 100) {
    error(res, 'Missing or invalid station_id', 400, origin); return;
  }
  const allowed = ['wind', 'gust', 'temp', 'humidity'] as const;
  const metric = (allowed.includes(params.metric as typeof allowed[number])
    ? params.metric
    : 'wind') as 'wind' | 'gust' | 'temp' | 'humidity';
  const days = Math.min(365, Math.max(1, parseInt(params.days || '30', 10) || 30));

  try {
    const result = await queryHistoricalBaseline(stationId, metric, days);
    // 1 h cache — baselines move slow; reduces N×users → 1 query/window.
    res.setHeader('Cache-Control', 'public, max-age=3600');
    json(res, result, 200, origin);
  } catch (err) {
    dbError(res, err, 'handleAnalyticsHistoricalBaseline', origin);
  }
}

/**
 * GET /api/v1/magic-window/latest?sector=rias
 *
 * Returns the most recent magic window detection for the sector (defaults to
 * rias). Returns `{ active: false }` when no recent entry within the last 4h
 * or when the most recent has score < threshold. Frontend banner uses this
 * to decide whether to show the "no te lo pierdas" callout.
 *
 * Cache 30s — magic windows update every poll cycle (5 min) so 30s stale
 * isn't a problem and shields the DB from a hammered endpoint.
 */
async function handleMagicWindowLatest(
  params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  const sector = params.sector === 'embalse' ? 'embalse' : 'rias';
  try {
    const db = getPool();
    const result = await db.query<{
      time: Date; sector: string; score: number; summary: string; estimated_hours: number;
    }>(
      `SELECT time, sector, score, summary, estimated_hours
       FROM magic_windows
       WHERE sector = $1
         AND time > NOW() - INTERVAL '4 hours'
       ORDER BY time DESC LIMIT 1`,
      [sector],
    );
    res.setHeader('Cache-Control', 'public, max-age=30');
    if (result.rows.length === 0) {
      json(res, { active: false, sector }, 200, origin);
      return;
    }
    const row = result.rows[0];
    json(res, {
      active: true,
      sector: row.sector,
      score: row.score,
      summary: row.summary,
      estimatedHours: row.estimated_hours,
      detectedAt: row.time.toISOString(),
    }, 200, origin);
  } catch (err) {
    dbError(res, err, 'handleMagicWindowLatest', origin);
  }
}

// ── Fires with lightning attribution ───────────────────

/**
 * Fires of the last `days` annotated with the strikes that may have lit them.
 *
 * Reads `active_fires` (what the 24/7 fetcher has stored) rather than the live
 * FIRMS proxy: the attribution needs our lightning history anyway, and the
 * fetcher polls at the same ~1h cadence as the satellites publish.
 */
async function handleFires(
  params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string
): Promise<void> {
  const days = Math.min(Math.max(parseInt(params.days || '3', 10) || 3, 1), 30);
  try {
    const fires = await queryFireAttribution(days);
    json(res, {
      days,
      count: fires.length,
      attributedToLightning: fires.filter((f) => f.strikeCount > 0).length,
      fires,
    }, 200, origin);
  } catch (err) {
    dbError(res, err, 'handleFires', origin);
  }
}

// ── EFFIS named fire events ────────────────────────────

interface EffisEventRow {
  effis_id: string;
  fire_date: Date | null;
  last_update: Date | null;
  country: string | null;
  province: string | null;
  commune: string | null;
  area_ha: string | number | null;
  lat: string | number;
  lon: string | number;
  class: string | null;
  pct_natura: string | number | null;
}

/** NUMERIC columns come back from the pg driver as strings. */
function numOrNull(value: string | number | null): number | null {
  if (value === null) return null;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * GET /api/v1/fires/events?days=7[&galicia=1][&province=pontevedra]
 *
 * Grouped fire EVENTS from EFFIS — one row per fire, with commune, province
 * and burnt hectares. This is the antidote to the hotspot count: `/api/v1/fires`
 * returns satellite pixels (several per fire, several times a day), this
 * returns the fires themselves.
 *
 * Filters:
 *   days      1-365, default 7. Ordered by ignition, most recent first.
 *   galicia   `1`/`true` keeps only the four Galician provinces.
 *   province  free text, accent- and case-insensitive (`a coruna` == `A Coruña`).
 *
 * Province filtering happens in JS on purpose: matching accented names in SQL
 * would need `unaccent`, and the day window already bounds the result to a
 * handful of rows.
 *
 * Every response carries `attribution` — EFFIS is CC BY 4.0 and crediting the
 * European Union is a licence obligation, not a courtesy.
 */
async function handleFireEvents(
  params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  const days = Math.min(Math.max(parseInt(params.days || '7', 10) || 7, 1), 365);
  const galiciaOnly = params.galicia === '1' || params.galicia === 'true';
  // Bounded before it ever reaches a comparison — no reason to accept an essay.
  const provinceFilter = (params.province || '').slice(0, 60);
  const provinceKey = normalizeProvince(provinceFilter);

  try {
    const db = getPool();
    // COALESCE because fire_date is the only nullable date of the three:
    // an event with an unreadable ignition time is still recent news.
    const result = await db.query<EffisEventRow>(
      `SELECT effis_id, fire_date, last_update, country, province, commune,
              area_ha, lat, lon, "class", pct_natura
         FROM effis_fires
        WHERE COALESCE(fire_date, last_update, fetched_at) > NOW() - ($1 || ' days')::INTERVAL
        ORDER BY COALESCE(fire_date, last_update, fetched_at) DESC
        LIMIT 500`,
      [String(days)],
    );

    let events = result.rows.map((r) => ({
      id: r.effis_id,
      fireDate: r.fire_date ? new Date(r.fire_date).toISOString() : null,
      lastUpdate: r.last_update ? new Date(r.last_update).toISOString() : null,
      country: r.country,
      province: r.province,
      commune: r.commune,
      areaHa: numOrNull(r.area_ha),
      lat: numOrNull(r.lat) ?? 0,
      lon: numOrNull(r.lon) ?? 0,
      class: r.class,
      pctNatura: numOrNull(r.pct_natura),
      galicia: isGalicianProvince(r.province),
    }));

    if (galiciaOnly) events = events.filter((e) => e.galicia);
    if (provinceKey) events = events.filter((e) => normalizeProvince(e.province) === provinceKey);

    json(res, {
      days,
      province: provinceKey || null,
      galiciaOnly,
      count: events.length,
      galiciaCount: events.filter((e) => e.galicia).length,
      attribution: EFFIS_ATTRIBUTION,
      events,
    }, 200, origin);
  } catch (err) {
    // The table is applied by hand on the DB host, so "not there yet" is an
    // expected state rather than a fault: answer with an honest empty list so
    // the frontend renders nothing instead of an error.
    if ((err as { code?: string }).code === '42P01') {
      log.warn('[handleFireEvents] table `effis_fires` does not exist yet — serving an empty list');
      json(res, {
        days,
        province: provinceKey || null,
        galiciaOnly,
        count: 0,
        galiciaCount: 0,
        attribution: EFFIS_ATTRIBUTION,
        events: [],
      }, 200, origin);
      return;
    }
    dbError(res, err, 'handleFireEvents', origin);
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
  // Active fires + the lightning that may have started them (satellite hotspots)
  '/api/v1/fires': handleFires,
  // Grouped fire events with commune + burnt hectares (EFFIS)
  '/api/v1/fires/events': handleFireEvents,
  // ── Analytics (Phase 3) — pre-computed rollups from continuous aggregates ──
  '/api/v1/analytics/lightning-heatmap':  handleAnalyticsLightningHeatmap,
  '/api/v1/analytics/convection-trend':   handleAnalyticsConvectionTrend,
  '/api/v1/analytics/air-quality-trend':  handleAnalyticsAirQualityTrend,
  '/api/v1/analytics/convection-grid':    handleAnalyticsConvectionGrid,
  '/api/v1/analytics/historical-baseline': handleAnalyticsHistoricalBaseline,
  '/api/v1/analytics/upper-air':          handleAnalyticsUpperAir,
  // ── Magic Window (T2-2 S136+3+3) ──
  '/api/v1/magic-window/latest':          handleMagicWindowLatest,
  // ── Web Push (lightning-safety channel) ──
  '/api/v1/push/vapid-key':               handlePushVapidKey,
};

// ── Storm prediction POST handler ──────────────────────
// This endpoint feeds the ML calibration dataset (prediction_outcomes joins
// against it), so a drive-by curl could poison accuracy math. The legitimate
// caller is the anonymous frontend — no real secret is possible (anything in
// the bundle is public) — so the defense is depth, not authentication:
// same-origin gate + per-IP rate limit + strict value validation.

const STORM_POST_MAX = 12;                      // per IP per hour (frontend dedups to ~1/min max)
const STORM_POST_WINDOW_MS = 60 * 60_000;
const STORM_POST_MAX_BODY = 10 * 1024;          // 10 KB — real payloads are <1 KB
const STORM_SECTORS = new Set(['rias', 'embalse']);
const STORM_HORIZONS = new Set(['imminent', 'likely', 'possible', 'none']);
const STORM_SEVERITIES = new Set(['extreme', 'severe', 'moderate', 'none']);
const stormPostCounts = new Map<string, { count: number; resetAt: number }>();

async function handleStormPredictionPost(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  // Same-origin gate: browsers always send Origin on cross-context fetch;
  // requests without a whitelisted Origin (curl, scripts) are rejected.
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    res.writeHead(403, corsHeaders(origin));
    res.end(JSON.stringify({ error: 'Forbidden' }));
    return;
  }

  // Per-IP rate limit (same pattern as webcam upload)
  const ip = clientIpOf(req.headers, req.socket.remoteAddress);
  const now = Date.now();
  const bucket = stormPostCounts.get(ip);
  if (bucket && now < bucket.resetAt) {
    if (bucket.count >= STORM_POST_MAX) {
      res.writeHead(429, corsHeaders(origin));
      res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
      return;
    }
    bucket.count++;
  } else {
    stormPostCounts.set(ip, { count: 1, resetAt: now + STORM_POST_WINDOW_MS });
  }

  const declaredLength = parseInt(req.headers['content-length'] || '0', 10);
  if (declaredLength > STORM_POST_MAX_BODY) {
    res.writeHead(413, corsHeaders(origin));
    res.end(JSON.stringify({ error: 'Payload too large' }));
    return;
  }

  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    received += (chunk as Buffer).length;
    if (received > STORM_POST_MAX_BODY) {
      res.writeHead(413, corsHeaders(origin));
      res.end(JSON.stringify({ error: 'Payload too large' }));
      return;
    }
    chunks.push(chunk as Buffer);
  }
  let body: any;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    res.writeHead(400, corsHeaders(origin));
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  // Strict value validation — shape AND ranges (mirrors stormPredictionLogger.ts)
  const { sector, probability, horizon, severity, hasLightning, signals } = body;
  const validSignals = Array.isArray(signals) && signals.length <= 12
    && signals.every((v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1000));
  if (
    typeof sector !== 'string' || !STORM_SECTORS.has(sector)
    || typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 100
    || (horizon != null && (typeof horizon !== 'string' || !STORM_HORIZONS.has(horizon)))
    || (severity != null && (typeof severity !== 'string' || !STORM_SEVERITIES.has(severity)))
    || (hasLightning != null && typeof hasLightning !== 'boolean')
    || !validSignals
  ) {
    res.writeHead(400, corsHeaders(origin));
    res.end(JSON.stringify({ error: 'Invalid payload' }));
    return;
  }

  try {
    await getPool().query(
      // `date_trunc('minute', NOW())` rounds the timestamp down to the
      // nearest minute so two POSTs landing within the same minute (from
      // a frontend that re-rendered fast) collapse to a single primary key
      // value and the ON CONFLICT clause catches them. Before this, NOW()
      // returned microsecond-precision and two near-simultaneous inserts
      // ended up with distinct timestamps → both rows persisted, polluting
      // the DB with virtual duplicates that broke accuracy-rate math.
      `INSERT INTO storm_predictions (time, sector, probability, horizon, severity, has_lightning,
        signal_cape, signal_precip, signal_cloud, signal_lightning, signal_approach,
        signal_shadow, signal_gusts, signal_mg_warning, signal_sky_state)
       VALUES (date_trunc('minute', NOW()), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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

// ── Web Push endpoints (lightning-safety channel) ──────
// Subscribe / unsubscribe / self-test for the per-spot lightning push.
// Same defense-in-depth as the storm-predictions POST (no real secret is
// possible for an anonymous frontend): same-origin gate + per-IP rate limit
// + body-size cap + strict value validation. VAPID keys live in .env only;
// without them the whole feature degrades to 503, never a crash.

const PUSH_POST_MAX = 30;                       // per IP per hour — subscription changes are rare
const PUSH_POST_WINDOW_MS = 60 * 60_000;
const PUSH_POST_MAX_BODY = 8 * 1024;            // 8 KB — a real PushSubscription is <1 KB
const pushPostCounts = new Map<string, { count: number; resetAt: number }>();

// Every opted-in id must be a real curated spot (embalse + rias) so the
// table can never accumulate junk ids from a hand-crafted POST.
// Set<string> on purpose: the ids to validate arrive as plain strings from
// the wire; a Set<SpotId> would reject the .has(string) check at compile time.
const VALID_PUSH_SPOT_IDS = new Set<string>(
  (['embalse', 'rias'] as const).flatMap((s) => getSpotsForSector(s).map((x) => x.id)),
);

/**
 * Shared gate + body reader for the push POST routes. Returns the parsed
 * JSON body, or null when the response has already been written (403 origin,
 * 429 rate limit, 413 too large, 400 bad JSON).
 */
async function readPushPostBody(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  origin?: string,
): Promise<Record<string, unknown> | null> {
  // Same-origin gate: browsers always send Origin on cross-context fetch;
  // requests without a whitelisted Origin (curl, scripts) are rejected.
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    res.writeHead(403, corsHeaders(origin));
    res.end(JSON.stringify({ error: 'Forbidden' }));
    return null;
  }

  const ip = clientIpOf(req.headers, req.socket.remoteAddress);
  const now = Date.now();
  const bucket = pushPostCounts.get(ip);
  if (bucket && now < bucket.resetAt) {
    if (bucket.count >= PUSH_POST_MAX) {
      res.writeHead(429, corsHeaders(origin));
      res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
      return null;
    }
    bucket.count++;
  } else {
    pushPostCounts.set(ip, { count: 1, resetAt: now + PUSH_POST_WINDOW_MS });
  }

  const declaredLength = parseInt(req.headers['content-length'] || '0', 10);
  if (declaredLength > PUSH_POST_MAX_BODY) {
    res.writeHead(413, corsHeaders(origin));
    res.end(JSON.stringify({ error: 'Payload too large' }));
    return null;
  }

  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    received += (chunk as Buffer).length;
    if (received > PUSH_POST_MAX_BODY) {
      res.writeHead(413, corsHeaders(origin));
      res.end(JSON.stringify({ error: 'Payload too large' }));
      return null;
    }
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString());
    if (parsed == null || typeof parsed !== 'object') {
      res.writeHead(400, corsHeaders(origin));
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    res.writeHead(400, corsHeaders(origin));
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return null;
  }
}

/** GET /api/v1/push/vapid-key → { publicKey } (503 when push is disabled). */
async function handlePushVapidKey(
  _params: Record<string, string>,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  const publicKey = getVapidPublicKey();
  if (!publicKey) {
    error(res, 'push disabled', 503, origin);
    return;
  }
  json(res, { publicKey }, 200, origin);
}

/** Upper bound on stored subscriptions. Real subscribers are a few dozen;
 *  the cap only exists so junk cannot grow the dispatch loop without limit. */
const PUSH_SUBSCRIPTIONS_MAX = 5000;

/** POST /api/v1/push/subscribe → upsert { subscription, spotIds }. */
async function handlePushSubscribe(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  const body = await readPushPostBody(req, res, origin);
  if (body == null) return;

  const subscription = body.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
  const endpoint = subscription?.endpoint;
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  const spotIds = body.spotIds;

  const validKeys = typeof p256dh === 'string' && p256dh.length > 0 && p256dh.length <= 300
    && typeof auth === 'string' && auth.length > 0 && auth.length <= 300;
  const validSpots = Array.isArray(spotIds) && spotIds.length <= 20
    && spotIds.every((id: unknown) => typeof id === 'string' && VALID_PUSH_SPOT_IDS.has(id));

  if (!isAllowedPushEndpoint(endpoint) || !validKeys || !validSpots) {
    error(res, 'Invalid payload', 400, origin);
    return;
  }

  try {
    // A NEW endpoint only gets in while there is room; an existing one may
    // always refresh itself, so a full table never locks out real browsers.
    const room = await getPool().query<{ n: number; known: boolean }>(
      `SELECT COUNT(*)::int AS n,
              BOOL_OR(endpoint = $1) AS known
       FROM push_subscriptions`,
      [endpoint],
    );
    if (room.rows[0].n >= PUSH_SUBSCRIPTIONS_MAX && !room.rows[0].known) {
      log.warn(`[Push] subscription store full (${room.rows[0].n}); refusing new endpoint`);
      error(res, 'push capacity reached', 503, origin);
      return;
    }
    // Re-subscribing (or editing the spot list) refreshes the crypto keys
    // and resets the failure streak — the browser just proved it is alive.
    await getPool().query(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, spot_ids)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE
         SET p256dh = EXCLUDED.p256dh,
             auth = EXCLUDED.auth,
             spot_ids = EXCLUDED.spot_ids,
             fail_count = 0`,
      [endpoint, p256dh, auth, spotIds],
    );
    json(res, { ok: true }, 201, origin);
  } catch (err) {
    log.error('[Push] subscribe insert error:', (err as Error).message);
    error(res, 'DB error', 500, origin);
  }
}

/** POST /api/v1/push/unsubscribe → delete by endpoint (idempotent). */
async function handlePushUnsubscribe(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  const body = await readPushPostBody(req, res, origin);
  if (body == null) return;

  const endpoint = body.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 1000) {
    error(res, 'Invalid payload', 400, origin);
    return;
  }

  try {
    await getPool().query(
      'DELETE FROM push_subscriptions WHERE endpoint = $1',
      [endpoint],
    );
    json(res, { ok: true }, 200, origin);
  } catch (err) {
    log.error('[Push] unsubscribe error:', (err as Error).message);
    error(res, 'DB error', 500, origin);
  }
}

/** POST /api/v1/push/test → one self-test notification to an endpoint the
 *  user already registered (guarded 1/min per endpoint inside the dispatcher). */
async function handlePushTest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  origin?: string,
): Promise<void> {
  const body = await readPushPostBody(req, res, origin);
  if (body == null) return;

  const endpoint = body.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 1000) {
    error(res, 'Invalid payload', 400, origin);
    return;
  }

  const result = await sendTestPush(endpoint);
  switch (result) {
    case 'sent':
      json(res, { ok: true }, 200, origin);
      break;
    case 'disabled':
      error(res, 'push disabled', 503, origin);
      break;
    case 'not-found':
      error(res, 'Subscription not found', 404, origin);
      break;
    case 'rate-limited':
      error(res, 'Rate limit exceeded (1/min)', 429, origin);
      break;
    default:
      error(res, 'Delivery failed', 502, origin);
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
    } else if (url.pathname === '/api/v1/push/subscribe') {
      await handlePushSubscribe(req, res, origin);
    } else if (url.pathname === '/api/v1/push/unsubscribe') {
      await handlePushUnsubscribe(req, res, origin);
    } else if (url.pathname === '/api/v1/push/test') {
      await handlePushTest(req, res, origin);
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
    if (pathname === '/api/v1/metar') {
      await handleMetarProxy(res, origin);
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

  // Push channel heartbeat: "[Push] enabled, N subscriptions" (the disabled
  // case already warned once at module load). Never blocks startup.
  void logPushStartup();

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
