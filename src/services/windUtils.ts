const CARDINALS = [
  'N', 'NNE', 'NE', 'ENE',
  'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW',
  'W', 'WNW', 'NW', 'NNW',
] as const;

export type CardinalDirection = (typeof CARDINALS)[number];

/** Convert degrees (0-360) to cardinal direction */
export function degreesToCardinal(degrees: number): CardinalDirection {
  const index = Math.round(((degrees % 360) + 360) % 360 / 22.5) % 16;
  return CARDINALS[index];
}

/** Get wind arrow rotation in degrees. Wind direction from AEMET is "from" direction,
 *  arrow should point where wind is going TO → add 180° */
export function windArrowRotation(fromDegrees: number): number {
  return (fromDegrees + 180) % 360;
}

/**
 * Color for wind speed visualization — tuned for inland reservoir conditions.
 * More color resolution in the 3–17 kt range where most sailing action happens.
 * Input: speed in m/s. Thresholds shown in approximate knots.
 */
/**
 * The map's scale, in whole knots (the figure on screen): under 6 calma, under 8 flojo, under 12 navegable, under 18
 * bueno, the rest fuerte. One list for spot, arrow and wind layer: they had their own cuts, so at 6-7 kt the spot was
 * blue beside a green arrow, and at 12 kt gold beside a lime one.
 */
export const WIND_STEPS_KT = [6, 8, 12, 18] as const;

export function windStep(kt: number): 0 | 1 | 2 | 3 | 4 {
  const rounded = Math.round(kt);
  if (rounded < WIND_STEPS_KT[0]) return 0;
  if (rounded < WIND_STEPS_KT[1]) return 1;
  if (rounded < WIND_STEPS_KT[2]) return 2;
  if (rounded < WIND_STEPS_KT[3]) return 3;
  return 4;
}

/**
 * The colour of the wind: one scale for the whole app (18-nov). The colour says how
 * much wind there is and always goes from less to more (cold, warm, extreme); the word is the spot's verdict, five
 * steps (windStep). Up to 18 kt the cuts are the app's sailing ones; above, Beaufort: 22 kt is force 6 (and «viento
 * fuerte» for AEMET, 41 km/h), 34 kt force 8 (gale), 48 kt force 10 (storm), 56 kt force 11 (violent storm, the darkest
 * violet: gusts of 47-72 kt have been measured on the capes). There is no official colour standard for wind (WMO, AEMET and Beaufort
 * publish none); the order follows the usual wind maps: blue and green for little, yellow to red for a lot, magenta
 * and violet for the extreme.
 */
export const WIND_TONE_STEPS_KT = [...WIND_STEPS_KT, 22, 34, 48, 56] as const;
/** The token suffix of each tone: --g-s-*, --g-c-*, --g-ct-*. */
export const WIND_TONE_NAMES = ['calma', 'flojo', 'navegable', 'bueno', 'fuerte', 'duro', 'temporal', 'tduro', 'tmduro'] as const;
export type WindToneName = typeof WIND_TONE_NAMES[number];
export type WindTone = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export function windTone(kt: number): WindTone {
  const rounded = Math.round(kt);
  let tone = 0;
  while (tone < WIND_TONE_STEPS_KT.length && rounded >= WIND_TONE_STEPS_KT[tone]) tone++;
  return tone as WindTone;
}

/** The --g-s-* tokens of each theme as hex, for what is painted on a canvas: at least 3:1 on its own background. */
export const WIND_TONES_ON_DARK = ['#a3aca7', '#62a8f5', '#37bd78', '#f5b82e', '#ff8a3d', '#ff4d4d', '#e45cff', '#9d7bff', '#6a3df0'] as const;
export const WIND_TONES_ON_LIGHT = ['#868f8a', '#3480d2', '#128f5a', '#b67c00', '#c2560c', '#b8322c', '#9a1fb0', '#5b2bb5', '#2e0f5c'] as const;

/** Wind in m/s → its colour on the scale. It depends on the map drawn: the street map is light under a dark theme too. */
export function windSpeedColor(speed: number | null, onDarkMap = true): string {
  const tones = onDarkMap ? WIND_TONES_ON_DARK : WIND_TONES_ON_LIGHT;
  return tones[speed === null ? 0 : windTone(msToKnots(speed))];
}

/** Color for temperature visualization */
export function temperatureColor(temp: number | null): string {
  if (temp === null) return '#6b7280'; // gray-500
  if (temp < 0) return '#2a55c3';
  if (temp < 5) return '#4c85e3';
  if (temp < 10) return '#47b3cb';
  if (temp < 15) return '#4fc06d';
  if (temp < 20) return '#8dc84b';
  if (temp < 25) return '#e2b64b';
  if (temp < 30) return '#eb7e42';
  if (temp < 35) return '#e05853';
  return '#8e2d28';
}

