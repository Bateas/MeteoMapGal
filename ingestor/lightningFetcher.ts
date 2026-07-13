/**
 * Lightning fetcher.
 *
 * Mirrors the frontend `src/api/lightningClient.ts` but writes every observed
 * strike into the `lightning_strikes` hypertable on TimescaleDB. Runs 24/7
 * in the ingestor regardless of whether anyone has the web app open.
 *
 * Why persist raw strikes:
 * - Frontend keeps ~60min in memory, then forgets.
 * - `storm_predictions` only logs `has_lightning bool`, no coordinates.
 * - Without lat/lon/time history, we cannot:
 *     1. Build a heatmap of "where does lightning hit most?"
 *     2. Correlate strikes with upper-level wind / front passage.
 *     3. Calibrate the storm predictor against real ground truth.
 *
 * Dedup is automatic via the PK (time, lat, lon) + ON CONFLICT DO NOTHING.
 */

import { getPool } from './db.js';
import { log } from './logger.js';
import {
  isOpen as isLightningBreakerOpen,
  reportFailure as reportLightningFailure,
  reportSuccess as reportLightningSuccess,
} from './lightningBreaker.js';

const RAIOS_LENDA_URL = 'https://apis-ext.xunta.gal/meteo2api/v1/api/raios/lenda';
const FETCH_TIMEOUT_MS = 15_000;

// Public-tier API key (WSO2 API Manager JWT). Same as frontend — extracted from
// MeteoGalicia's production Angular bundle, NOT a private credential. Configurable
// via env for rotation.
const API_KEY = process.env.LIGHTNING_API_KEY ??
  'eyJ4NXQiOiJObUU1TXpSbVpXSmtNREZtT1RJeFlqWTFNRE00TmpnM1pqVmlOR0k1WkdZM09HTXpPVEJsTURNelpUQmhOalJtWVdJNE9HUmpOR1ZpTldKak1qZGpZUSIsImtpZCI6ImdhdGV3YXlfY2VydGlmaWNhdGVfYWxpYXMiLCJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhZG1pbkBjYXJib24uc3VwZXIiLCJhcHBsaWNhdGlvbiI6eyJvd25lciI6ImFkbWluIiwidGllclF1b3RhVHlwZSI6bnVsbCwidGllciI6IlVubGltaXRlZCIsIm5hbWUiOiJ3X21ldGVvMiIsImlkIjozMzAxLCJ1dWlkIjoiMmNhMDI4N2ItNWYzYy00NGMzLTg3ZGEtOWY5ODg3NWZjNjk5In0sImlzcyI6Imh0dHBzOlwvXC9wcmQtd3NvMmFwaW0tYzAxLTAwMDEueHVudGEubG9jYWw6OTQ0NFwvb2F1dGgyXC90b2tlbiIsInRpZXJJbmZvIjp7IlB1YmxpYyI6eyJ0aWVyUXVvdGFUeXBlIjoicmVxdWVzdENvdW50IiwiZ3JhcGhRTE1heENvbXBsZXhpdHkiOjAsImdyYXBoUUxNYXhEZXB0aCI6MCwic3RvcE9uUXVvdGFSZWFjaCI6dHJ1ZSwic3Bpa2VBcnJlc3RMaW1pdCI6MCwic3Bpa2VBcnJlc3RVbml0Ijoic2VjIn19LCJrZXl0eXBlIjoiUFJPRFVDVElPTiIsInBlcm1pdHRlZFJlZmVyZXIiOiIiLCJzdWJzY3JpYmVkQVBJcyI6W3sic3Vic2NyaWJlclRlbmFudERvbWFpbiI6ImNhcmJvbi5zdXBlciIsIm5hbWUiOiJNRVRFTzJfQVBJIiwiY29udGV4dCI6IlwvbWV0ZW8yYXBpXC92MSIsInB1Ymxpc2hlciI6IkFNVEVHQVwvdWUwODIwNSIsInZlcnNpb24iOiJ2MSIsInN1YnNjcmlwdGlvblRpZXIiOiJQdWJsaWMifV0sInBlcm1pdHRlZElQIjoiIiwiaWF0IjoxNjk0MDk1MzMzLCJqdGkiOiI1NzkwYmM5NC04M2Y2LTQ4YTgtODg3Yy02MmQyNDJiMTJmZDYifQ==.W9Uc6D5te5GhMcWb-ewkiuor8rpNX5S3P89LSvrewNxNffwkQ5LC47OiSIwx0NOhZ9YKSiOf0i5L2MDjA8Roezp1xkPzC1Cx6ESkuTaXtIgu0iP4mUo6pCmwywWLhDO7_fz58k6PnPAYyehQ6R8r85nEx3Wr9F9e1u-WZx2zGTFGpqvTU9jFA1d4rlcTjTK7eGuIFSbQn6goko8elKFe3GajzGy8r6NtJLMvSgxhSpftsykx-tpGyoUVVH90dTiEul927JiYvqgOsCKa4FU1tVVY3Y9t8AJByJqsOeTz64R7KIe9A8C2WB29IewjKxDkrsypFODpOQHkIbEDhZ5g8Q==';

