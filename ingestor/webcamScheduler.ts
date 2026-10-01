/**
 * When each webcam is looked at by the vision model (Layer 2).
 *
 * Pure helpers extracted from webcamAnalyzer so tests can run without
 * triggering the dynamic `sharp` import that the analyzer needs at runtime
 * for image preprocessing.
 *
 * The model is only trusted for coarse fog and visibility, so fog is what sets the pace. Its
 * Beaufort estimate used to: a reading of 4 or more re-ran that camera every 5 minutes, on a
 * number the app does not show because it is not reliable. And the model only runs when the
 * stations around the camera leave room for fog (fogAlertGate): a week of September had 372
 * calls a day at ~29 s with the four cores of the app host flat out, and half of them, plus 75
 * of the 166 «fog» answers, came with the air nowhere near saturation.
 */

export interface WebcamScheduleState {
  /** What the model said the last time it ran, or null. */
  lastResult: { fog: boolean } | null;
  /** Ingestor cycles (5 min) since the camera was last looked at, counted before deciding. */
  cyclesSinceLastAnalysis: number;
  /** The last look found no room for fog at the stations around it, so the model did not run. */
  gateClosed?: boolean;
}

/** Cycles of 5 min between looks. */
export const SCHEDULE_CYCLES_DEFAULT = 4; // 20 min
/** The camera saw fog: confirm it or clear it soon. */
export const SCHEDULE_CYCLES_FOG = 2; // 10 min
/** No room for fog last time: only the stations are read, which costs a query, not the model. */
export const SCHEDULE_CYCLES_GATE = 2; // 10 min

/**
 * Whether a camera is due this cycle. The caller adds one to `cyclesSinceLastAnalysis` at the
 * start of every daytime cycle and sets it to 0 when it looks, so the camera is looked at every
 * `required` cycles.
 */
export function shouldAnalyzeCam(state: WebcamScheduleState | undefined): boolean {
  if (!state) return true;
  const required = state.gateClosed
    ? SCHEDULE_CYCLES_GATE
    : state.lastResult?.fog
      ? SCHEDULE_CYCLES_FOG
      : SCHEDULE_CYCLES_DEFAULT;
  return state.cyclesSinceLastAnalysis >= required;
}
