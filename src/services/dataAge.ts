/**
 * How old a reading is, for the rows of the side panel: the figure loses ink as the data ages, and
 * the age is written beside it (the fading never says it alone).
 */

/** Up to here a reading counts as «now» and the row says nothing about its age. */
export const DATA_OLD_MIN = 30;
/** From here a station is out of the running: last in the wind and temperature orders. */
export const DATA_GONE_MIN = 120;

export type DataAge = 'fresh' | 'old' | 'gone';

/** Limits of a source with its own cadence (a buoy arrives two hours late by design). */
export interface AgeLimits {
  oldMin: number;
  goneMin: number;
}

const STATION_LIMITS: AgeLimits = { oldMin: DATA_OLD_MIN, goneMin: DATA_GONE_MIN };

export function ageMinutes(at: Date | number | string | null | undefined, nowMs: number): number | null {
  if (at == null) return null;
  const ms = typeof at === 'number' ? at : new Date(at).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, (nowMs - ms) / 60_000);
}

export function dataAge(ageMin: number | null, limits: AgeLimits = STATION_LIMITS): DataAge {
  if (ageMin == null) return 'gone';
  if (ageMin > limits.goneMin) return 'gone';
  if (ageMin > limits.oldMin) return 'old';
  return 'fresh';
}

/** «hace 40 min», «hace 3 h», «hace 2 d». */
export function ageWords(ageMin: number): string {
  const min = Math.round(ageMin);
  if (min < 60) return `hace ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}
