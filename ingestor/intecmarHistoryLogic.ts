/**
 * The pure half of the INTECMAR history (intecmarHistory.ts): which month of which series to ask next,
 * and how many requests a night may spend on it.
 *
 * Why: INTECMAR keeps the platforms' record from August 2007 and offers it only through the API. They
 * asked (21-oct-2026) for it month by month and suggested hourly or daily values; on 29-oct they explained
 * the aggregated call (/moorings/data/{station}/{parameter}/hourly with function=AVG|MAX|MIN) and that
 * each year's quality codes are closed in a yearly review by the middle of the next year (2025 already
 * closed). Measured on 29-oct: one month of hourly values answers in 1-3 s; three months or more fail with
 * a 500 after ~5 s, so one request is one month of one series. We told INTECMAR in writing: at most about
 * a thousand requests a night.
 *
 * Unattended on purpose: the ledger of months (intecmar_history_months) is the state, so a restart goes
 * on where it stopped; every month that ends is asked once it is complete; a month read before its year
 * was closed is read once more after July 1 of the next year; a month that failed is retried a week later,
 * three times at most, and then stays visible as an error in Grafana instead of being asked forever.
 */
import { dedupePlatformRows, platformPlan, platformRows, type PlatformRow } from './intecmarLogic.js';

export interface HistorySeries {
  station: number;
  parameterId: number;
  /** As asked and as published: AVG (hourly mean) or MAX (for the wind, the hour's highest gust). */
  func: string;
}

/** Cortegada's first hourly value is 2007-08-01 01:00 UTC (29-oct); the other platforms start later. */
export const HISTORY_FIRST_MONTH = '2007-08';
/** What we told INTECMAR (29-oct): at most about a thousand requests a night. */
export const HISTORY_NIGHT_MAX = 1000;
/** Only at night: from 02 UTC (after the night archive, 01 UTC) to 07 UTC. A restart in the afternoon
 *  waits for the night; a night that reaches 07 UTC stops and goes on the next one. */
export const HISTORY_FIRST_HOUR_UTC = 2;
export const HISTORY_LAST_HOUR_UTC = 7;

export function inHistoryWindow(nowMs: number): boolean {
  const h = new Date(nowMs).getUTCHours();
  return h >= HISTORY_FIRST_HOUR_UTC && h < HISTORY_LAST_HOUR_UTC;
}
export const HISTORY_RETRY_MS = 7 * 86_400_000;
export const HISTORY_MAX_ATTEMPTS = 3;
/** Kept free above what the live feed still needs today. */
export const HISTORY_LIVE_MARGIN = 100;

/**
 * Cíes (15002), dead since 4-dec-2025, keeps its record: its own catalogue (29-oct) lists hourly wind
 * (mean and gust), direction, air temperature, humidity, water temperature and salinity, and no hourly
 * dew point.
 */
const CIES: Array<[number, string]> = [[81, 'AVG'], [81, 'MAX'], [82, 'AVG'], [83, 'AVG'], [86, 'AVG'], [20003, 'AVG'], [20005, 'AVG']];

/**
 * The night archive's series (intecmarLogic.platformPlan), with the gust asked as the hour's MAX of the
 * wind (there is no hourly «RACHA»: MAX of parameter 81 is «racha máxima horaria», 29-oct), plus Cíes.
 */
export function historyPlan(): HistorySeries[] {
  const live = platformPlan().map((p) => ({ station: p.station, parameterId: p.parameterId, func: p.func === 'RACHA' ? 'MAX' : p.func }));
  return [...live, ...CIES.map(([parameterId, func]) => ({ station: 15002, parameterId, func }))];
}

// ── Months ──────────────────────────────────────────────

function monthIndex(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return y * 12 + (m - 1);
}

