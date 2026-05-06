/**
 * Convection grid service — frontend client for the ingestor backend.
 *
 * The heavy lifting lives in the ingestor:
 *   - `ingestor/convectionGridFetcher.ts` runs every 30min, fetches Open-Meteo
 *     for the whole Galicia grid, persists to TimescaleDB.
 *   - `GET /api/v1/analytics/convection-grid` serves the latest snapshot.
 *
 * The frontend just hits the endpoint — no batching, no rate-limit handling,
 * no Open-Meteo quota concerns. One IP (the ingestor) serves all users.
 *
 * Risk score formula `convectionRiskScore(cape, li)` is kept exported as a
 * UI helper in case overlays want to recolor without re-fetching.
 */

// ── Types (stable contract with the API) ─────────────────

export interface ConvectionGridPoint {
  lat: number;
  lon: number;
  cape: number | null;
  liftedIndex: number | null;
  cin: number | null;
  /** boundaryLayerM is intentionally omitted from the API payload to keep
   *  bytes small. If a future overlay needs it, add it to the SELECT in
   *  ingestor/queries.ts queryConvectionGrid. */
  risk: number;
}

export interface ConvectionGridSnapshot {
  /** Time we received this snapshot from the API */
  fetchedAt: number;
  /** ISO timestamp of the forecast hour the data refers to */
  forecastTime: string | null;
  /** Resolution km — informative only, no recompute on frontend */
  resolutionKm: number;
  cells: ConvectionGridPoint[];
  peakCape: number;
  minLiftedIndex: number;
  peakRisk: number;
}

interface ApiResponse {
  hourOffset: number;
  forecastTime: string | null;
  fetchedAt: string | null;
  resolutionKm: number;
  peakCape: number;
  minLiftedIndex: number;
  peakRisk: number;
  cells: ConvectionGridPoint[];
}

// ── Risk scoring (kept for UI helpers) ───────────────────

/**
 * CAPE × max(0, -LI) / 1000, clamped 0-100.
 * Returns 0 if either is missing, CAPE < 200, or LI >= 0.
 *
 * Examples:
 *   CAPE=1000, LI=-2 → 2.0
 *   CAPE=2000, LI=-4 → 8.0  (granizo posible territory)
 *   CAPE=3000, LI=-6 → 18.0 (extreme)
 */
export function convectionRiskScore(cape: number | null, li: number | null): number {
  if (cape == null || li == null) return 0;
  if (cape < 200) return 0;
  if (li > 0) return 0;
  const raw = (cape * -li) / 1000;
  return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
}

// ── Public fetcher ───────────────────────────────────────

/**
 * Fetch the latest convection grid snapshot from the ingestor.
 *
 * `hourOffset`:
 *   0 (default) = closest hour to now
 *   1..5 = future hours (the fetcher pulls 6h horizon every 30min)
 *
 * Network cost per call: ~5-20KB gzipped (~640 cells at 10km resolution,
 * up to ~2256 at 5km). One round-trip vs the 12 batched Open-Meteo calls
 * of the original frontend implementation.
 */
export async function fetchConvectionGrid(
  opts: { hourOffset?: number; signal?: AbortSignal } = {},
): Promise<ConvectionGridSnapshot> {
  const params = new URLSearchParams();
  if (opts.hourOffset != null) params.set('hourOffset', String(opts.hourOffset));
  const url = `/api/v1/analytics/convection-grid${params.toString() ? '?' + params : ''}`;

  const res = await fetch(url, { signal: opts.signal });
  if (!res.ok) throw new Error(`Convection grid API ${res.status}`);
  const data = (await res.json()) as ApiResponse;

  return {
    fetchedAt: data.fetchedAt ? new Date(data.fetchedAt).getTime() : Date.now(),
    forecastTime: data.forecastTime,
    resolutionKm: data.resolutionKm,
    cells: data.cells ?? [],
    peakCape: data.peakCape ?? 0,
    minLiftedIndex: data.minLiftedIndex ?? 0,
    peakRisk: data.peakRisk ?? 0,
  };
}
