/**
 * Spatial grid service — generic infrastructure for multi-point weather queries.
 *
 * Built originally for the convection-risk overlay (CAPE/LI heatmap) but
 * intentionally generic so future overlays can reuse it: fog grid (humidity +
 * dew point per cell), upper-air grid (winds at 850/700/500 hPa per cell),
 * UV-index grid, AQ grid, etc.
 *
 * Why a grid at all (S126+1+1 motivation):
 *   Until now CAPE/LI/CIN was queried at TWO points (sector centers — Embalse
 *   + Rías). That tells us "does the sector have storm potential?" but NOT
 *   "WHERE inside Galicia will it form?". Apr 27 hailstorm hit Castrelo de
 *   Miño specifically (Faro de Vigo article) — a per-zone grid would have
 *   shown that hot spot 6h ahead of MeteoGalicia's province-wide YELLOW alert.
 *
 * Open-Meteo accepts multi-point queries (comma-separated lat/lon up to 1000
 * coords per call). We split larger grids into batches.
 */

// ── Geometry ─────────────────────────────────────────────

export interface GridDef {
  /** South latitude bound (inclusive) */
  latMin: number;
  /** North latitude bound (inclusive) */
  latMax: number;
  /** West longitude bound (inclusive) */
  lonMin: number;
  /** East longitude bound (inclusive) */
  lonMax: number;
  /** Resolution in km — applied uniformly to lat & lon (lon spacing
   *  adjusted by cos(meanLat) so the grid stays roughly square on the map). */
  resolutionKm: number;
}

export interface GridCell {
  /** Row index from south to north */
  i: number;
  /** Column index from west to east */
  j: number;
  /** Cell center latitude */
  lat: number;
  /** Cell center longitude */
  lon: number;
}

/**
 * Galicia + neighboring buffer. Captures storms forming over Portugal Norte
 * or Asturias west that may drift in. ~5 km cells = 47 × 48 ≈ 2256 points,
 * which Open-Meteo serves in 2-3 batches.
 */
export const GALICIA_GRID: GridDef = {
  latMin: 41.7,
  latMax: 43.8,
  lonMin: -9.4,
  lonMax: -6.5,
  resolutionKm: 5,
};

/**
 * Generate the regular grid of cell centers for a given definition.
 * Pure / deterministic — same def yields same cells.
 *
 * The lon step is corrected for latitude so cells are ~square on the map
 * (otherwise high-latitude cells would be tall+narrow). We use the mean
 * latitude of the grid to keep it simple — for Galicia the variation across
 * 2° lat changes cos by ~3 %, negligible at 5 km.
 */
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

/**
 * Cell key — stable identifier for caching and lookups.
 * Format: "i,j" (compact, sortable).
 */
export function cellKey(cell: { i: number; j: number }): string {
  return `${cell.i},${cell.j}`;
}

// ── Open-Meteo multi-point fetcher ───────────────────────

/**
 * Maximum coordinates per Open-Meteo call (per the API docs).
 * Larger grids are split into batches.
 */
const MAX_COORDS_PER_CALL = 1000;

/** Delay between sequential batches to be polite (Open-Meteo free tier). */
const BATCH_DELAY_MS = 1000;

interface FetchOpts {
  /** Open-Meteo `hourly=` variables (comma-joined into the URL) */
  hourly?: string[];
  /** Open-Meteo `current=` variables */
  current?: string[];
  /** Past hours to fetch (default 0 — only forecast) */
  pastHours?: number;
  /** Forecast hours (default 6 — 6h ahead) */
  forecastHours?: number;
  /** Wind speed unit (Open-Meteo default is km/h) */
  windSpeedUnit?: 'ms' | 'kmh' | 'kn' | 'mph';
  /** Open-Meteo timezone (default UTC for predictable parsing) */
  timezone?: string;
  /** Abort signal (forwarded to fetch) */
  signal?: AbortSignal;
}

/** Single parsed entry — Open-Meteo response slice for one cell. */
export interface GridCellResponse {
  cell: GridCell;
  /** Raw hourly object from Open-Meteo (or null if request failed) */
  hourly: Record<string, unknown> | null;
  /** Raw current object from Open-Meteo (or null) */
  current: Record<string, unknown> | null;
}

/**
 * Fetch Open-Meteo data for a list of cells.
 *
 * Splits into batches when cell count > MAX_COORDS_PER_CALL.
 * Returns one entry per cell in the same order as input.
 *
 * On HTTP error or batch failure the corresponding cells get `hourly=null` —
 * caller should handle missing data.
 */
export async function fetchGridForecast(
  cells: GridCell[],
  opts: FetchOpts,
): Promise<GridCellResponse[]> {
  if (cells.length === 0) return [];

  const batches: GridCell[][] = [];
  for (let i = 0; i < cells.length; i += MAX_COORDS_PER_CALL) {
    batches.push(cells.slice(i, i + MAX_COORDS_PER_CALL));
  }

  const results: GridCellResponse[] = [];
  for (let b = 0; b < batches.length; b++) {
    if (b > 0) await sleep(BATCH_DELAY_MS);
    const batch = batches[b];
    const batchResult = await fetchBatch(batch, opts);
    results.push(...batchResult);
  }
  return results;
}

async function fetchBatch(
  batch: GridCell[],
  opts: FetchOpts,
): Promise<GridCellResponse[]> {
  const params = new URLSearchParams({
    latitude: batch.map((c) => c.lat.toFixed(4)).join(','),
    longitude: batch.map((c) => c.lon.toFixed(4)).join(','),
    timezone: opts.timezone ?? 'UTC',
  });
  if (opts.hourly) params.set('hourly', opts.hourly.join(','));
  if (opts.current) params.set('current', opts.current.join(','));
  if (opts.pastHours != null) params.set('past_hours', String(opts.pastHours));
  if (opts.forecastHours != null) params.set('forecast_hours', String(opts.forecastHours));
  if (opts.windSpeedUnit) params.set('wind_speed_unit', opts.windSpeedUnit);

  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      signal: opts.signal,
    });
    if (!res.ok) {
      // Treat the whole batch as failed — every cell gets null
      return batch.map((cell) => ({ cell, hourly: null, current: null }));
    }
    const json = await res.json();
    return parseBatchResponse(batch, json);
  } catch {
    return batch.map((cell) => ({ cell, hourly: null, current: null }));
  }
}

/**
 * Open-Meteo returns either a single object (1 coord) or an ARRAY of objects
 * (multi-coord). Normalize both shapes into one entry per cell.
 */
function parseBatchResponse(batch: GridCell[], json: unknown): GridCellResponse[] {
  // Multi-point response: array of objects in same order as input coords
  if (Array.isArray(json)) {
    return batch.map((cell, idx) => {
      const entry = json[idx] as { hourly?: Record<string, unknown>; current?: Record<string, unknown> } | undefined;
      return {
        cell,
        hourly: entry?.hourly ?? null,
        current: entry?.current ?? null,
      };
    });
  }
  // Single-point response (only when batch.length === 1)
  if (json && typeof json === 'object') {
    const entry = json as { hourly?: Record<string, unknown>; current?: Record<string, unknown> };
    return [
      {
        cell: batch[0],
        hourly: entry.hourly ?? null,
        current: entry.current ?? null,
      },
    ];
  }
  return batch.map((cell) => ({ cell, hourly: null, current: null }));
}

// ── Helpers ──────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Estimate cell count for a grid def — useful for bound-checking before
 * issuing API calls (e.g. warn if we'd burn too many requests).
 */
export function estimateCellCount(def: GridDef): number {
  return generateGridCells(def).length;
}