// ── Types ─────────────────────────────────────────────

interface RaioStrike {
  /** "DD-MM-YYYY HH:MM" UTC */
  date: string;
  latitude: number;
  longitude: number;
  /** Peak current in kA */
  peakCurrent: number;
  idCityHall: number;
  delaySymbol: number;
}

interface RaiosResponse {
  raiosPosit: RaioStrike[];
  raiosNegat: RaioStrike[];
  numTotalRaios: number;
  numTotalRaiosGalicia: number;
  numTotalRaiosIntra: number | null;
}

export interface PersistedStrike {
  time: Date;
  lat: number;
  lon: number;
  peakCurrent: number;
  cloudToCloud: boolean;
  multiplicity: number;
  /** Inside the Galicia + relevant-buffer bbox (see GALICIA_SCOPE). */
  isGalicia: boolean;
}

/**
 * Geographic scope for "relevant" lightning. meteo2api returns strikes for
 * the whole NW Iberian peninsula; ~32% (audited 2026-05-14) fall outside the
 * area that actually affects Galician weather (Castilla interior, deep
 * Portugal, Asturias). We KEEP those rows (storm-approach analysis may want
 * them) but flag them so the predictor / analyzer can calibrate on
 * `WHERE is_galicia = TRUE` only.
 *
 * Bbox rationale:
 *   N 44.5  — Estaca de Bares + ~20km buffer
 *   S 41.5  — northern Portugal down to Aveiro
 *   W -10.5 — ~100km offshore Atlantic (catch oceanic fronts before landfall)
 *   E -6.0  — Ourense interior + León/Zamora border. Wider than the strict
 *             Galicia edge (-6.5) on purpose: an eastern storm at -6.3°W can
 *             move into Ourense within an hour, so the tracker needs to see
 *             it coming. The Macizo Galaico blocks most, but not all.
 */
export const GALICIA_SCOPE = {
  north: 44.5,
  south: 41.5,
  west: -10.5,
  east: -6.0,
} as const;

/** True if a strike is within the Galicia-relevant bbox. Pure + testable. */
export function isInGaliciaScope(lat: number, lon: number): boolean {
  return (
    lat >= GALICIA_SCOPE.south &&
    lat <= GALICIA_SCOPE.north &&
    lon >= GALICIA_SCOPE.west &&
    lon <= GALICIA_SCOPE.east
  );
}

// ── Pure parsing (testable in isolation) ─────────────

