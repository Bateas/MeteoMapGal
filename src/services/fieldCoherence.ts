/**
 * Do the stations around a spot agree on where the wind is coming from?
 *
 * The engine already asks whether they agree on SPEED. It never asks whether
 * they agree on DIRECTION, and a measured afternoon at the reservoir showed
 * what that costs: Cartelle reading south-west, Remuíño south-south-east and
 * San Amaro wandering between north and west-north-west, all within eight
 * kilometres. Individually each was reporting four to seven knots. Together
 * they were reporting nothing at all — there was no established flow, and the
 * water had one to two knots while the numbers on screen suggested six.
 *
 * ── What was measured
 *
 * Twenty-six afternoons (6 Jul - 5 Aug 2026), four stations around Castrelo,
 * directions averaged per station over 14:00-17:00, coherence taken across
 * those averages, outcome the peak at Ribadavia between 18:00 and 21:00:
 *
 *   correlation +0.52, p = 0.006 by permutation over 100,000 shuffles
 *   the eight windiest afternoons all scored 0.68 or above
 *   no afternoon below 0.60 ever reached ten knots
 *
 * For contrast, on the same days and by the same test, how hot the interior
 * got scored r = +0.07 at p = 0.715 — the intuitive variable is worthless,
 * because in a Galician summer the interior is hot every single day and a
 * variable that is true every day cannot separate one day from another.
 *
 * ── Why this only ever says no
 *
 * The rule below refuses to promise wind. It states a CEILING when two
 * independent signals agree that the afternoon is going nowhere, and stays
 * silent otherwise. The asymmetry is deliberate: telling someone there is
 * wind when there is none costs them a wasted trip, while missing a mediocre
 * afternoon costs almost nothing. Two of the discarded days did reach 8.0 and
 * 8.6 knots, which some people would happily sail — so the wording has to be
 * "not above about nine" and never "no wind".
 *
 * ── Provisional
 *
 * Thresholds were chosen looking at those twenty-six days, which always
 * flatters them. They need afternoons going forward, with the numbers frozen,
 * before this earns a place outside the advanced view. Nothing here needs to
 * be stored to do that: the raw readings are already in the database and the
 * coherence can be recomputed for any past day.
 */

/** One station's directions inside the window (degrees, meteorological "from"). */
export interface StationDirections {
  stationId: string;
  directions: number[];
}

export interface StationSteadiness {
  stationId: string;
  /** 0..1 — how constant this station's OWN direction was in the window. */
  steadiness: number;
  /** Its mean heading over the window (degrees the wind came FROM). */
  headingDeg: number;
}

export interface FieldCoherence {
  /** 0..1 — how much the stations agree with EACH OTHER. */
  coherence: number;
  stations: number;
  /** Per station, for showing why the field looks the way it does. */
  perStation: StationSteadiness[];
}

/** Below three stations there is no field to speak of, only an opinion. */
export const MIN_STATIONS = 3;

/** Afternoon window the measurement used. Outside it the relationship was
 *  never tested, so nothing is claimed. */
export const WINDOW_START_HOUR = 14;
export const WINDOW_END_HOUR = 17;

/** Coherence at or above this and the field is organised enough that the rule
 *  keeps quiet. No afternoon below 0.60 reached ten knots in the sample; 0.65
 *  buys a little margin at the cost of a few more silent days. */
export const COHERENCE_CEILING = 0.65;

/** And the local reading has to be low as well. Magnitude and organisation are
 *  physically independent, which is what makes them two signals rather than
 *  one dressed twice. */
export const LOCAL_CEILING_KT = 4.5;

/** What the discarded afternoons actually topped out at. The highest was 8.6,
 *  so nine is the honest ceiling to quote. */
export const CEILING_KT = 9;

/**
 * Below this, a station's own directions have cancelled out and it has no
 * heading to contribute.
 *
 * Not a floating-point epsilon — a physical one. Machine zero would not do the
 * job anyway: a station alternating 0 and 180 degrees leaves a vector of
 * length 1.2e-16 rather than 0, because sin(pi) is not exactly zero. But the
 * real reason for a generous threshold is worse than tidiness: this vector
 * gets NORMALISED before it joins the field, so a near-zero one turns pure
 * rounding noise into a full-length arrow pointing somewhere arbitrary, and
 * that arrow then votes on whether the field is organised.
 *
 * Set well under what a real wobbly station scores. The four around Castrelo
 * on the scattered afternoon of 5-Aug came in at 0.22 to 0.45: genuinely
 * unsteady, but each still had a heading, and each deserves its vote.
 */
