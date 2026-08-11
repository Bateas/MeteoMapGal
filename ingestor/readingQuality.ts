/**
 * Quality control for incoming station readings.
 *
 * The rule this module exists to enforce: **the filter gets re-tuned, the
 * archive is forever.** Quality control must MARK a reading, never destroy it.
 *
 * The project already learned this the expensive way with fire detections,
 * where the display filter ran before the INSERT and years of night-time and
 * low-confidence hotspots were lost for good. `readings` had the same shape of
 * bug: a gust above 45kt, or more than 3x the mean, was set to null on its way
 * into the database with nothing kept and nothing recorded. Three things
 * followed from that, all of them permanent:
 *
 *  1. The 45kt threshold could never be re-tuned, because re-tuning needs the
 *     population of readings the threshold rejected, and that population was
 *     being erased as it arrived.
 *  2. A degrading anemometer was undetectable. There was no way to ask "which
 *     station gets its gusts rejected fifty times a month" — and the whole
 *     station bias map rests on knowing which sensors to trust.
 *  3. A genuine 50kt gust in a real storm was the single most likely value in
 *     the year to be censored, because the most important event looks the most
 *     like a glitch.
 *
 * What this does NOT change: the clean columns. `windSpeed` and `windGust` come
 * out of here exactly as they did before, rejections nulled, so every consumer
 * — scoring, alerts, the aggregates — sees precisely what it saw yesterday. The
 * archive is purely additive: the original value and the reason are recorded
 * alongside, and nothing downstream has to know they exist yet.
 */

import type { NormalizedReading } from '../src/types/station.js';

/** Above this, a gust is treated as a sensor artefact (~45kt). */
export const MAX_PLAUSIBLE_GUST_MS = 23;

/** A gust more than this multiple of the mean is treated as an artefact. */
export const MAX_GUST_RATIO = 3;

/** Above this, a sustained wind is not physically plausible here (~97kt). */
export const MAX_PLAUSIBLE_SPEED_MS = 50;

/**
 * Above this, solar radiation did not happen — it was measured wrong.
 *
 * The solar constant is ~1361 W/m² at the top of the atmosphere, and what
 * reaches a horizontal surface is that times the sine of the sun's elevation.
 * At this latitude the sun never gets higher than about 71°, even at the
 * solstice, so the absolute ceiling on a horizontal plane is 1361 × sin(71°) ≈
 * 1290 W/m² — before the atmosphere takes its cut. Nothing on the ground can
 * exceed what arrives above it.
 *
 * Deliberately well above the ~1000 W/m² of a clear midday, because cloud
 * enhancement is real: light reflected off the edge of a cumulus can briefly
 * push a pyranometer past the clear-sky maximum, and that is a genuine
 * measurement worth keeping. This cap only rejects the impossible.
 *
 * Measured on 8 Aug 2026: one station reporting 1360 W/m² while the network
 * median sat at 773. It matters because several detectors use ABSOLUTE
 * radiation thresholds — 250 W/m² decides "the sun is out" for the rain
 * discriminator and for Cesantes channelling, 350 for the fog signature — so an
 * inflated reading certifies sunshine where there is none.
 */
export const MAX_PLAUSIBLE_SOLAR_WM2 = 1300;

/**
 * Dew point may equal the air temperature — that is saturation, fog weather —
 * but it cannot exceed it. Air holding more water than it can hold is not a
 * weather event, it is two sensors disagreeing.
 *
 * The tolerance absorbs rounding: sources publish to one decimal, and some
 * derive dew point from temperature and humidity with their own rounding on
 * top, so a genuinely saturated reading can land a tenth or two above.
 */
export const DEWPOINT_TOLERANCE_C = 0.5;

/** Outside this, a temperature is an instrument fault, not weather. The record
 *  low anywhere in Galicia is around -20°C in the mountains and the Spanish
 *  record high is 47°C, so this is generous on both ends by design: it exists
 *  to catch the -35°C that a broken station once fed into a daily summary, not
 *  to referee heatwaves. */
export const MIN_PLAUSIBLE_TEMP_C = -25;
export const MAX_PLAUSIBLE_TEMP_C = 50;

/**
 * Reasons a reading was corrected, as a bitmask so several can coexist and a
 * single column can be counted per station and per month later on.
 */
export const QC_OK = 0;
/** Gust above the absolute cap. */
export const QC_GUST_ABSOLUTE = 1;
/** Gust above the allowed multiple of the mean. */
export const QC_GUST_RATIO = 2;
/** Sustained wind above the absolute cap. */
export const QC_SPEED_ABSOLUTE = 4;
/** Zero from an anemometer that has not moved in a day — stopped, not calm. */
export const QC_ANEMOMETER_STUCK = 8;
/** Solar radiation above what physically arrives at this latitude. */
export const QC_SOLAR_IMPOSSIBLE = 16;
/** Dew point above the air temperature: one of the two sensors is wrong. */
export const QC_DEWPOINT_ABOVE_TEMP = 32;
/** Temperature outside anything this region produces. */
export const QC_TEMP_IMPLAUSIBLE = 64;