/** Convert m/s to knots */
export function msToKnots(speed: number): number {
  if (!Number.isFinite(speed)) return 0;
  return speed * 1.94384;
}

/** Format wind speed for display (input m/s, output knots) */
export function formatWindSpeed(speedMs: number | null): string {
  if (speedMs === null) return '--';
  return `${msToKnots(speedMs).toFixed(1)} kt`;
}

// ── Pressure & dew point utilities ──────────────────────

// ── Direction utilities ──────────────────────────────────

const CARDINALS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Convert degrees (0-360) to 8-point cardinal (N, NE, E, SE, S, SW, W, NW) */
export function degToCardinal8(deg: number): string {
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return CARDINALS_8[idx];
}

/**
 * Angular difference between two directions (0-180°).
 * Accounts for wraparound (e.g. 350° vs 10° = 20°).
 */
export function angleDifference(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Circular mean of wind directions using sin/cos decomposition.
 * Returns null if input is empty or all values are null.
 */
export function averageWindDirection(directions: (number | null)[]): number | null {
  const valid = directions.filter((d): d is number => d !== null);
  if (valid.length === 0) return null;

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  let sinSum = 0;
  let cosSum = 0;

  for (const dir of valid) {
    sinSum += Math.sin(toRad(dir));
    cosSum += Math.cos(toRad(dir));
  }

  const avgRad = Math.atan2(sinSum / valid.length, cosSum / valid.length);
  const avgDeg = ((avgRad * 180) / Math.PI + 360) % 360;
  return avgDeg;
}

/**
 * Check if a direction falls within a range, handling 0/360 wraparound.
 * Range { from: 315, to: 45 } means 315°→0°→45° (through north).
 */
export function isDirectionInRange(
  direction: number,
  range: { from: number; to: number }
): boolean {
  const dir = ((direction % 360) + 360) % 360;
  const { from, to } = range;

  if (from <= to) {
    // Normal range (e.g., 90 to 270)
    return dir >= from && dir <= to;
  }
  // Wraparound range (e.g., 315 to 45 → through north)
  return dir >= from || dir <= to;
}

/**
 * Carry a gust from the station that measured it to the spot being described.
 *
 * The engine boosts the mean wind when a spot's own terrain accelerates the
 * flow — a sheltered valley station reading 5kt while the water has 14. The
 * gust has to make the same journey or the card contradicts itself: for a while
 * the popup showed a boosted headline above a raw gust, printing a gust BELOW
 * the mean, which cannot happen and which anyone notices at a glance.
 *
 * It must not be scaled up with the mean, though: the boost says the WATER carries more
 * wind than the sheltered station, not that the water is gustier. The measured gust is kept,
 * floored at 1.1x the boosted mean and capped at 1.3x of it (see the body for the 25-sep case).
 *
 * @param gustKt     what the instrument read, or null when it has no gust
 * @param measuredKt the mean the same instruments read
 * @param effectiveKt the mean the verdict actually used, after any boost
 * @param capKt      ceiling, so a large boost on an already gusty reading
 *                   cannot print a number no station here has recorded
 */
export function scaleGustToSpot(
  gustKt: number | null,
  measuredKt: number,
  effectiveKt: number,
  capKt: number,
): number | null {
  if (gustKt === null || !Number.isFinite(gustKt)) return null;
  // No boost in play, or no mean to scale against: the reading stands as it is.
  if (measuredKt <= 0 || !Number.isFinite(measuredKt) || !Number.isFinite(effectiveKt)) return gustKt;
  if (effectiveKt <= measuredKt) return gustKt;

  // The gust travels with the mean but is never invented on top of it. Over flat water in a
  // thermal breeze the gust factor is small: 25-sep at Cesantes the water carried 12.5kt with
  // gusts of 14 (x1.1), while the old floor of 1.25x an already boosted 15kt printed "Racha 20",
  // above any gust a station recorded all day (Porto de Vigo peaked at 17.3). So:
  //   - floor: 1.1x the mean, so the gust is never below the wind it accompanies;
  //   - otherwise the gust actually measured nearby, up to 1.3x the mean — never scaled up.
  const minGust = Math.round(effectiveKt * 1.1);
  const ceiling = Math.round(effectiveKt * 1.3);
  const finalGust = Math.min(Math.max(minGust, Math.min(gustKt, ceiling)), capKt);

  return finalGust;
}
