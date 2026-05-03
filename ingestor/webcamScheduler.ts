/**
 * Adaptive scheduler for webcam vision analysis (Layer 2).
 *
 * Pure helpers extracted from webcamAnalyzer so tests can run without
 * triggering the dynamic `sharp` import that the analyzer needs at runtime
 * for image preprocessing.
 */

export interface WebcamScheduleState {
  lastResult: { beaufort: number } | null;
  beaufortHistory: number[];          // last 5 readings, newest first
  cyclesSinceLastAnalysis: number;
}

// Adaptive schedule thresholds (cycles, where 1 cycle = 5 min ingestor poll)
export const SCHEDULE_CYCLES_STABLE_CALM = 4; // 20min when 5 readings ≤ 1
export const SCHEDULE_CYCLES_DEFAULT = 3;     // 15min normal cadence
// Beaufort >= 4 → every cycle (5min) — encoded inline below

/**
 * Decide if a webcam is due for analysis on this cycle.
 *
 * - First time (no state) → always due
 * - Last reading Beaufort >= 4 → every cycle (active event)
 * - Last 5 readings all ≤ 1 → every 4 cycles (stable calm)
 * - Else → every 3 cycles (default cadence, ~15min)
 */
export function shouldAnalyzeCam(state: WebcamScheduleState | undefined): boolean {
  if (!state) return true;
  if (state.lastResult && state.lastResult.beaufort >= 4) return true;

  const recent = state.beaufortHistory;
  const stableCalm =
    recent.length >= 5 && recent.every((b) => b >= 0 && b <= 1);
  const required = stableCalm ? SCHEDULE_CYCLES_STABLE_CALM : SCHEDULE_CYCLES_DEFAULT;
  return state.cyclesSinceLastAnalysis >= required;
}
