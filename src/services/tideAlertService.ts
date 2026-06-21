/**
 * Tide alert service — derives the Spanish "coeficiente de marea" from
 * predicted heights, classifies the band, and cross-references buoy
 * pressure to estimate storm surge for the next intermareal window.
 *
 * Why bother:
 *   - Mariscadores recreativos and surfistas plan around BAJAMARES VIVAS
 *     (extreme low tides). With coef ≥ 95 + storm surge from low pressure,
 *     the actual sea level can drop below the predicted minimum, exposing
 *     normally-submerged rocks (opportunity for shellfishing) or surfing
 *     setups (peligro of boulders breaking the wave).
 *   - The conditions ticker should surface this only when actionable
 *     (coef ≥ 95 OR predicted surge ≥ 0.2 m) and only in the Rías sector.
 *
 * Pure module — no fetches, no React. Inputs come from `tideClient` and
 * the buoy store.
 */

import type { TidePoint } from '../api/tideClient';

// ── Coeficiente de marea ──────────────────────────────────

/**
 * Convert tidal amplitude (height difference between consecutive high/low)
 * into the Spanish coeficiente scale (0-120).
 *
 * Standard reference (IHM): coef 120 ≈ 4.0 m amplitude (Galician Atlantic
 * extremes), coef 50 ≈ 2.0 m (typical), coef 20 ≈ 0.7 m (neaps).
 *
 * Galician Atlantic gradient is steeper than the Bay of Biscay average,
 * so we calibrate against amplitude_max ≈ 4.2 m observed in Vigo. Output
 * clamped to 20-120 (matches IHM bulletins).
 */
export function tideCoefficient(amplitudeM: number | null | undefined): number | null {
  if (amplitudeM == null || !Number.isFinite(amplitudeM) || amplitudeM <= 0) return null;
  const raw = (amplitudeM / 4.2) * 120;
  return Math.max(20, Math.min(120, Math.round(raw)));
}

export type TideCategory = 'muertas' | 'medias' | 'vivas' | 'extremas';

/**
 * Classify a coefficient into the four standard IHM bands.
 *   < 45       muertas
 *   45-69      medias
 *   70-99      vivas
 *   ≥ 100      extremas (high-amplitude springs, intermareal exposure)
 *
 * The ticker fires from "vivas" upward (coef ≥ 95) — the upper half of
 * the vivas band is when shellfishing windows / surfing setups change.
 */
export function coefCategory(coef: number | null | undefined): TideCategory | null {
  if (coef == null || !Number.isFinite(coef)) return null;
  if (coef < 45) return 'muertas';
  if (coef < 70) return 'medias';
  if (coef < 100) return 'vivas';
  return 'extremas';
}

export const COEF_TICKER_THRESHOLD = 95;

// ── Storm surge estimate ──────────────────────────────────

/**
 * Inverse-barometric storm surge — rule of thumb is 1 hPa drop ≈ 1 cm
 * sea-level rise. Standard reference pressure is 1013 hPa. Returns the
 * estimated surge in METRES (positive = sea higher than astronomical
 * prediction). Galician shelf is wide enough that wind-driven setup
 * also matters but we don't model that here — buoy pressure is the
 * minimum signal.
 */
export function estimateStormSurge(pressureHpa: number | null | undefined): number | null {
  if (pressureHpa == null || !Number.isFinite(pressureHpa)) return null;
  const dropHpa = 1013 - pressureHpa;
  if (dropHpa <= 0) return 0;       // no surge from high pressure
  return Math.round(dropHpa) / 100; // m, rounded to cm
}

/** Surge ≥ 0.2 m is the threshold worth surfacing in the ticker (≥ 20 hPa drop) */
export const SURGE_TICKER_THRESHOLD_M = 0.2;

// ── Next tide helpers ─────────────────────────────────────

/**
 * Find the next pleamar/bajamar relative to `now`. Same logic that lived
 * inline in ConditionsTicker; extracted here so other components / tests
 * can reuse it.
 */
export function findNextTide(
  points: TidePoint[],
  now: Date = new Date(),
): { point: TidePoint; isRising: boolean } | null {
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  for (const p of points) {
    if (p.time > hhmm) {
      return { point: p, isRising: p.type === 'high' };
    }
  }
  return null;
}

/**
 * Compute the amplitude (m) for the next consecutive high/low pair starting
 * at `from`. Returns null if there aren't two more points after now.
 */
