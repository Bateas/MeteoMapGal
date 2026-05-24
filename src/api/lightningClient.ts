import type { LightningStrike } from '../types/lightning';

/**
 * MeteoGalicia meteo2api lightning endpoint.
 * Returns individual cloud-to-ground strikes with lat/lon/timestamp.
 *
 * - `lenda` endpoint: last 24 h of strikes (positive + negative polarity).
 * - Auth: public-tier JWT embedded in MeteoGalicia's Angular app (api_manager_key).
 * - Proxy via Vite `/meteo2api` → `https://apis-ext.xunta.gal/meteo2api`.
 *
 * Source: MeteoGalicia / Xunta de Galicia (CC BY-SA 4.0)
 */

const RAIOS_LENDA_URL = '/meteo2api/v1/api/raios/lenda';

/**
 * Public-tier API key (WSO2 API Manager JWT).
 * Extracted from MeteoGalicia's production Angular bundle — it is NOT a secret.
 * Tier: "Public", application: "w_meteo2", owner: "admin".
 * Loaded from .env for easy rotation; falls back to embedded key.
 */
const API_KEY = import.meta.env.VITE_LIGHTNING_API_KEY ??
  'eyJ4NXQiOiJObUU1TXpSbVpXSmtNREZtT1RJeFlqWTFNRE00TmpnM1pqVmlOR0k1WkdZM09HTXpPVEJsTURNelpUQmhOalJtWVdJNE9HUmpOR1ZpTldKak1qZGpZUSIsImtpZCI6ImdhdGV3YXlfY2VydGlmaWNhdGVfYWxpYXMiLCJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhZG1pbkBjYXJib24uc3VwZXIiLCJhcHBsaWNhdGlvbiI6eyJvd25lciI6ImFkbWluIiwidGllclF1b3RhVHlwZSI6bnVsbCwidGllciI6IlVubGltaXRlZCIsIm5hbWUiOiJ3X21ldGVvMiIsImlkIjozMzAxLCJ1dWlkIjoiMmNhMDI4N2ItNWYzYy00NGMzLTg3ZGEtOWY5ODg3NWZjNjk5In0sImlzcyI6Imh0dHBzOlwvXC9wcmQtd3NvMmFwaW0tYzAxLTAwMDEueHVudGEubG9jYWw6OTQ0NFwvb2F1dGgyXC90b2tlbiIsInRpZXJJbmZvIjp7IlB1YmxpYyI6eyJ0aWVyUXVvdGFUeXBlIjoicmVxdWVzdENvdW50IiwiZ3JhcGhRTE1heENvbXBsZXhpdHkiOjAsImdyYXBoUUxNYXhEZXB0aCI6MCwic3RvcE9uUXVvdGFSZWFjaCI6dHJ1ZSwic3Bpa2VBcnJlc3RMaW1pdCI6MCwic3Bpa2VBcnJlc3RVbml0Ijoic2VjIn19LCJrZXl0eXBlIjoiUFJPRFVDVElPTiIsInBlcm1pdHRlZFJlZmVyZXIiOiIiLCJzdWJzY3JpYmVkQVBJcyI6W3sic3Vic2NyaWJlclRlbmFudERvbWFpbiI6ImNhcmJvbi5zdXBlciIsIm5hbWUiOiJNRVRFTzJfQVBJIiwiY29udGV4dCI6IlwvbWV0ZW8yYXBpXC92MSIsInB1Ymxpc2hlciI6IkFNVEVHQVwvdWUwODIwNSIsInZlcnNpb24iOiJ2MSIsInN1YnNjcmlwdGlvblRpZXIiOiJQdWJsaWMifV0sInBlcm1pdHRlZElQIjoiIiwiaWF0IjoxNjk0MDk1MzMzLCJqdGkiOiI1NzkwYmM5NC04M2Y2LTQ4YTgtODg3Yy02MmQyNDJiMTJmZDYifQ==.W9Uc6D5te5GhMcWb-ewkiuor8rpNX5S3P89LSvrewNxNffwkQ5LC47OiSIwx0NOhZ9YKSiOf0i5L2MDjA8Roezp1xkPzC1Cx6ESkuTaXtIgu0iP4mUo6pCmwywWLhDO7_fz58k6PnPAYyehQ6R8r85nEx3Wr9F9e1u-WZx2zGTFGpqvTU9jFA1d4rlcTjTK7eGuIFSbQn6goko8elKFe3GajzGy8r6NtJLMvSgxhSpftsykx-tpGyoUVVH90dTiEul927JiYvqgOsCKa4FU1tVVY3Y9t8AJByJqsOeTz64R7KIe9A8C2WB29IewjKxDkrsypFODpOQHkIbEDhZ5g8Q==';

