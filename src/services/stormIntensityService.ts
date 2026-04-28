/**
 * Storm intensity classifier — S126.
 *
 * "Vemos las tormentas pero ni idea si va a caer poca lluvia o un mega
 * chaparrón o es tormenta eléctrica puramente" → close that gap.
 *
 * Pure function. Inputs:
 *   - storm cluster (centroid + strike data)
 *   - nearby station precip readings (real-time mm)
 *   - convection state (CAPE/LI/temperature_500hPa) — optional
 *
 * Outputs structured intensity tags + label so StormClusterOverlay can:
 *   - show enriched label on map ("Eléctrica seca · 0.3mm/h · Granizo posible")
 *   - paint differential visual hints (hail-stripes / wet-fill / dry-rings)
 *
 * Rules tuned for Galicia atmosphere (low BLH typical, frequent dry
 * thunderstorms in summer interior, heavy rain coastal):
 *
 *   rainRate = mean(precip_30min) of readings within 15km of centroid
 *
 *   Type:
 *     ≥10 strikes/15min + rainRate < 1mm/h     → 'eléctrica seca' (peligro
 *                                                  para campo: incendio,
 *                                                  no para refugio en mar)
 *     rainRate > 15mm/h                         → 'lluvia intensa' (refugio)
 *     rainRate > 5 + ≥5 strikes/15min           → 'lluvia con rayos'
 *     rainRate > 0.5 + <3 strikes               → 'estratiforme leve'
 *     default                                   → 'mixta'
 *
 *   Hail risk (atmospheric criterion, NOT just CAPE):
 *     CAPE ≥ 1500 + LI ≤ -3 + T_500 ≤ -15°C    → 'probable'
 *     CAPE ≥ 1000 + LI ≤ -2                    → 'posible'
 *     default                                   → 'none'
 */

import type { StormCluster } from './stormTracker';

const NEARBY_RADIUS_KM = 15;
const PRECIP_WINDOW_MS = 30 * 60_000;
const STRIKES_WINDOW_FOR_RATE_MIN = 15;

export type StormType =
  | 'eléctrica seca'
  | 'lluvia intensa'
  | 'lluvia con rayos'
  | 'estratiforme leve'
  | 'mixta'
  | 'sin datos';

export type HailRisk = 'none' | 'posible' | 'probable';

export interface StormIntensity {
  type: StormType;
  /** Estimated rain rate at the cluster, in mm/h. Null if no nearby data */
  rainRateMmH: number | null;
  /** Strike-rate proxy (strikes/15min from cluster newest strikes) */
  strikeRate15min: number;
  hailRisk: HailRisk;
  /** Single-line summary for the cluster label (Spanish) — text only, no emojis */
  label: string;
  /** Indication for which visual style to apply (frontend overlay hint).
   *  Project convention: visual differentiation lives in mass-core color, hail
   *  rings, wet-fill — NOT in label text. Lucide SVG icons are the standard
   *  iconography elsewhere in the UI; map labels stay text-only because
   *  MapLibre text-fields can't render arbitrary glyphs reliably (see S126+1
   *  protomaps 404 incident with weather emojis 🌧️ 🌦️ 🌩️ — Unicode
   *  block U+1F300-1F37F isn't covered by the Noto Sans Bold tiles). */
  visualStyle: 'dry-rings' | 'wet-fill' | 'mixed' | 'stratiform' | 'default';
}

export interface NearbyPrecipReading {
  lat: number;
  lon: number;
  precipMm: number | null;
  /** Reading age in seconds (we filter to last 30min) */
  ageSeconds: number;
}

export interface ConvectionState {
  cape: number | null;
  liftedIndex: number | null;
  /** Temperature at 500hPa in °C — required for hail criterion */
  temperature500hPa: number | null;
}

// ── Helpers ───────────────────────────────────────────

function fastDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const DEG = Math.PI / 180;
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG * Math.cos(((lat1 + lat2) / 2) * DEG);
  return Math.sqrt(dLat * dLat + dLon * dLon) * 6371;
}

/**
 * Compute mean rain rate (mm/h) from nearby precip readings.
 * - Only readings <NEARBY_RADIUS_KM from centroid
 * - Only readings <30min old
 * - precipMm is the accumulated precip over the reading interval; we
 *   approximate rate as `precipMm * (60 / age_minutes)` BUT for our 5-min
 *   stations this rate is unstable. Use a simpler heuristic: just average
 *   the precipMm across recent readings — this is "mm in last 30min" which
 *   ≈ mm/h for the last 30min sustained. Conservative.
 */
export function computeRainRate(
  centroidLat: number,
  centroidLon: number,
  readings: NearbyPrecipReading[],
): number | null {
  const valid: number[] = [];
  for (const r of readings) {
    if (r.ageSeconds > PRECIP_WINDOW_MS / 1000) continue;
    if (r.precipMm == null || !Number.isFinite(r.precipMm) || r.precipMm < 0) continue;
    const dist = fastDistanceKm(centroidLat, centroidLon, r.lat, r.lon);
    if (dist > NEARBY_RADIUS_KM) continue;
    valid.push(r.precipMm);
  }
  if (valid.length === 0) return null;
  const mean = valid.reduce((s, v) => s + v, 0) / valid.length;
  // Treat the 30-min accumulation as ~30min rate. Convert to mm/h × 2.
  return Math.round(mean * 2 * 10) / 10;
}

/**
 * Strike rate over the last `STRIKES_WINDOW_FOR_RATE_MIN` (15min).
 * The cluster carries `newestAgeMin` and `strikeCount` — if newest is fresh
 * we approximate the cluster's strike rate from its total count when the
 * cluster lifecycle is shorter than 15min, else assume sustained = total/15.
 */
export function strikeRatePer15Min(cluster: StormCluster): number {
  // Conservative: if the cluster is older than 15min total but newest is
  // <15min, we assume sustained rate; if newest is older than 15min, the
  // cluster is dying and rate ≈ 0.
  if (cluster.newestAgeMin > STRIKES_WINDOW_FOR_RATE_MIN) return 0;
  // For young clusters with fewer than 15min of life, return total
  if (cluster.avgAgeMin < STRIKES_WINDOW_FOR_RATE_MIN) {
    return cluster.strikeCount;
  }
  // Older clusters: estimate rate by assuming uniform distribution
  // strikes per 15min ≈ total / (avgAge / 15)
  const factor = cluster.avgAgeMin / STRIKES_WINDOW_FOR_RATE_MIN;
  if (factor <= 0) return cluster.strikeCount;
  return Math.round((cluster.strikeCount / factor) * 10) / 10;
}

// ── Hail risk ─────────────────────────────────────────

export function classifyHailRisk(c: ConvectionState | null): HailRisk {
  if (!c) return 'none';
  const cape = c.cape ?? 0;
  const li = c.liftedIndex ?? 99; // benign default
  const t500 = c.temperature500hPa ?? 99;
  // Probable: full criterion (cold tops + strong instability)
  if (cape >= 1500 && li <= -3 && t500 <= -15) return 'probable';
  // Possible: moderate instability without cold-top requirement
  if (cape >= 1000 && li <= -2) return 'posible';
  return 'none';
}

// ── Type classification ──────────────────────────────

function classifyType(rainRate: number | null, strikeRate: number): StormType {
  if (rainRate === null && strikeRate === 0) return 'sin datos';

  const r = rainRate ?? 0;

  // Dry electrical: many strikes, very little rain
  if (strikeRate >= 10 && r < 1) return 'eléctrica seca';

  // Heavy rain (refuge needed) — regardless of strike count
  if (r > 15) return 'lluvia intensa';

  // Wet thunderstorm (rain + lightning together)
  if (r > 5 && strikeRate >= 5) return 'lluvia con rayos';

  // Light stratiform — barely a storm. Allow up to 2 strikes (background)
  // since electrified stratiform is occasionally seen with frontal systems.
  if (r > 0.5 && strikeRate < 3) return 'estratiforme leve';

  // Mixed/uncertain
  return 'mixta';
}

