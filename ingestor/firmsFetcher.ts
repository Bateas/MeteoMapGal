/**
 * NASA FIRMS active-fires fetcher.
 *
 * Persists every wildfire hotspot returned by the FIRMS VIIRS NRT pipelines
 * (S-NPP + NOAA-20, see FIRMS_PRODUCTS) into the `active_fires` hypertable.
 * Independent of the HTTP proxy (`handleFirmsProxy`) — that path serves data
 * to the browser; this path is the historical-dataset writer.
 *
 * Why a separate fetcher (not piggy-backing the proxy):
 *   - Proxy fires only when a user opens the web app.
 *   - The dataset must accumulate 24/7 regardless of traffic.
 *   - Insert errors here shouldn't poison the proxy's response.
 *
 * WHY WE STORE RAW (changed after the 2026-07-27 fire-layer audit):
 * this fetcher used to run `filterRealFires()` BEFORE the INSERT, so anything
 * the display filter rejected was destroyed forever. `filterRealFires` is a
 * display heuristic that gets retuned as we learn — at the time of the audit
 * it was a flat `confidence != 'low' AND bright_ti4 >= 320K`, and measured on
 * the live Europe feed for this bbox that day it kept 88% of daytime
 * detections but only 48% of night ones (night median bright_ti4 315.8K, p10
 * 297.9K): a nocturnal blind spot, not the "industrial heat" discriminator it
 * claimed to be. FIRMS also documents confidence='low' as sun glint / thermal
 * anomaly below the 15K detection margin — NOT "too cold to be a fire";
 * low-confidence rows in the public feed routinely carry tens of MW of FRP.
 *
 * A historical archive that pre-applies today's opinion can never be
 * re-analysed with tomorrow's — and every retune of the heuristic would
 * silently change what history means. So: persist everything inside the bbox,
 * and record in `passes_display_filter` whether `filterRealFires` AS IT STOOD
 * AT INGEST TIME accepted the row. That reproduces "what the user saw"
 * without losing the rest.
 *
 * Cadence: 60min (set in index.ts). Matches FIRMS NRT latency (~1h), so a
 * faster poll would just re-read the same hotspots. Volume in Galicia: 0-50
 * rows/day typical, 500+/day during big fire season.
 *
 * Reuses the pure parser from `src/services/fireService.ts` so the wire
 * format definition lives in ONE place — no copy-paste drift.
 */

import { getPool } from './db.js';
import { log } from './logger.js';
import { parseFirmsCsv, filterRealFires, FIRMS_PRODUCTS, mergeFirmsCsv } from '../src/services/fireService.js';

const FIRMS_API_KEY = process.env.FIRMS_API_KEY || '';
const FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';

/**
 * Bbox `west,south,east,north` — Galicia + the fire-relevant surroundings.
 *
 * Widened on 2026-07-27 from `-10.0,41.5,-6.0,44.0`. Measured cost on the
 * public VIIRS Europe 24h feeds that same day (a heavy northern-Portugal fire
 * day, both platforms merged):
 *   - old box            ->  98 detections, 2127 MW total FRP
 *   - south edge to 41.0 -> 133 detections (+35, +36%), 4006 MW
 *   - south edge to 40.8 -> 133 detections (identical: nothing today between
 *                           40.8 and 41.0 — the margin is free insurance)
 *   - south edge to 40.5 -> 166 detections (+68) — rejected, that is Coimbra
 *                           latitude and its smoke does not reach the rias
 *   - west -10.5 / north 44.5 (aligning with the lightning bbox) -> +0 rows,
 *                           pure ocean, so alignment is free
 * The 35 extra detections all sit 100-150 km from Vigo (1879 MW combined,
 * peak 236 MW): close enough that their smoke reaches the rias on a southerly,
 * which is exactly the call the app has to make. ~35 extra rows/day worst case
 * is ~13k rows/year, well under 2 MB — the cheapest possible coverage.
 *
 * Now aligned with the lightning bbox (N 44.5 / W -10.5 / E -6.0) so the
 * strike-to-fire attribution join is not silently clipped on one side; the
 * southern edge stays deeper (40.8) because fires travel with smoke while the
 * lightning that matters for Galician weather does not come from that far
 * south.
 */
