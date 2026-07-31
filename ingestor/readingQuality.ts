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
 */
export function applyQualityControl(r: NormalizedReading): QualityControlled {
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

  const reading = cleanGust !== r.windGust || cleanSpeed !== r.windSpeed
    ? { ...r, windGust: cleanGust, windSpeed: cleanSpeed }
    : r;

  return { reading, windGustRaw, windSpeedRaw, qcFlag };
}

/** Human-readable reasons, for logs and for the eventual audit query. */
export function describeQcFlag(qcFlag: number): string[] {
  const reasons: string[] = [];
  if (qcFlag & QC_GUST_ABSOLUTE) reasons.push('gust above absolute cap');
  if (qcFlag & QC_GUST_RATIO) reasons.push('gust above ratio to mean');
  if (qcFlag & QC_SPEED_ABSOLUTE) reasons.push('speed above absolute cap');
  return reasons;
}
