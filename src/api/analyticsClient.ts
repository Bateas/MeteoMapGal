/**
 * Analytics API client — Phase 4 sector-level rollups from TimescaleDB CAGGs.
 *
 * Consumes the 3 endpoints in ingestor/api.ts that were live since Phase 3
 * but unused on the frontend:
 *   - /api/v1/analytics/lightning-heatmap (per-cell strike count, last N days)
 *   - /api/v1/analytics/convection-trend  (daily CAPE/LI peak per sector)
 *   - /api/v1/analytics/air-quality-trend (daily ICA per station)
 *
 * The 2 endpoints already in use (historical-baseline, convection-grid) have
 * their own clients (`historicalBaselineService.ts`, `convectionGridService.ts`).
 *
 * All endpoints are cached server-side (5min - 1h depending on volatility),
 * so the frontend does NOT need its own cache layer here. Just a fetch with
 * timeout + graceful degradation.
 */

const BASE = '/api/v1/analytics';
const TIMEOUT = 15_000;

// ── Types ──────────────────────────────────────────────

export interface LightningHeatmapCell {
  /** Cell center latitude */
  lat: number;
  /** Cell center longitude */
  lon: number;
  /** Total strikes in cell over the period */
  strikes: number;
  /** Zone label (Embalse / Rías / etc) if computed server-side */
  zone?: string;
}

export interface LightningHeatmapResponse {
  from: string;
  to: string;
  minStrikes: number;
  count: number;
  cells: LightningHeatmapCell[];
}

export interface ConvectionDailyTrendPoint {
  /** ISO date YYYY-MM-DD */
  day: string;
  /** Peak CAPE that day (J/kg) */
  peakCape: number | null;
  /** Minimum Lifted Index that day (more negative = more unstable) */
  minLiftedIndex: number | null;
  /** Total convective hours (LI < 0) */
  convectiveHours: number | null;
  /** Lightning strikes observed that day (cross-table aggregation) */
  strikes: number | null;
}

export interface ConvectionTrendResponse {
  sector: 'embalse' | 'rias';
  days: number;
  count: number;
  trend: ConvectionDailyTrendPoint[];
}

export interface AirQualityDailyPoint {
  day: string;
  /** Mean ICA index that day (0-500 scale) */
  meanIca: number | null;
  /** Max ICA spike */
  maxIca: number | null;
  /** Hours with ICA ≥ 100 (poor air) */
  poorHours: number | null;
  /** Station label if filtered */
  station?: string;
}

export interface AirQualityTrendResponse {
  days: number;
  station: string | null;
  count: number;
  trend: AirQualityDailyPoint[];
}

// ── Fetch helpers ──────────────────────────────────────

async function fetchWithTimeout<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
    return await res.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

// ── Endpoints ─────────────────────────────────────────

/**
 * Fetch lightning hotspot heatmap.
 *
 * Returns cells with strike counts over the given window. Cells are
 * pre-bucketed server-side (typically 5km grid).
 */
export async function fetchLightningHeatmap(opts: {
  days?: number;
  minStrikes?: number;
} = {}): Promise<LightningHeatmapResponse> {
  const days = opts.days ?? 30;
  const minStrikes = opts.minStrikes ?? 1;
  const to = new Date().toISOString();
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const url = `${BASE}/lightning-heatmap?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&minStrikes=${minStrikes}`;
  return fetchWithTimeout<LightningHeatmapResponse>(url);
}

/**
 * Fetch daily convection trend per sector (CAPE/LI peak + lightning).
 *
 * Useful for "when does this sector usually have storms?" — daily series
 * suitable for a calendar heatmap or line chart.
 */
export async function fetchConvectionTrend(opts: {
  sector: 'embalse' | 'rias';
  days?: number;
}): Promise<ConvectionTrendResponse> {
  const days = opts.days ?? 30;
  const url = `${BASE}/convection-trend?sector=${opts.sector}&days=${days}`;
  return fetchWithTimeout<ConvectionTrendResponse>(url);
}

/**
 * Fetch daily air quality trend.
 *
 * Without `station` filter, returns the regional aggregate across all
 * ICA-reporting MeteoGalicia stations.
 */
export async function fetchAirQualityTrend(opts: {
  days?: number;
  station?: string;
} = {}): Promise<AirQualityTrendResponse> {
  const days = opts.days ?? 30;
  const station = opts.station ? `&station=${encodeURIComponent(opts.station)}` : '';
  const url = `${BASE}/air-quality-trend?days=${days}${station}`;
  return fetchWithTimeout<AirQualityTrendResponse>(url);
}
