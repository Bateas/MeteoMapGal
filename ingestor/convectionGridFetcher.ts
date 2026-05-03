/**
 * Convection grid fetcher — S132.
 *
 * Pulls Open-Meteo CAPE/CIN/LI/BLH for every cell of a regular grid over
 * Galicia, computes per-cell risk score, and persists a row per
 * (forecast_time, cell) in `convection_grid_hourly`.
 *
 * Why this lives in the ingestor instead of the frontend:
 *   - Open-Meteo's free tier counts each coordinate as 1 API call against
 *     the burst limit (~600/min). At 5km the grid is ~2256 cells — a single
 *     browser fetch instantly tripped 429 across the whole IP. Server-side
 *     a single IP serves all users, and we control the cadence centrally.
 *   - Persisting the snapshot lets the frontend GET ~20KB once instead of
 *     issuing 12 batched Open-Meteo calls per session.
 *   - Future: enables historical analysis ("how often did convergence in
 *     Castrelo de Miño produce hail?" — requires the per-cell history).
 *
 * Pure functions are duplicated here from `src/services/spatialGridService.ts`
 * and `src/services/convectionGridService.ts` to avoid setting up a monorepo.
 * If they ever diverge, the source-of-truth is the frontend file (since the
 * grid definition is what the user sees on the map). Tests in
 * `convectionGridFetcher.test.ts` cover the parsing and risk-score logic.
 */

import { getPool } from './db.js';
import { log } from './logger.js';

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const FETCH_TIMEOUT_MS = 12_000;

// ── Grid definition (mirrors src/services/spatialGridService.ts) ─────

export interface GridDef {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  resolutionKm: number;
}

export interface GridCell {
  i: number;  // row index (south → north)
  j: number;  // col index (west → east)
  lat: number;
  lon: number;
}

/**
 * Same bbox as the frontend grid. Resolution starts at 10km — we'll bump to
 * 5km after a week of stable production runs (validates DB volume + the IP
 * isn't being rate-limited).
 */
export const GALICIA_GRID: GridDef = {
  latMin: 41.7,
  latMax: 43.8,
  lonMin: -9.4,
  lonMax: -6.5,
  resolutionKm: 10,
};

export function generateGridCells(def: GridDef): GridCell[] {
  const meanLat = (def.latMin + def.latMax) / 2;
  const latStep = def.resolutionKm / 111.32;
  const lonStep = def.resolutionKm / (111.32 * Math.cos((meanLat * Math.PI) / 180));

  const nLat = Math.max(2, Math.ceil((def.latMax - def.latMin) / latStep) + 1);
  const nLon = Math.max(2, Math.ceil((def.lonMax - def.lonMin) / lonStep) + 1);

  const cells: GridCell[] = [];
  for (let i = 0; i < nLat; i++) {
    const lat = def.latMin + i * latStep;
    if (lat > def.latMax + latStep / 2) break;
    for (let j = 0; j < nLon; j++) {
      const lon = def.lonMin + j * lonStep;
      if (lon > def.lonMax + lonStep / 2) break;
      cells.push({ i, j, lat, lon });
    }
  }
  return cells;
}

// ── Risk scoring (mirrors src/services/convectionGridService.ts) ────

/**
 * CAPE × max(0, -LI) / 1000, clamped 0-100.
 * Returns 0 if either is missing, CAPE < 200, or LI >= 0.
 */
export function convectionRiskScore(cape: number | null, li: number | null): number {
  if (cape == null || li == null) return 0;
  if (cape < 200) return 0;
  if (li > 0) return 0;
  const raw = (cape * -li) / 1000;
  return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
}

// ── Open-Meteo fetch ────────────────────────────────────────────────

const HOURLY_VARS = [
  'cape',
  'lifted_index',
  'convective_inhibition',
  'boundary_layer_height',
] as const;

const FORECAST_HORIZON_HOURS = 6;
const MAX_COORDS_PER_CALL = 200;
const BATCH_DELAY_MS = 3000;

interface BatchResponse {
  /** Always an array — Open-Meteo returns array shape for multi-point queries */
  hourly?: { time: string[]; [k: string]: unknown };
  [k: string]: unknown;
}

interface CellHourly {
  cell: GridCell;
  hourly: BatchResponse['hourly'] | null;
}