function monthOf(index: number): string {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The last month already over (UTC): in October, September. */
export function lastCompleteMonth(nowMs: number): string {
  const d = new Date(nowMs);
  return monthOf(d.getUTCFullYear() * 12 + d.getUTCMonth() - 1);
}

/** Every month from `newest` back to `oldest`, newest first. */
export function monthsBack(newest: string, oldest: string = HISTORY_FIRST_MONTH): string[] {
  const out: string[] = [];
  for (let i = monthIndex(newest); i >= monthIndex(oldest); i--) out.push(monthOf(i));
  return out;
}

/** The request window of a month. The API's end_date stops at 00:00 of the day it names. */
export function monthWindow(month: string): { begin: string; end: string } {
  return { begin: `${month}-01`, end: `${monthOf(monthIndex(month) + 1)}-01` };
}

/** Start and end (ms, UTC) of a month: rows outside it (the 00:00 sample of the next one) are left out. */
export function monthBounds(month: string): { startMs: number; endMs: number } {
  const i = monthIndex(month);
  return { startMs: Date.UTC(Math.floor(i / 12), i % 12, 1), endMs: Date.UTC(Math.floor((i + 1) / 12), (i + 1) % 12, 1) };
}

/**
 * The rows of an answer that belong to its month (the 00:00 sample of the next month is left out, and the
 * series INTECMAR lists twice counted once), or none when the month has no value at all: before a
 * platform existed, or for a sensor it never had, they publish every hour as -9999.
 */
export function monthRows(payload: unknown, month: string): PlatformRow[] {
  const { startMs, endMs } = monthBounds(month);
  const rows = dedupePlatformRows(platformRows(payload)).rows.filter((r) => r.time.getTime() >= startMs && r.time.getTime() < endMs);
  return rows.some((r) => r.value != null) ? rows : [];
}

/** When a month's codes are final: INTECMAR closes year Y by the middle of Y+1 (taken as July 1). */
export function consolidatedFromMs(month: string): number {
  return Date.UTC(Number(month.slice(0, 4)) + 1, 6, 1);
}

// ── What to ask ─────────────────────────────────────────

export type HistoryStatus = 'ok' | 'empty' | 'error';

/** One row of intecmar_history_months. `attempts` counts the failed tries. */
export interface HistoryMonth {
  station: number;
  parameterId: number;
  func: string;
  month: string;
  status: HistoryStatus;
  attempts: number;
  fetchedAtMs: number;
}

export interface HistoryTask {
  series: HistorySeries;
  month: string;
  why: 'nuevo' | 'consolidar' | 'reintento';
}

const keyOf = (station: number, parameterId: number, func: string, month: string) => `${station}|${parameterId}|${func}|${month}`;

/**
 * What is still owed, in the order to ask it: months never asked, newest first (the recent years overlap
 * our own stations, so they are the most useful soonest); then months to read again because their year
 * was closed after we read them, oldest first; then failed months due for another try.
 */
export function historyQueue(done: HistoryMonth[], nowMs: number, plan: HistorySeries[] = historyPlan()): HistoryTask[] {
  const byKey = new Map(done.map((d) => [keyOf(d.station, d.parameterId, d.func, d.month), d]));
  const fresh: HistoryTask[] = [];
  const consolidate: HistoryTask[] = [];
  const retry: HistoryTask[] = [];
  for (const month of monthsBack(lastCompleteMonth(nowMs))) {
    for (const series of plan) {
      const d = byKey.get(keyOf(series.station, series.parameterId, series.func, month));
      if (!d) { fresh.push({ series, month, why: 'nuevo' }); continue; }
      if (d.status === 'error') {
        if (d.attempts < HISTORY_MAX_ATTEMPTS && nowMs - d.fetchedAtMs >= HISTORY_RETRY_MS) retry.push({ series, month, why: 'reintento' });
        continue;
      }
      const closed = consolidatedFromMs(month);
      if (d.fetchedAtMs < closed && nowMs >= closed) consolidate.push({ series, month, why: 'consolidar' });
    }
  }
  return [...fresh, ...consolidate.reverse(), ...retry];
}

// ── How much tonight ────────────────────────────────────

/**
 * Requests the live feed still needs before 00:00 UTC (its passes left times its requests per pass, plus
 * a margin), so the history never takes what the map reads in real time.
 */
export function liveReserve(nowMs: number, liveIntervalMs: number, livePerPass: number, liveOn: boolean): number {
  if (!liveOn) return HISTORY_LIVE_MARGIN;
  const endOfDay = (Math.floor(nowMs / 86_400_000) + 1) * 86_400_000;
  return Math.ceil((endOfDay - nowMs) / liveIntervalMs) * livePerPass + HISTORY_LIVE_MARGIN;
}

/** Tonight's requests: what is left of the night's thousand, never eating into the live reserve. */
export function historyBudget(spentToday: number, requestsLeft: number, reserve: number): number {
  return Math.max(0, Math.min(HISTORY_NIGHT_MAX - spentToday, requestsLeft - reserve));
}