export function nextAmplitude(
  points: TidePoint[],
  from: Date = new Date(),
): number | null {
  const hhmm = `${String(from.getHours()).padStart(2, '0')}:${String(from.getMinutes()).padStart(2, '0')}`;
  const remaining = points.filter((p) => p.time > hhmm);
  if (remaining.length < 2) return null;
  return Math.abs(remaining[0].height - remaining[1].height);
}

// ── Ticker label ──────────────────────────────────────────

/**
 * Short, action-oriented label for the conditions ticker. Combines the
 * coefficient + the next tide event time + storm-surge note when present.
 *
 * Examples:
 *   coef=102, next=bajamar 06:34 (-0.3m), surge=0    → 'Aguas vivas extremas (coef 102) · bajamar 06:34'
 *   coef=98,  next=bajamar 14:20,         surge=0.3  → 'Aguas vivas (coef 98) · bajamar 14:20 · marea +0.3m por baja presión'
 */
export function tideTickerLabel(
  coef: number,
  nextPoint: TidePoint,
  surgeM: number | null,
): string {
  const cat = coefCategory(coef);
  const catLabel = cat === 'extremas' ? 'Aguas vivas extremas' : 'Aguas vivas';
  const eventLabel = nextPoint.type === 'low' ? 'bajamar' : 'pleamar';
  const surgeNote =
    surgeM != null && Math.abs(surgeM) >= SURGE_TICKER_THRESHOLD_M
      ? ` · marea +${surgeM.toFixed(1)}m por baja presión`
      : '';
  return `${catLabel} (coef ${coef}) · ${eventLabel} ${nextPoint.time}${surgeNote}`;
}

/**
 * Single decision point: should the ticker surface a tide alert?
 * True when EITHER coef ≥ 95 (always notable) OR storm surge is
 * meaningful (≥ 0.2 m), regardless of coefficient.
 */
export function shouldShowTideAlert(
  coef: number | null | undefined,
  surgeM: number | null | undefined,
): boolean {
  const coefHigh = coef != null && coef >= COEF_TICKER_THRESHOLD;
  const surgeHigh = surgeM != null && surgeM >= SURGE_TICKER_THRESHOLD_M;
  return coefHigh || surgeHigh;
}

// ── Casual strength translation (on-demand, for non-experts) ──

export interface TideStrength {
  /** Spanish coefficient 20-120 */
  coef: number;
  category: TideCategory;
  /** Short headline, e.g. "Marea muy viva" */
  label: string;
  /** Plain-language one-liner a non-expert understands (no coefficient jargon) */
  casual: string;
  /** 0-1, for a strength bar (coef normalised over the 20-120 scale) */
  strength: number;
  /** coef ≥ 100 — among the strongest tides of the year (the ~4 m / 0.4 m ceiling in Vigo) */
  isSeasonalPeak: boolean;
}

/**
 * Largest single high→low (or low→high) amplitude across a day's tide points
 * (m) — the day's strongest cycle, the value that best represents "how big is
 * the tide today" and feeds the coefficient.
 */
export function peakAmplitude(points: TidePoint[]): number | null {
  if (!points || points.length < 2) return null;
  let max = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.abs(points[i].height - points[i - 1].height);
    if (d > max) max = d;
  }
  return max > 0 ? max : null;
}

/**
 * Translate a tidal amplitude into a casual, jargon-free description of how
 * much the sea moves today. The "coeficiente"/"+ -" scale means nothing to a
 * casual visitor (the recurring user complaint), so this pairs the number with
 * plain words + a strength bar. Returns null when there isn't enough data.
 */
export function describeTideStrength(amplitudeM: number | null | undefined): TideStrength | null {
  const coef = tideCoefficient(amplitudeM);
  if (coef == null) return null;
  const category = coefCategory(coef)!;
  const strength = Math.max(0, Math.min(1, (coef - 20) / 100));
  let label: string;
  let casual: string;
  switch (category) {
    case 'muertas':
      label = 'Marea muerta';
      casual = 'El mar apenas sube y baja hoy';
      break;
    case 'medias':
      label = 'Marea media';
      casual = 'Subida y bajada normales';
      break;
    case 'vivas':
      label = 'Marea viva';
      casual = 'El mar baja bastante — buen rato para marisqueo a pie';
      break;
    default: // extremas
      label = 'Marea muy viva';
      casual = 'El mar baja a tope — gran marisqueo a pie; con barco, ojo a las piedras';
      break;
  }
  return { coef, category, label, casual, strength, isSeasonalPeak: coef >= 100 };
}