async function fetchBatch(batch: GridCell[]): Promise<CellHourly[]> {
  const params = new URLSearchParams({
    latitude: batch.map((c) => c.lat.toFixed(4)).join(','),
    longitude: batch.map((c) => c.lon.toFixed(4)).join(','),
    hourly: HOURLY_VARS.join(','),
    forecast_hours: String(FORECAST_HORIZON_HOURS),
    timezone: 'UTC',
  });

  try {
    const res = await fetch(`${OPEN_METEO_URL}?${params}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      log.warn(`[ConvGrid] Open-Meteo ${res.status} for batch of ${batch.length} cells`);
      return batch.map((cell) => ({ cell, hourly: null }));
    }
    const json = await res.json();
    // Multi-point response: array, same order as input coords
    if (Array.isArray(json)) {
      return batch.map((cell, idx) => ({
        cell,
        hourly: (json[idx] as BatchResponse | undefined)?.hourly ?? null,
      }));
    }
    // Single-point fallback (when batch.length === 1)
    if (json && typeof json === 'object') {
      return [{ cell: batch[0], hourly: (json as BatchResponse).hourly ?? null }];
    }
    return batch.map((cell) => ({ cell, hourly: null }));
  } catch (err) {
    log.warn(`[ConvGrid] batch fetch failed: ${(err as Error).message}`);
    return batch.map((cell) => ({ cell, hourly: null }));
  }
}

async function fetchAllCells(cells: GridCell[]): Promise<CellHourly[]> {
  const out: CellHourly[] = [];
  for (let i = 0; i < cells.length; i += MAX_COORDS_PER_CALL) {
    if (i > 0) await sleep(BATCH_DELAY_MS);
    const batch = cells.slice(i, i + MAX_COORDS_PER_CALL);
    const r = await fetchBatch(batch);
    out.push(...r);
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Parsing → DB rows ───────────────────────────────────────────────

export interface ConvectionGridRow {
  time: Date;
  cellI: number;
  cellJ: number;
  lat: number;
  lon: number;
  cape: number | null;
  liftedIndex: number | null;
  cin: number | null;
  boundaryLayerM: number | null;
  risk: number;
}

function readNumOrNull(arr: unknown, idx: number): number | null {
  if (!Array.isArray(arr)) return null;
  const v = arr[idx];
  return typeof v === 'number' ? v : null;
}

/**
 * Convert Open-Meteo per-cell response into one row per (cell, forecast_time).
 * Pure — exported for tests.
 */
export function parseGridResponses(responses: CellHourly[]): ConvectionGridRow[] {
  const rows: ConvectionGridRow[] = [];
  for (const r of responses) {
    if (!r.hourly || !Array.isArray(r.hourly.time)) continue;
    const times = r.hourly.time;
    for (let h = 0; h < times.length; h++) {
      const t = new Date(times[h]);
      if (Number.isNaN(t.getTime())) continue;
      const cape = readNumOrNull(r.hourly.cape, h);
      const li   = readNumOrNull(r.hourly.lifted_index, h);
      const cin  = readNumOrNull(r.hourly.convective_inhibition, h);
      const blh  = readNumOrNull(r.hourly.boundary_layer_height, h);
      // Skip cells where everything's null (saves DB write bandwidth)
      if (cape == null && li == null && cin == null && blh == null) continue;
      rows.push({
        time: t,
        cellI: r.cell.i,
        cellJ: r.cell.j,
        lat: r.cell.lat,
        lon: r.cell.lon,
        cape, liftedIndex: li, cin, boundaryLayerM: blh,
        risk: convectionRiskScore(cape, li),
      });
    }
  }
  return rows;
}

// ── DB persist ──────────────────────────────────────────────────────

/**
 * Bulk insert with ON CONFLICT DO UPDATE. The PK is (time, cell_i, cell_j) so
 * the same forecast hour gets refreshed when the next 30min run produces a
 * better estimate (Open-Meteo refines past hours as the model run advances).
 *
 * To keep the param count manageable when N rows is large (5km grid × 6h ≈
 * 13K rows per cycle), we chunk inserts at 500 rows each (= 5500 params, well
 * under PG's 65535 limit).
 */
async function batchInsertRows(rows: ConvectionGridRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const db = getPool();
  const now = new Date();
  const CHUNK = 500;
  let totalInserted = 0;

  for (let start = 0; start < rows.length; start += CHUNK) {
    const slice = rows.slice(start, start + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    for (const r of slice) {
      values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
      params.push(
        r.time, now, r.cellI, r.cellJ, r.lat, r.lon,
        r.cape, r.liftedIndex, r.cin, r.boundaryLayerM, r.risk,
      );
    }
    const sql = `
      INSERT INTO convection_grid_hourly
        (time, fetched_at, cell_i, cell_j, lat, lon, cape, lifted_index, cin, boundary_layer_m, risk)
      VALUES ${values.join(', ')}
      ON CONFLICT (time, cell_i, cell_j) DO UPDATE
        SET fetched_at       = EXCLUDED.fetched_at,
            cape             = EXCLUDED.cape,
            lifted_index     = EXCLUDED.lifted_index,
            cin              = EXCLUDED.cin,
            boundary_layer_m = EXCLUDED.boundary_layer_m,
            risk             = EXCLUDED.risk
    `;
    try {
      const r = await db.query(sql, params);
      totalInserted += r.rowCount ?? 0;
    } catch (err) {
      log.error(`[ConvGrid] insert chunk ${start}-${start + slice.length}: ${(err as Error).message}`);
    }
  }
  return totalInserted;
}

// ── Public entry ────────────────────────────────────────────────────

/**
 * One full convection grid cycle:
 *   1. Generate cell list from GALICIA_GRID
 *   2. Fetch Open-Meteo in batches of 200 coords with 3s spacing
 *   3. Parse per-cell responses into rows
 *   4. Bulk insert with ON CONFLICT DO UPDATE
 */
export async function runConvectionGridCycle(): Promise<void> {
  const cells = generateGridCells(GALICIA_GRID);
  log.info(`[ConvGrid] Starting cycle: ${cells.length} cells, resolution ${GALICIA_GRID.resolutionKm}km`);

  const responses = await fetchAllCells(cells);
  const validResponses = responses.filter((r) => r.hourly != null).length;
  if (validResponses === 0) {
    log.warn(`[ConvGrid] cycle aborted — 0/${cells.length} cells returned data (Open-Meteo down or rate-limited)`);
    return;
  }

  const rows = parseGridResponses(responses);
  const written = await batchInsertRows(rows);
  log.info(
    `[ConvGrid] cycle ok — ${validResponses}/${cells.length} cells, ${rows.length} rows parsed, ${written} written`,
  );
}