// ── API response types ──────────────────────────────────────────

interface RaioStrike {
  /** "DD-MM-YYYY HH:MM" (UTC) */
  date: string;
  latitude: number;
  longitude: number;
  /** Peak current in kA */
  peakCurrent: number;
  /** Municipality ID (-1 = outside Galicia) */
  idCityHall: number;
  /** Age/color code for map display */
  delaySymbol: number;
}

interface RaiosResponse {
  raiosPosit: RaioStrike[];
  raiosNegat: RaioStrike[];
  numTotalRaios: number;
  numTotalRaiosGalicia: number;
  numTotalRaiosIntra: number | null;
}

// ── Cache ────────────────────────────────────────────────────────

let cache: { data: LightningStrike[]; fetchedAt: number } | null = null;
/** Cache TTL for quiet conditions (no recent nearby strikes). */
const CACHE_TTL_NORMAL_MS = 2 * 60 * 1000;
/** Cache TTL when a storm is active (recent strikes < 15 min ago, < 80 km).
 *  Shorter TTL = fresher data during the moments that matter, with the
 *  trade-off being more MG API calls during storms (which is exactly when
 *  the user needs the up-to-date map). */
const CACHE_TTL_STORM_MS = 30 * 1000;

// Circuit breaker — meteo2api falla a veces (5xx upstream, 401 si rotan token).
// Sin breaker, cada poll cada N min sigue golpeando el endpoint que está
// caído, generando ruido en F12 + carga inútil. Tras un fallo, freeze 3min;
// se sirve cache stale o array vacío en ese tiempo.
let lightningRateLimitedUntil = 0;
const LIGHTNING_COOLDOWN_MS = 3 * 60_000;

// ── TZ debug — exposed via window.__meteomapDebug.lightning() ─────────
// Captures the first raw date string from each MG response so we can
// verify from F12 whether MG actually sends UTC (as the parser assumes)
// or Madrid local time (which would silently filter strikes for ~2 h
// because their ageMinutes would be negative).
interface LightningParseDebug {
  rawDateFromMG: string;
  parsedAsISO: string;
  inMadridLocal: string;
  ageMinutesIfUTC: number;
  ageMinutesIfMadridLocal: number;
  expectedAgeIfUTCCorrect: 'fresh strike (~0-10 min)' | 'negative — strike in future' | 'large positive — already old';
  conclusion: string;
}
let __lastLightningSample: { rawDate: string; parsedMs: number; capturedAt: number } | null = null;

/**
 * Inspect from F12 console:
 *   `__meteomapDebug.lightning()` → object with raw vs parsed comparison.
 *
 * If `ageMinutesIfUTC` is around 0-15 → MG sends UTC, parser is correct.
 * If it's around -120 (=summer CEST offset) → MG sends Madrid local time,
 * parser is wrong by 2 h, strikes are being silently filtered as "future".
 */
export function getLightningParseDebug(): LightningParseDebug | null {
  if (!__lastLightningSample) return null;
  const d = new Date(__lastLightningSample.parsedMs);
  const now = Date.now();
  const ageIfUTC = Math.round((now - __lastLightningSample.parsedMs) / 60_000);
  // If MG actually sends Madrid local but we parse as UTC, the "real" UTC
  // timestamp is 1-2 h earlier (CET/CEST), so age would be that much larger.
  // We approximate +120 min (summer CEST = UTC+2).
  const ageIfMadridLocal = ageIfUTC + 120;
  let conclusion: string;
  if (ageIfUTC < -10) {
    conclusion = '🚨 BUG: MG envía Madrid local, parser está mal — strikes en futuro se filtran';
  } else if (ageIfUTC > 0 && ageIfUTC < 30) {
    conclusion = '✅ OK: parser UTC correcto, strikes recientes con edad razonable';
  } else {
    conclusion = `⚠️ ambiguo: edad ${ageIfUTC} min, esperar más samples o storm activo`;
  }
  return {
    rawDateFromMG: __lastLightningSample.rawDate,
    parsedAsISO: d.toISOString(),
    inMadridLocal: d.toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }),
    ageMinutesIfUTC: ageIfUTC,
    ageMinutesIfMadridLocal: ageIfMadridLocal,
    expectedAgeIfUTCCorrect: ageIfUTC < -10
      ? 'negative — strike in future'
      : ageIfUTC > 120
        ? 'large positive — already old'
        : 'fresh strike (~0-10 min)',
    conclusion,
  };
}

// ── Parsing ──────────────────────────────────────────────────────

