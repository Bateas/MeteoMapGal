/**
 * Convection grid service — spatial CAPE/LI/CIN over Galicia.
 *
 * Produces per-cell convective potential so the user can see WHERE in
 * Galicia storms are likely to form (vs the current "average for the
 * sector" data which can't tell you Castrelo de Miño from O Carballiño).
 *
 * Built on `spatialGridService` so the same grid infrastructure can power
 * other phenomena (fog grid, upper-air grid, etc.) without re-doing the
 * Open-Meteo batching logic.
 *
 * Variables fetched per cell:
 *   - cape (J/kg) — surface-based convective available potential energy
 *   - lifted_index (°C) — < -2 unstable, < -5 severe
 *   - convective_inhibition (J/kg) — cap that suppresses convection
 *   - boundary_layer_height (m) — mixing depth, lower = harder to break cap
 *
 * Risk score (per cell):
 *   risk = clamp(CAPE × max(0, -LI) / 1000, 0, 100)
 *
 * The product of CAPE and (-LI) is the standard meteorological proxy for
 * "this is where storms WILL form if there's any trigger". Pure values:
 *   - 1000 J/kg × LI=0   = 0     (CAPE present but no trigger likelihood)
 *   - 1000 J/kg × LI=-2  = 2000  (modest)
 *   - 2000 J/kg × LI=-4  = 8000  (high — granizo posible territory)
 *   - 3000 J/kg × LI=-6  = 18000 (extreme)
 *
 * We then divide by 1000 and clamp 0-100 for an intensity scale that maps
 * cleanly onto a heatmap weight.
 */
import { GALICIA_GRID, generateGridCells, fetchGridForecast, type GridCell } from './spatialGridService';

// ── Types ────────────────────────────────────────────────

export interface ConvectionGridPoint {
  lat: number;
  lon: number;
  /** Surface-based CAPE (J/kg) — null when missing */
  cape: number | null;
  /** Lifted Index (°C) — null when missing */
  liftedIndex: number | null;
  /** Convective inhibition (J/kg, positive value) */
  cin: number | null;
  /** Boundary layer height (m) */
  boundaryLayerM: number | null;
  /** Computed risk score 0-100 (CAPE × -LI / 1000, clamped). 0 if CAPE/LI missing. */
  risk: number;
}

export interface ConvectionGridSnapshot {
  /** Time the grid was fetched (epoch ms) */
  fetchedAt: number;
  /** ISO timestamp of the forecast hour the data refers to */
  forecastTime: string | null;
  /** All cells with their values. Stable order: row-major (south→north, west→east). */
  cells: ConvectionGridPoint[];
  /** Peak CAPE across the whole grid */
  peakCape: number;
  /** Min lifted index */
  minLiftedIndex: number;
  /** Max risk score */
  peakRisk: number;
}

// ── Variables fetched ────────────────────────────────────

const CONVECTION_VARIABLES = [
  'cape',
  'lifted_index',
  'convective_inhibition',
  'boundary_layer_height',
] as const;

// ── Risk scoring ─────────────────────────────────────────

/**
 * Combine CAPE and LI into a single 0-100 score for the heatmap weight.
 *
 * Returns 0 when either is missing or CAPE is below ~200 (no real potential).
 *
 * Examples:
 *   CAPE=1000, LI=-2 →  cape*(-li)/1000 = 2000/1000 = 2  →  rounded → 2
 *   CAPE=2000, LI=-4 →  8000/1000 = 8  → 8
 *   CAPE=3000, LI=-6 → 18000/1000 = 18 → 18
 *   CAPE=4000, LI=-8 → 32000/1000 = 32 → 32
 *
 * For granizo PROBABLE territory (CAPE>=1500, LI<=-3) we'd see scores ≥ 4.5.
 * The heatmap layer uses this as `weight` and re-scales for color.
 */
export function convectionRiskScore(cape: number | null, li: number | null): number {
  if (cape == null || li == null) return 0;
  if (cape < 200) return 0;
  if (li > 0) return 0;
  const raw = (cape * -li) / 1000;
  return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
}

// ── Open-Meteo response parsing ──────────────────────────

interface CellResponse {
  hourly: Record<string, unknown> | null;
}

/**
 * Pull the forecast value at the FIRST hour from the Open-Meteo response.
 *
 * We request `forecast_hours=1` so each cell has a single value per variable.
 * If the response shape is unexpected (variable missing, array empty), we
 * fall back to null so the risk score handles it gracefully.
 */
function readFirstValue(hourly: Record<string, unknown> | null, key: string): number | null {
  if (!hourly) return null;
  const arr = hourly[key];
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const v = arr[0];
  return typeof v === 'number' ? v : null;
}

function readForecastTime(hourly: Record<string, unknown> | null): string | null {
  if (!hourly) return null;
  const t = hourly['time'];
  if (!Array.isArray(t) || t.length === 0) return null;
  return typeof t[0] === 'string' ? t[0] : null;
}

export function parseConvectionGridResponse(
  cells: GridCell[],
  responses: { cell: GridCell; hourly: Record<string, unknown> | null }[],
): ConvectionGridSnapshot {
  const points: ConvectionGridPoint[] = [];
  let peakCape = 0;
  let minLI = 100;
  let peakRisk = 0;
  let forecastTime: string | null = null;

  for (let i = 0; i < cells.length; i++) {
    const r = responses[i] ?? { cell: cells[i], hourly: null };
    const cape = readFirstValue(r.hourly, 'cape');
    const li = readFirstValue(r.hourly, 'lifted_index');
    const cin = readFirstValue(r.hourly, 'convective_inhibition');
    const blh = readFirstValue(r.hourly, 'boundary_layer_height');
    if (forecastTime == null) forecastTime = readForecastTime(r.hourly);

    const risk = convectionRiskScore(cape, li);
    if (cape != null && cape > peakCape) peakCape = cape;
    if (li != null && li < minLI) minLI = li;
    if (risk > peakRisk) peakRisk = risk;

    points.push({
      lat: cells[i].lat,
      lon: cells[i].lon,
      cape,
      liftedIndex: li,
      cin,
      boundaryLayerM: blh,
      risk,
    });
  }

  return {
    fetchedAt: Date.now(),
    forecastTime,
    cells: points,
    peakCape: Math.round(peakCape),
    minLiftedIndex: minLI === 100 ? 0 : Math.round(minLI * 10) / 10,
    peakRisk,
  };
}

// ── Public fetcher ───────────────────────────────────────

/**
 * Fetch the latest convection grid for Galicia. Uses GALICIA_GRID at 5 km.
 *
 * Cost per call: ~2-3 Open-Meteo requests (≤ 1000 coords each). At 30-min
 * cache the daily call count is well within the free tier.
 */
export async function fetchConvectionGrid(opts: { signal?: AbortSignal } = {}): Promise<ConvectionGridSnapshot> {
  const cells = generateGridCells(GALICIA_GRID);
  const responses = await fetchGridForecast(cells, {
    hourly: [...CONVECTION_VARIABLES],
    forecastHours: 1,
    timezone: 'UTC',
    signal: opts.signal,
  });
  return parseConvectionGridResponse(cells, responses);
}