// ── Visual / label helpers ───────────────────────────
//
// S126+1: emoji prefixes were removed (project convention "No emojis in UI").
// Emojis like 🌧️ 🌦️ 🌩️ live in Unicode block U+1F300-1F37F which isn't
// covered by the protomaps Noto Sans Bold font tiles → MapLibre fired a
// 404 + CORS error per cluster label render. The visual differentiation
// of storm type is already conveyed by:
//   - mass-core color (v2.66.0): red/orange/amber/blue per type
//   - wet-fill blue (lluvia intensa)
//   - hail rings (granizo posible/probable)
// so the emojis were redundant.

const TYPE_VISUALS: Record<StormType, { visualStyle: StormIntensity['visualStyle'] }> = {
  'eléctrica seca':    { visualStyle: 'dry-rings' },
  'lluvia intensa':    { visualStyle: 'wet-fill' },
  'lluvia con rayos':  { visualStyle: 'mixed' },
  'estratiforme leve': { visualStyle: 'stratiform' },
  'mixta':             { visualStyle: 'default' },
  'sin datos':         { visualStyle: 'default' },
};

function buildLabel(type: StormType, rainRate: number | null, hail: HailRisk): string {
  let base = '';
  switch (type) {
    case 'eléctrica seca':    base = 'Eléctrica seca'; break;
    case 'lluvia intensa':    base = 'Lluvia intensa'; break;
    case 'lluvia con rayos':  base = 'Lluvia con rayos'; break;
    case 'estratiforme leve': base = 'Estratiforme'; break;
    case 'mixta':             base = 'Tormenta'; break;
    case 'sin datos':         base = 'Sin datos'; break;
  }
  const rainTag = rainRate != null && rainRate > 0 ? ` · ${rainRate}mm/h` : '';
  // Hail badge — plain text, no warning glyph (kept ASCII for font safety).
  // Tier difference is communicated by the hail-rings visual layer (more
  // intense cyan at probable) rather than text prominence.
  const hailTag = hail === 'probable' ? ' · Granizo probable' : hail === 'posible' ? ' · Granizo posible' : '';
  return `${base}${rainTag}${hailTag}`;
}

// ── Main ─────────────────────────────────────────────

/**
 * Bulk enrichment helper: take an array of storm clusters + sources of
 * derived data and return clusters with `.intensity` populated.
 * Used by `useLightningData` after `trackStorms()` produces the basic
 * cluster list. Pure function — no I/O, no Zustand reads, fully testable.
 */
export function enrichClustersWithIntensity<T extends StormCluster>(
  clusters: T[],
  precipReadings: NearbyPrecipReading[],
  convection: ConvectionState | null,
): T[] {
  return clusters.map((c) => ({
    ...c,
    intensity: classifyStormIntensity(c, precipReadings, convection),
  }));
}

export function classifyStormIntensity(
  cluster: StormCluster,
  nearbyReadings: NearbyPrecipReading[],
  convection: ConvectionState | null,
): StormIntensity {
  const rainRateMmH = computeRainRate(cluster.lat, cluster.lon, nearbyReadings);
  const strikeRate = strikeRatePer15Min(cluster);
  const type = classifyType(rainRateMmH, strikeRate);
  const hailRisk = classifyHailRisk(convection);
  const visuals = TYPE_VISUALS[type];

  return {
    type,
    rainRateMmH,
    strikeRate15min: strikeRate,
    hailRisk,
    label: buildLabel(type, rainRateMmH, hailRisk),
    visualStyle: visuals.visualStyle,
  };
}
