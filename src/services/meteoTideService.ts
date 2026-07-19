/**
 * Meteorological tide (storm surge) — the difference between the sea level a
 * gauge actually measures and the level the astronomical tide predicted.
 *
 * Not a new data source: both halves are already ingested. The REDMAR tide
 * gauges (PORTUS) publish `sea_level`, and the IHM publishes the official
 * astronomical prediction. Subtracting one from the other answers a question
 * no forecast table does: "the table says low water, but is the water
 * actually where the table says?"
 *
 * Why it matters here: a persistent low pressure plus onshore wind piles
 * water into the rías. Half a metre over prediction covers a launch ramp,
 * floods a slipway at high water, and changes how much beach is left. The
 * sign is what people feel — surge is the part of the tide the tide table
 * cannot know.
 *
 * Datum check (done before this was written, keep it in mind if numbers ever
 * look absurd): REDMAR gauge readings and IHM predictions were compared live
 * at Vigo and agreed to within 17cm, so both are on the same chart datum. A
 * residual of metres would mean that assumption broke, not a real surge —
 * hence the sanity cap below.
 */

import type { TidePoint } from '../api/tideClient';

/** Residuals beyond this are physically implausible for the rías and almost
 *  certainly mean a datum mismatch or a broken gauge, not weather. */
export const MAX_PLAUSIBLE_SURGE_M = 1.5;

/** Below this the residual is prediction noise, not something to report. */
export const SURGE_NOTABLE_M = 0.15;

/** A surge worth warning about: enough to cover a ramp or reach higher than
 *  the table suggests at high water. */
export const SURGE_HIGH_M = 0.30;

export type SurgeLevel = 'none' | 'notable' | 'high';

export interface MeteoTide {
  /** Observed minus predicted, metres. Positive = water higher than the table. */
  residualM: number;
  /** Interpolated astronomical height at that instant, metres above datum. */
  astronomicalM: number;
  /** What the gauge measured, metres above datum. */
  observedM: number;
  level: SurgeLevel;
  /** Age of the gauge reading in minutes — surge is only meaningful live. */
  ageMin: number;
}

/** A tide extreme with an absolute timestamp, so day boundaries stop mattering. */
export interface TideExtreme {
  at: Date;
  heightM: number;
}

/**
 * Turn IHM day-scoped points ("06:22", 3.195) into absolute timestamps.
 * Pass consecutive days and the caller gets a continuous series that brackets
 * any instant, including the gap across midnight where the previous extreme
 * belongs to yesterday.
 */
export function toExtremes(points: TidePoint[], day: Date): TideExtreme[] {
  const out: TideExtreme[] = [];
  for (const p of points) {
    const [hh, mm] = p.time.split(':').map(Number);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;
    if (!Number.isFinite(p.height)) continue;
    const at = new Date(day);
    at.setHours(hh, mm, 0, 0);
    out.push({ at, heightM: p.height });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * Astronomical height at an arbitrary instant, interpolated between the two
 * bracketing extremes with a cosine — the standard approximation for a tidal
 * curve between consecutive high and low water, and far more accurate near
 * the turns than a straight line.
 *
 * Returns null when the instant is not bracketed: better no number than one
 * extrapolated past the edge of the data.
 */
export function astronomicalAt(extremes: TideExtreme[], at: Date): number | null {
  const t = at.getTime();
  for (let i = 0; i < extremes.length - 1; i++) {
    const a = extremes[i];
    const b = extremes[i + 1];
    const ta = a.at.getTime();
    const tb = b.at.getTime();
    if (t < ta || t > tb || tb === ta) continue;
    const f = (t - ta) / (tb - ta);
    const mid = (a.heightM + b.heightM) / 2;
    const amp = (a.heightM - b.heightM) / 2;
    return mid + amp * Math.cos(Math.PI * f);
  }
  return null;
}

export function surgeLevel(residualM: number): SurgeLevel {
  const abs = Math.abs(residualM);
  if (abs >= SURGE_HIGH_M) return 'high';
  if (abs >= SURGE_NOTABLE_M) return 'notable';
  return 'none';
}

/**
 * Compute the meteorological tide from a gauge reading and the astronomical
 * series. Returns null whenever the answer would be untrustworthy rather than
 * guessing: no bracketing prediction, a stale gauge, or a residual so large it
 * indicts the inputs instead of describing the weather.
 */
export function computeMeteoTide(
  observedM: number | null | undefined,
  observedAt: Date,
  extremes: TideExtreme[],
  now: Date = new Date(),
  maxAgeMin = 120,
): MeteoTide | null {
  if (observedM == null || !Number.isFinite(observedM)) return null;

  const ageMin = (now.getTime() - observedAt.getTime()) / 60_000;
  // Surge describes the sea right now; an old reading describes a past one.
  // Negative age (clock skew) is treated as fresh, not as a reason to bail.
  if (ageMin > maxAgeMin) return null;

  const astronomicalM = astronomicalAt(extremes, observedAt);
  if (astronomicalM === null) return null;

  const residualM = observedM - astronomicalM;
  if (Math.abs(residualM) > MAX_PLAUSIBLE_SURGE_M) return null;

  return {
    residualM,
    astronomicalM,
    observedM,
    level: surgeLevel(residualM),
    ageMin: Math.max(0, Math.round(ageMin)),
  };
}

/**
 * One plain sentence for the UI. Says the direction in words because the sign
 * of a number is the part people misread.
 */
export function formatMeteoTide(t: MeteoTide): string {
  const cm = Math.round(Math.abs(t.residualM) * 100);
  if (t.level === 'none') return 'Marea segun tabla';
  return t.residualM > 0
    ? `Agua ${cm} cm por encima de tabla`
    : `Agua ${cm} cm por debajo de tabla`;
}
