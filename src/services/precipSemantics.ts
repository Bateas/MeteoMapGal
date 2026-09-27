/**
 * What a station's `precipitation` number means, per network, and how much rain it
 * says fell in a time window.
 *
 * The field has the same name everywhere and three different meanings:
 *   - interval  (mg_, aemet_, ipma_): rain in the interval that ends at the reading.
 *     Summing the readings of a window gives the rain of the window.
 *   - rolling60 (nt_): Netatmo's rain of the last 60 minutes, recomputed at every reading.
 *     Summing it counts the same rain several times.
 *   - dayTotal  (wu_, mc_): a counter accumulated since it last reset, at an hour that
 *     varies by station. Read raw it keeps saying "it rained" all afternoon after a
 *     shower at dawn; what matters is how much it GREW.
 *
 * Pure and generic on purpose: the rain veto of the Cesantes detector uses it, and so
 * can anything else that needs "how much rain fell here in the last N minutes".
 */

import type { NormalizedReading } from '../types/station';

export type PrecipKind = 'interval' | 'rolling60' | 'dayTotal';

export interface PrecipSample {
  /** Reading time, epoch ms */
  t: number;
  /** The station's precipitation value, in mm, with its network's meaning */
  mm: number;
}

const MIN_MS = 60_000;
/** A dayTotal counter needs a reading before the window to measure growth from; one
 *  older than this says too little about where the counter stood when the window opened. */
const DAY_TOTAL_BASELINE_MAX_MIN = 30;

/** The meaning of the precipitation field for a station id, by its source prefix.
 *  Null when the network's meaning is unknown: better no number than a wrong one. */
export function precipKindFor(id: string): PrecipKind | null {
  if (id.startsWith('mg_') || id.startsWith('aemet_') || id.startsWith('ipma_')) return 'interval';
  if (id.startsWith('nt_')) return 'rolling60';
  if (id.startsWith('wu_') || id.startsWith('mc_')) return 'dayTotal';
  return null;
}

/** Precipitation samples of one station from its reading history plus its current
 *  reading. Keeps only readings that carry a value, one per timestamp (the current
 *  reading wins a tie), sorted by time. The history is NOT assumed sorted. */
export function precipSamplesFromHistory(
  h: NormalizedReading[] | undefined,
  current: NormalizedReading | undefined,
): PrecipSample[] {
  const byT = new Map<number, number>();
  const add = (r: NormalizedReading | undefined) => {
    if (!r || r.precipitation == null || !Number.isFinite(r.precipitation) || r.precipitation < 0) return;
    const t = r.timestamp.getTime();
    if (!Number.isFinite(t)) return;
    byT.set(t, r.precipitation);
  };
  for (const r of h ?? []) add(r);
  add(current);
  return [...byT].map(([t, mm]) => ({ t, mm })).sort((a, b) => a.t - b.t);
}

/**
 * Rain (mm) that fell in the `windowMin` minutes up to `nowMs`, read with the meaning of
 * the station's network. Null when it cannot be told: unknown network, no reading in the
 * window, or fewer than 2 readings to measure a dayTotal counter's growth.
 *
 *   - interval: sum of the readings stamped in (now - window, now]. A reading stamped exactly
 *     at the window start holds the rain of the interval BEFORE it, so it stays out.
 *   - rolling60: the largest reading whose own hour lies inside the window, i.e. stamped
 *     in [now - max(60, window - 60), now]. For a window under an hour it can only
 *     over-state (the reading covers a full hour).
 *   - dayTotal: sum of the positive steps of the counter, starting from the last reading
 *     at or before the window start (at most 30 min before it) or, if there is none, from
 *     the first reading inside the window. A negative step is a reset, not negative rain.
 */
export function rainInWindowMm(id: string, s: PrecipSample[], nowMs: number, windowMin: number): number | null {
  const kind = precipKindFor(id);
  if (kind === null) return null;
  const sorted = s
    .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.mm) && x.t <= nowMs)
    .sort((a, b) => a.t - b.t);
  const start = nowMs - windowMin * MIN_MS;

  if (kind === 'interval') {
    const inWin = sorted.filter((x) => x.t > start);
    if (inWin.length === 0) return null;
    return round2(inWin.reduce((sum, x) => sum + x.mm, 0));
  }

  if (kind === 'rolling60') {
    const lo = nowMs - Math.max(60, windowMin - 60) * MIN_MS;
    const inWin = sorted.filter((x) => x.t >= lo);
    if (inWin.length === 0) return null;
    return round2(Math.max(...inWin.map((x) => x.mm)));
  }

  // dayTotal
  let from = -1;
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i].t;
    if (t <= start && t >= start - DAY_TOTAL_BASELINE_MAX_MIN * MIN_MS) from = i;
  }
  if (from < 0) from = sorted.findIndex((x) => x.t > start);
  if (from < 0 || sorted.length - from < 2) return null;
  let sum = 0;
  for (let i = from + 1; i < sorted.length; i++) sum += Math.max(0, sorted[i].mm - sorted[i - 1].mm);
  return round2(sum);
}

/** Hundredths of a mm: gauges resolve 0.1-0.25 mm, and float noise (4.52 - 4.32 =
 *  0.1999...) must not decide whether a threshold of 0.2 is reached. */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