export const MIN_STEADINESS = 0.05;

/** Mean unit vector of a set of bearings. Length is 0 when they cancel out and
 *  1 when they all point the same way — the standard circular statistic, and
 *  the only correct way to average a direction. Averaging 350 and 10
 *  arithmetically gives 180, the exact opposite of the truth. */
function meanVector(degrees: number[]): { x: number; y: number; length: number } | null {
  let x = 0, y = 0, n = 0;
  for (const d of degrees) {
    if (!Number.isFinite(d)) continue;
    const rad = (d * Math.PI) / 180;
    x += Math.cos(rad); y += Math.sin(rad); n++;
  }
  if (n === 0) return null;
  x /= n; y /= n;
  return { x, y, length: Math.hypot(x, y) };
}

/**
 * Coherence across stations, computed the way it was validated: each station
 * is reduced to its own mean heading FIRST, and only those headings are
 * compared.
 *
 * Doing it in one pass over every reading would let whichever station reports
 * most often decide the answer — a station logging every five minutes would
 * outvote an hourly one nine times over, and the question being asked is
 * whether the SITES agree, not whether the samples do.
 */
export function computeFieldCoherence(
  input: StationDirections[],
  minStations: number = MIN_STATIONS,
): FieldCoherence | null {
  const perStation: StationSteadiness[] = [];
  let sx = 0, sy = 0;

  for (const s of input) {
    const v = meanVector(s.directions);
    // A station whose directions cancel out has no heading to contribute, and
    // normalising what is left would turn rounding noise into a confident
    // direction. See MIN_STEADINESS.
    if (!v || v.length < MIN_STEADINESS) continue;
    perStation.push({
      stationId: s.stationId,
      steadiness: v.length,
      headingDeg: ((Math.atan2(v.y, v.x) * 180) / Math.PI + 360) % 360,
    });
    // Normalised, so a very steady station does not carry more weight than a
    // gusty one: the question is where each site says the wind is from, not
    // how sure it is.
    sx += v.x / v.length;
    sy += v.y / v.length;
  }

  if (perStation.length < minStations) return null;

  return {
    coherence: Math.hypot(sx, sy) / perStation.length,
    stations: perStation.length,
    perStation: perStation.sort((a, b) => b.steadiness - a.steadiness),
  };
}

export interface CeilingNotice {
  ceilingKt: number;
  coherence: number;
  localKt: number;
  stations: number;
}

/**
 * The afternoon ceiling. Returns null far more often than not, and that is the
 * intended behaviour: silence means "no reason to lower your expectations",
 * never "there will be wind".
 */
export function assessAfternoonCeiling(args: {
  /** Best local reading in the window, knots. Null when nothing reported. */
  localKt: number | null;
  field: FieldCoherence | null;
  /** Local hour, 0-23. */
  hour: number;
}): CeilingNotice | null {
  const { localKt, field, hour } = args;

  // Outside the window the relationship was never measured. Extending it to
  // the morning would be inventing skill the data does not support.
  if (hour < WINDOW_START_HOUR || hour > WINDOW_END_HOUR) return null;
  if (localKt == null || field == null) return null;

  // Both, never either. One low reading is a sheltered station; a scattered
  // field on its own can still precede a good evening.
  if (localKt >= LOCAL_CEILING_KT) return null;
  if (field.coherence >= COHERENCE_CEILING) return null;

  return {
    ceilingKt: CEILING_KT,
    coherence: field.coherence,
    localKt,
    stations: field.stations,
  };
}

/** Wording for the notice. States a ceiling, never an absence — two of the
 *  afternoons this would have flagged still reached 8.6 knots. */
export function describeCeiling(n: CeilingNotice): string {
  return `El viento no se ha asentado: las ${n.stations} estaciones de alrededor apuntan a direcciones distintas. `
    + `Con este cuadro la tarde no suele pasar de ${n.ceilingKt} kt.`;
}
