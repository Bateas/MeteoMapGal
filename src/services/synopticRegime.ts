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
 * Strong NNE-E aloft (coastal only, opt-in): the land-to-sea flow keeps the SW
 * breeze out. Clear afternoons 2024-2026 (POEM tide gauges, Open-Meteo 850 hPa),
 * share with the breeze in at 14-17 h when 850 hPa blows from 20-120 degrees:
 *   >= 15 kt   Vigo 19-24 %, Marin 13-17 %, Vilagarcia 0-6 %
 *   10-15 kt   Vigo 40-50 %, Marin 17-24 %, Vilagarcia 0-10 %   (not vetoed)
 *   < 10 kt    Vigo 82-92 %, Marin 67-74 %
 * The N (330-20) does NOT block it: at 10-15 kt the breeze still came in 71-75 %.
 * Only the callers that talk about a breeze opt in (boosts, canalization, the
 * breeze forecasts); the alert that a spot became sailable does not, because
 * a strong NE is itself sailing wind.
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
  /** 'frontal': the SW at the surface is the front itself. 'offshore': strong NNE-E aloft
   *  keeps the sea breeze out (only when the caller passes coastal). */
  kind?: 'frontal' | 'offshore' | null;
}

/** 850 hPa at or above this, from the frontal sector, is a front coming in. */
export const FRONTAL_MIN_KT = 15;
/** Frontal sector at 850 hPa: S through W (the flow that brings fronts in). */
export const FRONTAL_DIR_FROM = 150;
export const FRONTAL_DIR_TO = 290;

/** 850 hPa at or above this, from the offshore sector, keeps the breeze out of the rías. */
export const OFFSHORE_MIN_KT = 15;
/** Offshore sector at 850 hPa: NNE through E (from the land to the sea in the Rías Baixas). */
export const OFFSHORE_DIR_FROM = 20;
export const OFFSHORE_DIR_TO = 120;

export function assessSynopticRegime(
  w: UpperWind | null | undefined,
  opts: { coastal?: boolean } = {},
): RegimeVeto | null {
  if (!w || !Number.isFinite(w.speedKt) || !Number.isFinite(w.dirDeg)) return null;
  const dir = ((w.dirDeg % 360) + 360) % 360;
  const frontal = w.speedKt >= FRONTAL_MIN_KT && dir >= FRONTAL_DIR_FROM && dir <= FRONTAL_DIR_TO;
  if (frontal) {
    return {
      vetoed: true,
      kind: 'frontal',
      reason: `Entra viento de frente (${Math.round(w.speedKt)} kt ${degreesToCardinal(dir)} a 1.500 m): lo que miden las estaciones, sin refuerzo de brisa`,
    };
  }
  const offshore = opts.coastal === true && w.speedKt >= OFFSHORE_MIN_KT && dir >= OFFSHORE_DIR_FROM && dir < OFFSHORE_DIR_TO;
  if (offshore) {
    return {
      vetoed: true,
      kind: 'offshore',
      reason: `NE fuerte en altura (${Math.round(w.speedKt)} kt ${degreesToCardinal(dir)} a 1.500 m): la brisa del SW no suele entrar`,
    };
  }
  return { vetoed: false, reason: null, kind: null };
}

/**
 * The regime over a window of hours (a forecast window, the day's outlook): vetoed when at
 * least half of the hours with upper-air data are, with the reason of the first vetoed one.
 * Null when no hour has data (no veto, as everywhere else).
 */
export function windowRegime(
  levels: UpperAirLevel[] | null | undefined,
  hoursMs: number[],
  opts: { coastal?: boolean } = {},
): RegimeVeto | null {
  if (!levels || levels.length === 0) return null;
  let judged = 0;
  let first: RegimeVeto | null = null;
  let vetoed = 0;
  for (const ms of hoursMs) {
    const r = assessSynopticRegime(upperWindAt(levels, ms), opts);
    if (!r) continue;
    judged++;
    if (r.vetoed) { vetoed++; first ??= r; }
  }
  if (judged === 0) return null;
  return vetoed * 2 >= judged && first ? first : { vetoed: false, reason: null, kind: null };
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
