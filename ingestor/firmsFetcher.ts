/**
 * NASA FIRMS active-fires fetcher (S126 Phase 1b TIER 2).
 *
 * Persists every wildfire hotspot returned by the FIRMS VIIRS S-NPP NRT
 * pipeline into the `active_fires` hypertable. Independent of the HTTP proxy
 * (`handleFirmsProxy`) — that path serves data to the browser; this path is
 * the historical-dataset writer.
 *
 * Why a separate fetcher (not piggy-backing the proxy):
 *   - Proxy fires only when a user opens the web app.
 *   - The dataset must accumulate 24/7 regardless of traffic.
 *   - Insert errors here shouldn't poison the proxy's response.
 *
 * Cadence: 30min. Matches FIRMS NRT latency (~60min satellite pass) so we
 * never miss a pass without piling on. Volume in Galicia: 0-50/day typical,
 * 500+/day during big fire season.
 *
 * Reuses the pure parser from `src/services/fireService.ts` so the wire
 * format definition lives in ONE place — no copy-paste drift.
 */

import { getPool } from './db.js';
import { log } from './logger.js';
import { parseFirmsCsv, filterRealFires } from '../src/services/fireService.js';

const FIRMS_API_KEY = process.env.FIRMS_API_KEY || '';
const FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
// Galicia + buffer (Asturias W + Norte Portugal — fires often cross borders)
const FIRMS_BBOX = '-10.0,41.5,-6.0,44.0';
const FETCH_TIMEOUT_MS = 12_000;
// past_days=1 means "last 24h". FIRMS supports up to 5; we keep tight to 1
// since dedup is cheap and we don't want stale rows competing for refresh.
const FETCH_DAYS = 1;

// ── Fetch ─────────────────────────────────────────────

async function fetchFirmsCsv(): Promise<string | null> {
  if (!FIRMS_API_KEY) {
    log.warn('[FIRMS Fetcher] FIRMS_API_KEY not set — skipping');
    return null;
  }
  const url = `${FIRMS_BASE}/${FIRMS_API_KEY}/VIIRS_SNPP_NRT/${FIRMS_BBOX}/${FETCH_DAYS}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      log.warn(`[FIRMS Fetcher] upstream ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    log.warn(`[FIRMS Fetcher] fetch failed: ${(err as Error).message}`);
    return null;
  }
}

// ── DB persist ────────────────────────────────────────

interface PersistedFire {
  time: Date;
  lat: number;
  lon: number;
  satellite: string;
  brightness: number | null;
  frp: number | null;
  confidence: 'low' | 'nominal' | 'high';
  daynight: 'D' | 'N';
}

async function batchInsertFires(fires: PersistedFire[]): Promise<number> {
  if (fires.length === 0) return 0;
  const db = getPool();

  const values: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  for (const f of fires) {
    values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
    params.push(f.time, f.lat, f.lon, f.satellite, f.brightness, f.frp, f.confidence, f.daynight);
  }

  const sql = `
    INSERT INTO active_fires
      (time, lat, lon, satellite, brightness, frp, confidence, daynight)
    VALUES ${values.join(', ')}
    ON CONFLICT (time, lat, lon, satellite) DO NOTHING
  `;

  try {
    const result = await db.query(sql, params);
    return result.rowCount ?? 0;
  } catch (err) {
    log.error(`[FIRMS Fetcher] DB insert failed: ${(err as Error).message}`);
    return 0;
  }
}

// ── Public entry ──────────────────────────────────────

/**
 * One poll cycle: fetch FIRMS CSV → filter low-confidence/cool detections
 * → persist with dedup. The PK on `(time, lat, lon, satellite)` does the
 * dedup; observations from BOTH SNPP and NOAA-20 of the same physical fire
 * are kept (different satellites = different timestamps anyway).
 */
export async function runFirmsCycle(): Promise<void> {
  const csv = await fetchFirmsCsv();
  if (csv === null) return;

  const allFires = parseFirmsCsv(csv);
  // Apply same filter as the frontend overlay — dropping confidence='low'
  // and cool detections (industrial heat <320K). Keeps the historical
  // dataset honest: real wildfires only.
  const fires = filterRealFires(allFires).map<PersistedFire>((f) => ({
    time: f.acquiredAt,
    lat: f.lat,
    lon: f.lon,
    satellite: f.satellite,
    brightness: f.brightness,
    frp: f.frp,
    confidence: f.confidence,
    daynight: f.daynight,
  }));

  if (fires.length === 0) {
    log.info(`[FIRMS Fetcher] poll ok — 0 valid fires in window (${allFires.length} raw, all filtered out)`);
    return;
  }

  const inserted = await batchInsertFires(fires);
  log.info(
    `[FIRMS Fetcher] poll ok — ${allFires.length} returned, ${fires.length} after filter, ${inserted} new rows persisted`,
  );
}