/** Parse meteo2api date "DD-MM-YYYY HH:MM" → unix milliseconds (UTC) */
export function parseRaioDate(dateStr: string): number {
  const [datePart, timePart] = dateStr.split(' ');
  if (!datePart || !timePart) return NaN;
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

/**
 * Map raw API strikes to the persisted shape. Negative-polarity strikes get
 * `peakCurrent` flipped to negative so polarity is preserved in storage.
 */
export function mapStrikesForPersist(
  positives: RaioStrike[],
  negatives: RaioStrike[],
): PersistedStrike[] {
  const out: PersistedStrike[] = [];
  const make = (s: RaioStrike, signedCurrent: number): PersistedStrike | null => {
    const ts = parseRaioDate(s.date);
    if (!Number.isFinite(ts) || !Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) {
      return null;
    }
    return {
      time: new Date(ts),
      lat: s.latitude,
      lon: s.longitude,
      peakCurrent: signedCurrent,
      cloudToCloud: false, // meteo2api lenda is cloud-to-ground only
      multiplicity: 1,
      isGalicia: isInGaliciaScope(s.latitude, s.longitude),
    };
  };

  for (const s of positives) {
    const m = make(s, Math.abs(s.peakCurrent));
    if (m) out.push(m);
  }
  for (const s of negatives) {
    const m = make(s, -Math.abs(s.peakCurrent));
    if (m) out.push(m);
  }
  return out;
}

// ── Fetcher ───────────────────────────────────────────

async function fetchRaios(): Promise<RaiosResponse | null> {
  // During a sustained meteo2api outage, skip the fetch silently instead of
  // hammering the dead endpoint and logging a WARN every 5-min cycle.
  if (isLightningBreakerOpen()) return null;

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  // meteo2api convention: fechaInicio = newer, fechaFin = older
  const params = new URLSearchParams({
    fechaInicio: now.toISOString(),
    fechaFin: yesterday.toISOString(),
  });
  const url = `${RAIOS_LENDA_URL}?${params}`;
  try {
    const res = await fetch(url, {
      headers: { apikey: API_KEY, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      reportLightningFailure(`API ${res.status}`);
      log.warn(`[Lightning] API ${res.status}`);
      return null;
    }
    reportLightningSuccess();
    return await res.json();
  } catch (err) {
    reportLightningFailure((err as Error).message);
    log.warn(`[Lightning] fetch failed: ${(err as Error).message}`);
    return null;
  }
}

// ── DB persist ────────────────────────────────────────

async function batchInsertStrikes(strikes: PersistedStrike[]): Promise<number> {
  if (strikes.length === 0) return 0;
  const db = getPool();

  // Multi-row INSERT with ON CONFLICT DO NOTHING (PK-based dedup)
  const values: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  for (const s of strikes) {
    values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
    params.push(s.time, s.lat, s.lon, s.peakCurrent, s.cloudToCloud, s.multiplicity, s.isGalicia);
  }

  const sql = `
    INSERT INTO lightning_strikes (time, lat, lon, peak_current, cloud_to_cloud, multiplicity, is_galicia)
    VALUES ${values.join(', ')}
    ON CONFLICT (time, lat, lon) DO NOTHING
  `;

  try {
    const result = await db.query(sql, params);
    return result.rowCount ?? 0;
  } catch (err) {
    log.error(`[Lightning] DB insert failed: ${(err as Error).message}`);
    return 0;
  }
}

// ── Public entry ──────────────────────────────────────

/**
 * One poll cycle: fetch last 24h of strikes from meteo2api → dedup → persist.
 * The 24h window means each poll re-fetches strikes we already have; PK
 * conflict makes that a cheap no-op. Net new rows ≈ strikes since last poll.
 */
export async function runLightningCycle(): Promise<void> {
  const data = await fetchRaios();
  if (!data) return;

  const strikes = mapStrikesForPersist(
    data.raiosPosit || [],
    data.raiosNegat || [],
  );
  if (strikes.length === 0) {
    log.debug(`[Lightning] poll ok — 0 strikes in window`);
    return;
  }

  const inserted = await batchInsertStrikes(strikes);
  const inScope = strikes.filter((s) => s.isGalicia).length;
  log.info(
    `[Lightning] poll ok — ${strikes.length} returned by API (${inScope} in Galicia scope, ${strikes.length - inScope} buffer), ${inserted} new rows persisted`,
  );
}
