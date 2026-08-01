/**
 * Historical baseline service — "Hoy vs media" insight.
 *
 * Fetches per-station baseline stats from the ingestor `readings_hourly` CAGG
 * over the last N days, so the SpotPopup can translate "12 kt" into
 * "12 kt — +45% sobre la media de los últimos 30 días".
 *
 * Bumped feature, not an alert — purely informational. Falls back gracefully
 * when the station has no historical data (early-life spots, just-discovered
 * stations).
 *
 * The API answers in stored units (m/s for wind); this module converts to the
 * units the user reads before anything downstream compares them. See
 * `toDisplayUnits`.
 */

import { msToKnots } from './windUtils';

export interface HistoricalBaseline {
  avg: number;
  p50: number;
  p75: number;
  p90: number;
  maxGust: number | null;
  hoursSampled: number;
}

export interface HistoricalBaselineResponse {
  stationId: string;
  metric: 'wind' | 'gust' | 'temp' | 'humidity';
  days: number;
  baseline: HistoricalBaseline | null;
}

/**
 * Fetch baseline for a single station. Browser cache TTL 1 h (matches server
 * Cache-Control), so the per-popup overhead is one network call max per hour.
 */
export async function fetchHistoricalBaseline(
  stationId: string,
  metric: 'wind' | 'gust' | 'temp' | 'humidity' = 'wind',
  days: number = 30,
  signal?: AbortSignal,
): Promise<HistoricalBaselineResponse> {
  const params = new URLSearchParams({ station_id: stationId, metric, days: String(days) });
  const url = `/api/v1/analytics/historical-baseline?${params}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`baseline API ${res.status}`);
  const body = await res.json() as HistoricalBaselineResponse;
  return { ...body, baseline: toDisplayUnits(body.baseline, metric) };
}

/**
 * The API answers in the units the database stores — metres per second for
 * wind — while every wind figure the user ever sees is in knots. Converting
 * here, at the boundary, is what the rest of the app already does.
 *
 * This was a real bug, not a precaution: the badge handed a value in knots and
 * a baseline in m/s to the same comparison, so the baseline read about half of
 * what it should and today's wind looked above average almost every day. A
 * "top 25%" that fires on an ordinary afternoon costs more trust than showing
 * nothing at all.
 *
 * Temperature and humidity are already in display units, so they pass through.
 */
function toDisplayUnits(
  baseline: HistoricalBaseline | null,
  metric: 'wind' | 'gust' | 'temp' | 'humidity',
): HistoricalBaseline | null {
  if (!baseline || (metric !== 'wind' && metric !== 'gust')) return baseline;
  return {
    ...baseline,
    avg: msToKnots(baseline.avg),
    p50: msToKnots(baseline.p50),
    p75: msToKnots(baseline.p75),
    p90: msToKnots(baseline.p90),
    maxGust: baseline.maxGust == null ? null : msToKnots(baseline.maxGust),
  };
}

// ── Pure presentation helpers (testable) ─────────────────

/**
 * Given a current value and a baseline, returns a compact insight phrase
 * for inline display. Returns null when the comparison would be misleading
 * (not enough sample data, current at zero, baseline near zero, etc.).
 *
 * Wording is in Spanish to match the UI. Kept as a pure function so the
 * SpotPopup component can stay rendering-only.
 */
export function describeVsBaseline(
  current: number,
  baseline: HistoricalBaseline | null,
  /** "kt" | "°C" | "%" — passed back in the phrase for context */
  unit: string,
  /** Time window label for the phrase, e.g. "últimos 30 días" */
  windowLabel: string = 'últimos 30 días',
): { phrase: string; severity: 'rare' | 'high' | 'typical' | 'low' } | null {
  if (!baseline || baseline.hoursSampled < 24) return null;
  if (!Number.isFinite(current) || current < 0.1) return null;
  if (baseline.avg < 0.1) return null;

  const pctVsAvg = Math.round(((current - baseline.avg) / baseline.avg) * 100);

  // p90 = top 10% rarest condition seen in window
  if (current >= baseline.p90 && baseline.p90 > 0) {
    return {
      phrase: `${current.toFixed(0)} ${unit} — top 10% ${windowLabel} (media ${baseline.avg.toFixed(0)} ${unit})`,
      severity: 'rare',
    };
  }
  // p75 = clearly above typical
  if (current >= baseline.p75 && baseline.p75 > 0) {
    return {
      phrase: `${current.toFixed(0)} ${unit} — top 25% ${windowLabel} (media ${baseline.avg.toFixed(0)} ${unit})`,
      severity: 'high',
    };
  }
  // Symmetric: noticeably below typical → only flag when clearly low
  if (current <= baseline.p50 * 0.5 && baseline.p50 > 0) {
    return {
      phrase: `${current.toFixed(0)} ${unit} — flojo vs media ${baseline.avg.toFixed(0)} ${unit} (${windowLabel})`,
      severity: 'low',
    };
  }
  // Near-typical: only worth showing when the delta is significant
  if (Math.abs(pctVsAvg) >= 25) {
    const sign = pctVsAvg > 0 ? '+' : '';
    return {
      phrase: `${current.toFixed(0)} ${unit} — ${sign}${pctVsAvg}% vs media ${baseline.avg.toFixed(0)} ${unit} (${windowLabel})`,
      severity: 'typical',
    };
  }
  // Within ±25% of average — not actionable, skip
  return null;
}

// ── Color hint for the badge ───────────────────────────

export function severityToBadgeClass(severity: 'rare' | 'high' | 'typical' | 'low'): string {
  switch (severity) {
    case 'rare':    return 'bg-rose-950/60 text-rose-200 border-rose-700/60';
    case 'high':    return 'bg-amber-950/60 text-amber-200 border-amber-700/60';
    case 'low':     return 'bg-sky-950/60 text-sky-300 border-sky-700/60';
    case 'typical':
    default:        return 'bg-slate-800/60 text-slate-300 border-slate-700/60';
  }
}