export interface QualityControlled {
  /** The reading as every existing consumer expects it: rejections nulled. */
  reading: NormalizedReading;
  /** The original gust, kept ONLY when it was rejected. Null means untouched. */
  windGustRaw: number | null;
  /** The original speed, kept ONLY when it was rejected. Null means untouched. */
  windSpeedRaw: number | null;
  /**
   * Bitmask of reasons. Zero means "checked and clean" — which is different
   * from the NULL that older rows carry, and that difference is the point:
   * NULL means nobody looked, zero means somebody did.
   */
  qcFlag: number;
}

/**
 * Apply the plausibility checks, returning the clean reading plus what was
 * rejected and why. Pure — no clock, no database, no logging.
 *
 * `stuckAnemometers` is the one input this cannot derive for itself. A zero is
 * a perfectly valid reading — Castrelo is genuinely dead calm most mornings —
 * so a stopped instrument and a still day are indistinguishable in a single
 * reading, which is all this function ever sees. The distinction only exists
 * over time, so the caller measures it (findStuckAnemometers, 24h) and passes
 * the answer in. Absent the set, nothing changes and every zero is trusted.
 */
export function applyQualityControl(
  r: NormalizedReading,
  stuckAnemometers?: ReadonlySet<string>,
): QualityControlled {
  const speed = r.windSpeed;
  const gust = r.windGust;

  let qcFlag = QC_OK;
  let cleanGust = gust;
  let cleanSpeed = speed;
  let windGustRaw: number | null = null;
  let windSpeedRaw: number | null = null;

  if (gust !== null) {
    if (gust > MAX_PLAUSIBLE_GUST_MS) qcFlag |= QC_GUST_ABSOLUTE;
    // The ratio test only means anything against a mean that is actually
    // turning: at 0 m/s every gust is infinitely larger than the mean.
    if (speed != null && speed > 0 && gust > speed * MAX_GUST_RATIO) qcFlag |= QC_GUST_RATIO;
    if (qcFlag !== QC_OK) {
      windGustRaw = gust;
      cleanGust = null;
    }
  }

  if (speed !== null && speed > MAX_PLAUSIBLE_SPEED_MS) {
    qcFlag |= QC_SPEED_ABSOLUTE;
    windSpeedRaw = speed;
    cleanSpeed = null;
  }

  // A zero from an instrument that has not moved in 24 hours is not a
  // measurement of calm, it is the absence of a measurement — and the scoring
  // engines treat those two very differently. Both skip a null wind; both
  // WEIGHT a zero, and a zero from a spot's preferred station arrives with an
  // exposure boost on top, so it does not merely dilute the consensus, it
  // dominates it toward calm. That is the shape of the bug this closes: the
  // reservoir's SkyX fed 0.0 kt into Castrelo for at least a week while the
  // water had 15-18 kt on it.
  //
  // Nulled, not dropped: the raw zero and the reason go to the archive, so the
  // rule stays re-tunable and "which anemometer stopped, and when" remains an
  // answerable question rather than a silence.
  if (stuckAnemometers?.has(r.stationId)) {
    if (cleanSpeed === 0) {
      qcFlag |= QC_ANEMOMETER_STUCK;
      windSpeedRaw = 0;
      cleanSpeed = null;
    }
    if (cleanGust === 0) {
      qcFlag |= QC_ANEMOMETER_STUCK;
      windGustRaw = 0;
      cleanGust = null;
    }
  }

  // ── Physical impossibilities
  //
  // These three differ from the wind checks above in a way that decides how
  // they behave: the wind caps are a JUDGEMENT (45kt is a choice, and choices
  // get re-tuned, which is why the rejected gust is archived). What follows is
  // not a choice. More radiation than the sun delivers, water vapour above
  // saturation, and -35°C in Galicia are not extreme weather to be argued
  // about later — they are instrument faults. There is no threshold to
  // re-tune, so there is nothing the archive could tell us that the flag does
  // not already say, and no new column is worth carrying for it.
  //
  // Everything else about them is the same: the reading is nulled, never
  // dropped, and the reason is recorded so "which sensor drifts, and when"
  // stays an answerable question.

  let cleanSolar = r.solarRadiation;
  if (cleanSolar !== null && cleanSolar > MAX_PLAUSIBLE_SOLAR_WM2) {
    qcFlag |= QC_SOLAR_IMPOSSIBLE;
    cleanSolar = null;
  }

  let cleanTemp = r.temperature;
  if (cleanTemp !== null && (cleanTemp < MIN_PLAUSIBLE_TEMP_C || cleanTemp > MAX_PLAUSIBLE_TEMP_C)) {
    qcFlag |= QC_TEMP_IMPLAUSIBLE;
    cleanTemp = null;
  }

  // The dew point is the one that gets dropped, not the temperature. Both are
  // suspect once they disagree and this cannot tell which, but temperature is
  // usually measured directly while dew point is often derived from it and the
  // humidity — so the derived value is the likelier fault and by far the more
  // widely read. Note this compares against the CLEANED temperature: if the
  // temperature was already rejected as impossible there is nothing left to
  // compare against, and the dew point survives on its own merits.
  let cleanDew = r.dewPoint;
  if (cleanDew !== null && cleanTemp !== null && cleanDew > cleanTemp + DEWPOINT_TOLERANCE_C) {
    qcFlag |= QC_DEWPOINT_ABOVE_TEMP;
    cleanDew = null;
  }

  const touched = cleanGust !== r.windGust
    || cleanSpeed !== r.windSpeed
    || cleanSolar !== r.solarRadiation
    || cleanTemp !== r.temperature
    || cleanDew !== r.dewPoint;

  const reading = touched
    ? {
        ...r,
        windGust: cleanGust,
        windSpeed: cleanSpeed,
        solarRadiation: cleanSolar,
        temperature: cleanTemp,
        dewPoint: cleanDew,
      }
    : r;

  return { reading, windGustRaw, windSpeedRaw, qcFlag };
}