const FIRMS_BBOX = '-10.5,40.8,-6.0,44.5';
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
  // Both VIIRS platforms in parallel — see FIRMS_PRODUCTS. A platform that
  // fails only costs us its own overpasses; the other still lands.
  const results = await Promise.all(
    FIRMS_PRODUCTS.map(async (product) => {
      const url = `${FIRMS_BASE}/${FIRMS_API_KEY}/${product}/${FIRMS_BBOX}/${FETCH_DAYS}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) {
          log.warn(`[FIRMS Fetcher] ${product} upstream ${res.status}`);
          return null;
        }
        return await res.text();
      } catch (err) {
        log.warn(`[FIRMS Fetcher] ${product} failed: ${(err as Error).message}`);
        return null;
      }
    }),
  );
  return mergeFirmsCsv(results) || null;
}

// ── Raw CSV context columns ───────────────────────────

/**
 * Per-detection columns the shared `ActiveFire` type deliberately drops.
 *
 * `ActiveFire` is a *display* type (what the map needs); the archive needs
 * more. Rather than duplicating the parse semantics of `parseFirmsCsv`, this
 * reads only the leftovers and joins them back by the same row identity.
 * Why each one is worth a column forever:
 *   - scan/track: the ground footprint of the pixel in km. VIIRS is 375m at
 *     nadir but stretches near the swath edge, so a big fire lights up several
 *     contiguous pixels. Without the footprint there is no honest way to
 *     collapse "N pixels" into "1 fire" after the fact.
 *   - bright_ti5: the 11um channel. The ti4-ti5 spread is the actual fire vs
 *     warm-background discriminator — far better than the flat 320K cut, and
 *     it cannot be recomputed later if we never stored it.
 *   - version: FIRMS collection/algorithm tag ('2.0NRT'). NASA reprocesses NRT
 *     into standard-quality products; without this we cannot tell which
 *     algorithm produced a historical row.
 *   - instrument: 'VIIRS' today, but MODIS/other sensors may be added.
 *   - confidenceRaw: the untouched token. The shared `parseConfidence` only
 *     understands the single letters h/n/l and silently maps anything else to
 *     'low'; the bulk feeds are known to spell them out. Keeping the raw token
 *     means a format change degrades the display, never the archive.
 */
export interface FirmsExtras {
  scan: number | null;
  track: number | null;
  brightTi5: number | null;
  version: string | null;
  instrument: string | null;
  confidenceRaw: string | null;
}

const num = (v: string | undefined): number | null => {
  if (v == null) return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const str = (v: string | undefined): string | null => {
  const s = v?.trim();
  return s ? s : null;
};

/**
 * Index the raw CSV by detection identity so `runFirmsCycle` can attach the
 * context columns to each parsed `ActiveFire`.
 *
 * Columns are located BY HEADER NAME, not by fixed position: the Area-API CSV
 * carries an `instrument` column that the public bulk feeds omit, so a
 * positional read would silently shift every field after it. Missing columns
 * simply come back null.
 *
 * The key must match `${ActiveFire.id}_${satellite}` exactly — `firmsFetcher`
 * looks rows up with that string. `firmsExtrasKeyMatchesActiveFire` in the
 * test suite locks the two together, so if the shared id format ever changes
 * the build fails loudly instead of persisting nulls.
 */
export function parseFirmsExtras(csv: string): Map<string, FirmsExtras> {
  const out = new Map<string, FirmsExtras>();
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return out;

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iLat = col('latitude');
  const iLon = col('longitude');
  const iDate = col('acq_date');
  const iTime = col('acq_time');
  const iSat = col('satellite');
  // Identity columns are mandatory — without them there is nothing to join on.
  if (iLat < 0 || iLon < 0 || iDate < 0 || iTime < 0 || iSat < 0) return out;

  const iScan = col('scan');
  const iTrack = col('track');
  const iTi5 = col('bright_ti5');
  const iVersion = col('version');
  const iInstrument = col('instrument');
  const iConfidence = col('confidence');

  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    const lat = Number.parseFloat(c[iLat]);
    const lon = Number.parseFloat(c[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const date = c[iDate]?.trim();
    const time = c[iTime]?.trim();
    const sat = c[iSat]?.trim();
    if (!date || !time || !sat) continue;

    // Same identity string parseFirmsCsv builds, plus the satellite so the two
    // platforms can never collide on a shared timestamp.
    const key = `${lat.toFixed(5)}_${lon.toFixed(5)}_${date}_${time.padStart(4, '0')}_${sat}`;
    out.set(key, {
      scan: iScan >= 0 ? num(c[iScan]) : null,
      track: iTrack >= 0 ? num(c[iTrack]) : null,
      brightTi5: iTi5 >= 0 ? num(c[iTi5]) : null,
      version: iVersion >= 0 ? str(c[iVersion]) : null,
      instrument: iInstrument >= 0 ? str(c[iInstrument]) : null,
      confidenceRaw: iConfidence >= 0 ? str(c[iConfidence]) : null,
    });
  }
  return out;
}

// ── DB persist ────────────────────────────────────────

export interface PersistedFire {
  time: Date;
  lat: number;
  lon: number;
  satellite: string;
  brightness: number | null;
  frp: number | null;
  confidence: 'low' | 'nominal' | 'high';
  daynight: 'D' | 'N';
  scan: number | null;
  track: number | null;
  brightTi5: number | null;
  version: string | null;
  instrument: string | null;
  confidenceRaw: string | null;
  /** Whether the display filter in force at ingest time accepted this row. */
  passesDisplayFilter: boolean;
}

const INSERT_COLS = 15;

/**
 * Collapse rows that share the PK within a single batch.
 *
 * Postgres aborts the WHOLE statement with "ON CONFLICT DO UPDATE command
 * cannot affect row a second time" if the VALUES list repeats a conflict key —
 * unlike the previous DO NOTHING, which tolerated it. One duplicated detection
 * (the merged CSV concatenates two platform responses) would therefore cost us
 * every row of that cycle. First occurrence wins: duplicates are the same
 * satellite observation, so they carry identical values anyway.
 */
export function dedupeByPrimaryKey(fires: PersistedFire[]): PersistedFire[] {
  const seen = new Map<string, PersistedFire>();
  for (const f of fires) {
    const key = `${f.time.getTime()}_${f.lat}_${f.lon}_${f.satellite}`;
    if (!seen.has(key)) seen.set(key, f);
  }
  return [...seen.values()];
}

/**
 * Rows per statement. Postgres caps a prepared statement at 65535 bind
 * parameters; at 15 params/row that is 4369 rows, and now that nothing is
 * filtered before the INSERT a bad fire season in Iberia can plausibly reach
 * it — at which point the whole cycle would be lost, silently, exactly when
 * the data matters most. Chunking also means one failing chunk doesn't take
 * the others with it.
 */
const MAX_ROWS_PER_INSERT = 2000;

async function insertChunk(fires: PersistedFire[]): Promise<number> {
  const db = getPool();

  const values: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  for (const f of fires) {
    const slots: string[] = [];
    for (let i = 0; i < INSERT_COLS; i++) slots.push(`$${p++}`);
    values.push(`(${slots.join(', ')})`);
    params.push(
      f.time, f.lat, f.lon, f.satellite, f.brightness, f.frp, f.confidence, f.daynight,
      f.scan, f.track, f.brightTi5, f.version, f.instrument, f.confidenceRaw, f.passesDisplayFilter,
    );
  }

  // The PK dedups across the overlapping 24h windows of consecutive polls.
  // DO UPDATE (rather than DO NOTHING) exists only to backfill rows written
  // before the raw-columns migration: `passes_display_filter` is NOT NULL for
  // anything this code writes, so the WHERE clause makes the update a one-shot
  // per legacy row instead of a rewrite on every cycle. Core observation
  // values are never touched — same PK means the same satellite observation.
  const sql = `
    INSERT INTO active_fires
      (time, lat, lon, satellite, brightness, frp, confidence, daynight,
       scan, track, bright_ti5, version, instrument, confidence_raw, passes_display_filter)
    VALUES ${values.join(', ')}
    ON CONFLICT (time, lat, lon, satellite) DO UPDATE SET
      scan                  = EXCLUDED.scan,
      track                 = EXCLUDED.track,
      bright_ti5            = EXCLUDED.bright_ti5,
      version               = EXCLUDED.version,
      instrument            = EXCLUDED.instrument,
      confidence_raw        = EXCLUDED.confidence_raw,
      passes_display_filter = EXCLUDED.passes_display_filter
    WHERE active_fires.passes_display_filter IS NULL
  `;

  try {
    const result = await db.query(sql, params);
    return result.rowCount ?? 0;
  } catch (err) {
    log.error(`[FIRMS Fetcher] DB insert failed: ${(err as Error).message}`);
    return 0;
  }
}

async function batchInsertFires(input: PersistedFire[]): Promise<number> {
  const fires = dedupeByPrimaryKey(input);
  if (fires.length === 0) return 0;

  let written = 0;
  for (let i = 0; i < fires.length; i += MAX_ROWS_PER_INSERT) {
    written += await insertChunk(fires.slice(i, i + MAX_ROWS_PER_INSERT));
  }
  return written;
}

// ── Public entry ──────────────────────────────────────

/**
 * One poll cycle: fetch FIRMS CSV -> persist EVERY detection in the bbox
 * (see the "why we store raw" note at the top) -> dedup via the PK on
 * `(time, lat, lon, satellite)`. Observations of the same physical fire from
 * both S-NPP and NOAA-20 are kept on purpose: two independent looks at one
 * fire are data, and collapsing them is a display decision that belongs
 * downstream, not in the archive.
 */
export async function runFirmsCycle(): Promise<void> {
  const csv = await fetchFirmsCsv();
  if (csv === null) return;

  const allFires = parseFirmsCsv(csv);
  const extras = parseFirmsExtras(csv);
  // Object-identity Set: `filterRealFires` returns the very same objects, so
  // membership is exact and can never drift from the shared filter's logic.
  const displayed = new Set(filterRealFires(allFires));

  const fires = allFires.map<PersistedFire>((f) => {
    const x = extras.get(`${f.id}_${f.satellite}`);
    return {
      time: f.acquiredAt,
      lat: f.lat,
      lon: f.lon,
      satellite: f.satellite,
      brightness: f.brightness,
      frp: f.frp,
      confidence: f.confidence,
      daynight: f.daynight,
      scan: x?.scan ?? null,
      track: x?.track ?? null,
      brightTi5: x?.brightTi5 ?? null,
      version: x?.version ?? null,
      instrument: x?.instrument ?? null,
      confidenceRaw: x?.confidenceRaw ?? null,
      passesDisplayFilter: displayed.has(f),
    };
  });

  const displayCount = displayed.size;

  if (fires.length === 0) {
    // Heartbeat even on an empty window: a fetcher that only logs when
    // something burns is indistinguishable from a dead one.
    log.info('[FIRMS Fetcher] poll ok — 0 detections in window');
    return;
  }

  const written = await batchInsertFires(fires);
  log.info(
    `[FIRMS Fetcher] poll ok — ${fires.length} detections stored raw ` +
      `(${displayCount} pass display filter), ${written} rows written`,
  );
}