/** Parse MeteoGalicia date format "DD-MM-YYYY HH:MM" → unix ms (UTC) */
function parseRaioDate(dateStr: string): number {
  // "27-02-2026 14:35" → Date
  const [datePart, timePart] = dateStr.split(' ');
  const [day, month, year] = datePart.split('-');
  const [hours, minutes] = timePart.split(':');
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
  );
}

/** Convert raw API strikes to our normalized LightningStrike format */
function parseStrikes(
  positives: RaioStrike[],
  negatives: RaioStrike[],
  now: number,
): LightningStrike[] {
  let idCounter = 0;

  const mapStrike = (s: RaioStrike): LightningStrike => {
    const timestamp = parseRaioDate(s.date);
    return {
      id: ++idCounter,
      lat: s.latitude,
      lon: s.longitude,
      timestamp,
      peakCurrent: s.peakCurrent,
      cloudToCloud: false, // meteo2api only returns cloud-to-ground
      multiplicity: 1,     // not provided by this API
      ageMinutes: Math.round((now - timestamp) / 60_000),
    };
  };

  const strikes = [
    ...positives.map(mapStrike),
    ...negatives.map(mapStrike),
  ];

  // Sort newest first
  strikes.sort((a, b) => b.timestamp - a.timestamp);

  // Stash a sample for the TZ debug helper. We use the newest strike (post-sort)
  // because that's the most informative for "are fresh strikes really fresh".
  if (strikes.length > 0) {
    // We need the RAW date string of the newest strike. Index into positives/negatives
    // by matching timestamp (only one will match).
    const newestTs = strikes[0].timestamp;
    const allRaw = [...positives, ...negatives];
    const matching = allRaw.find((r) => parseRaioDate(r.date) === newestTs);
    if (matching) {
      __lastLightningSample = {
        rawDate: matching.date,
        parsedMs: newestTs,
        capturedAt: now,
      };
    }
  }

  return strikes;
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Fetch lightning strikes from the last 24 hours.
 * Uses MeteoGalicia's `raios/lenda` endpoint.
 * Returns parsed LightningStrike[] sorted by timestamp (newest first).
 *
 * `opts.stormActive` shortens the cache TTL from 2 min to 30 s — used during
 * active storms (recent nearby strikes) so the user sees fresh strikes ASAP.
 */
export async function fetchLightningStrikes(
  opts: { stormActive?: boolean } = {},
): Promise<LightningStrike[]> {
  const ttl = opts.stormActive ? CACHE_TTL_STORM_MS : CACHE_TTL_NORMAL_MS;
  // Return cached data if fresh enough
  if (cache && Date.now() - cache.fetchedAt < ttl) {
    return recomputeAges(cache.data);
  }

  // Circuit breaker — if upstream just failed, don't hammer it again.
  // Serve stale cache if we have it; otherwise empty.
  if (Date.now() < lightningRateLimitedUntil) {
    return cache ? recomputeAges(cache.data) : [];
  }

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // MeteoGalicia convention: fechaInicio = newer date, fechaFin = older date
  const params = new URLSearchParams({
    fechaInicio: now.toISOString(),
    fechaFin: yesterday.toISOString(),
  });

  const url = `${RAIOS_LENDA_URL}?${params}`;

  try {
    const res = await fetch(url, {
      headers: {
        apikey: API_KEY,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Lightning API ${res.status}`);

    const data: RaiosResponse = await res.json();
    const nowMs = Date.now();

    const strikes = parseStrikes(
      data.raiosPosit || [],
      data.raiosNegat || [],
      nowMs,
    );

    console.debug(
      `[Lightning] ${strikes.length} strikes (${data.numTotalRaiosGalicia ?? 0} in Galicia, ${data.numTotalRaiosIntra ?? 0} intra-cloud)`,
    );

    cache = { data: strikes, fetchedAt: nowMs };
    lightningRateLimitedUntil = 0; // success clears the breaker
    return strikes;
  } catch (err) {
    // Trip the breaker for COOLDOWN_MS and demote log to debug — every poll
    // re-attempting the same dead upstream just spammed F12 console.error.
    lightningRateLimitedUntil = Date.now() + LIGHTNING_COOLDOWN_MS;
    console.debug('[Lightning] Fetch error (cooldown 3min):', err);
    if (cache) return recomputeAges(cache.data);
    return [];
  }
}

/** Recompute ageMinutes from cached timestamps */
function recomputeAges(strikes: LightningStrike[]): LightningStrike[] {
  const now = Date.now();
  return strikes.map((s) => ({
    ...s,
    ageMinutes: Math.round((now - s.timestamp) / 60_000),
  }));
}

/**
 * Haversine distance in km between two points.
 */
export function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