/**
 * What a cycle's quality control actually did, for the log.
 *
 * Without this the checks are invisible. Nothing downstream changes when a
 * value is rejected — the column simply arrives null, exactly as it does when a
 * station never had that sensor — so a filter that silently stopped working and
 * a filter with nothing to reject look identical from outside. This project has
 * already paid for that twice: the fire display filter ran before the insert
 * for years, and an anemometer sat at zero for a week while the map read 6kt
 * against 15 on the water. Both were silent.
 *
 * Stations are named only for the physical impossibilities. The wind caps fire
 * routinely — a cup anemometer throws spurious peaks and that is the ordinary
 * business of the filter — so naming those would bury the log in noise every
 * cycle. A dew point above the air temperature is not routine: it means an
 * instrument needs looking at, and the log should say which.
 */
export interface QualityControlSummary {
  /** Readings with at least one correction. */
  corrected: number;
  /** How many times each reason fired, keyed by its description. */
  byReason: Record<string, number>;
  /** Stations behind the physical impossibilities, deduplicated. */
  suspectStations: string[];
}

/** Reasons worth naming a station for: an instrument fault, not a rough gust. */
const NAMED_REASONS = QC_SOLAR_IMPOSSIBLE | QC_DEWPOINT_ABOVE_TEMP | QC_TEMP_IMPLAUSIBLE;

/** Cap on named stations so one badly broken source cannot flood a log line. */
export const MAX_NAMED_STATIONS = 8;

export function summariseQualityControl(
  controlled: readonly { reading: NormalizedReading; qcFlag: number }[],
): QualityControlSummary {
  const byReason: Record<string, number> = {};
  const suspects = new Set<string>();
  let corrected = 0;

  for (const c of controlled) {
    if (c.qcFlag === QC_OK) continue;
    corrected++;
    for (const reason of describeQcFlag(c.qcFlag)) {
      byReason[reason] = (byReason[reason] ?? 0) + 1;
    }
    if (c.qcFlag & NAMED_REASONS) suspects.add(c.reading.stationId);
  }

  return { corrected, byReason, suspectStations: [...suspects].slice(0, MAX_NAMED_STATIONS) };
}

/** One line for the cycle log, or null when there was nothing to say. */
export function describeQualityControl(s: QualityControlSummary): string | null {
  if (s.corrected === 0) return null;
  const reasons = Object.entries(s.byReason)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${n} ${reason}`)
    .join(' · ');
  const named = s.suspectStations.length > 0 ? ` — check: ${s.suspectStations.join(', ')}` : '';
  return `QC corrected ${s.corrected} readings: ${reasons}${named}`;
}

/** Human-readable reasons, for logs and for the eventual audit query. */
export function describeQcFlag(qcFlag: number): string[] {
  const reasons: string[] = [];
  if (qcFlag & QC_GUST_ABSOLUTE) reasons.push('gust above absolute cap');
  if (qcFlag & QC_GUST_RATIO) reasons.push('gust above ratio to mean');
  if (qcFlag & QC_SPEED_ABSOLUTE) reasons.push('speed above absolute cap');
  if (qcFlag & QC_ANEMOMETER_STUCK) reasons.push('zero from a stopped anemometer');
  if (qcFlag & QC_SOLAR_IMPOSSIBLE) reasons.push('solar above what reaches this latitude');
  if (qcFlag & QC_DEWPOINT_ABOVE_TEMP) reasons.push('dew point above air temperature');
  if (qcFlag & QC_TEMP_IMPLAUSIBLE) reasons.push('temperature outside the regional range');
  return reasons;
}
