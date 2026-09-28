/**
 * Synoptic regime from the 850 hPa wind (~1.5 km up): tells a sea-breeze
 * afternoon from a frontal one.
 *
 * A thermal breeze only builds when the large-scale flow is weak. On a summer
 * afternoon with the Azores high, 850 hPa blows light and usually from the
 * N-NW, the land heats and the SW breeze funnels into the rías — that is when
 * Cesantes, Lourido and friends read far more than the sheltered stations
 * around them. With a front coming in, 850 hPa blows strong from the S-SW-W:
 * the SW at the surface is that same flow brought down, there is no breeze to
 * amplify, and what the stations measure is what comes in.
 *
 * Measured over the afternoons with ground truth:
 *   06-Aug  3 kt NW   → breeze (validated)
 *   25-Sep  9 kt NW   → breeze, Cesantes 14 kt on the water (boost right)
 *   26-Aug 22 kt SW   → Cesantes 9 kt (the app said 34)
 *   27-Sep 19 kt SSW  → Cesantes 0 kt (false "ventana favorable")
 *   28-Sep 19 kt SSW  → Cesantes and Lourido <= 10 kt (the app said 15-18)
 * Jun-Sep this marks 4-8 afternoons a month as frontal; 20-23 stay open.
 *
 * No upper-air data = no veto: every boost behaves as before this existed.
 */
import { degreesToCardinal } from './windUtils';

export interface UpperWind {
  /** 850 hPa wind speed, knots */
  speedKt: number;
  /** 850 hPa wind direction, meteorological "from", degrees */
  dirDeg: number;
}

export interface RegimeVeto {
  vetoed: boolean;
  reason: string | null;
}

/** 850 hPa at or above this, from the frontal sector, is a front coming in. */
export const FRONTAL_MIN_KT = 15;
/** Frontal sector at 850 hPa: S through W (the flow that brings fronts in). */
export const FRONTAL_DIR_FROM = 150;
export const FRONTAL_DIR_TO = 290;

export function assessSynopticRegime(w: UpperWind | null | undefined): RegimeVeto | null {
  if (!w || !Number.isFinite(w.speedKt) || !Number.isFinite(w.dirDeg)) return null;
  const dir = ((w.dirDeg % 360) + 360) % 360;
  const frontal = w.speedKt >= FRONTAL_MIN_KT && dir >= FRONTAL_DIR_FROM && dir <= FRONTAL_DIR_TO;
  if (!frontal) return { vetoed: false, reason: null };
  return {
    vetoed: true,
    reason: `Entra viento de frente (${Math.round(w.speedKt)} kt ${degreesToCardinal(dir)} a 1.500 m): lo que miden las estaciones, sin refuerzo de brisa`,
  };
}

export interface UpperAirLevel {
  time: string | Date;
  pressureHpa: number;
  windSpeedMs: number | null;
  windDirDeg: number | null;
}

/** Longest gap between "now" and the model hour used (the table holds hourly rows). */
const MAX_GAP_MS = 3 * 3600_000;

/** The 850 hPa wind at the model hour nearest to `nowMs` (within 3 h), or null. */
export function upperWindAt(levels: UpperAirLevel[], nowMs: number): UpperWind | null {
  let best: UpperAirLevel | null = null;
  let bestGap = Infinity;
  for (const l of levels) {
    if (l.pressureHpa !== 850 || l.windSpeedMs == null || l.windDirDeg == null) continue;
    const t = typeof l.time === 'string' ? Date.parse(l.time) : l.time.getTime();
    const gap = Math.abs(t - nowMs);
    if (Number.isFinite(gap) && gap < bestGap) { best = l; bestGap = gap; }
  }
  if (!best || bestGap > MAX_GAP_MS) return null;
  return { speedKt: best.windSpeedMs! * 1.94384, dirDeg: best.windDirDeg! };
}
