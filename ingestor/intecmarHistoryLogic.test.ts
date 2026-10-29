import { describe, expect, it } from 'vitest';
import {
  consolidatedFromMs, HISTORY_FIRST_MONTH, HISTORY_LIVE_MARGIN, HISTORY_MAX_ATTEMPTS, HISTORY_NIGHT_MAX, HISTORY_RETRY_MS,
  historyBudget, historyPlan, historyQueue, lastCompleteMonth, liveReserve, monthBounds, monthRows, monthsBack, monthWindow,
  type HistoryMonth, type HistorySeries,
} from './intecmarHistoryLogic';
import { platformPlan } from './intecmarLogic';

const NOW = Date.parse('2026-10-29T02:30:00Z');
const DAY = 86_400_000;

describe('the series of the history', () => {
  it('are the night archive series, with the gust asked as the hourly MAX, plus Cíes', () => {
    const plan = historyPlan();
    expect(plan.filter((s) => s.station !== 15002)).toHaveLength(platformPlan().length);
    expect(plan.some((s) => s.func === 'RACHA')).toBe(false);
    expect(plan.filter((s) => s.station === 15001 && s.parameterId === 81).map((s) => s.func).sort()).toEqual(['AVG', 'MAX']);
  });

  it('Cíes gets only what its catalogue publishes hourly: no dew point', () => {
    const cies = historyPlan().filter((s) => s.station === 15002);
    expect(cies.map((s) => s.parameterId)).not.toContain(10018);
    expect(cies).toHaveLength(7);
  });
});

describe('months', () => {
  it('the last complete month is the one before the current UTC month, across a new year too', () => {
    expect(lastCompleteMonth(NOW)).toBe('2026-09');
    expect(lastCompleteMonth(Date.parse('2027-01-01T00:30:00Z'))).toBe('2026-12');
  });

  it('go from the newest back to August 2007', () => {
    const all = monthsBack('2026-09');
    expect(all[0]).toBe('2026-09');
    expect(all[all.length - 1]).toBe(HISTORY_FIRST_MONTH);
    expect(all).toHaveLength(19 * 12 + 2); // 2007-08 .. 2026-09
  });

  it('one request is one month: the API end date is the first day of the next month', () => {
    expect(monthWindow('2025-12')).toEqual({ begin: '2025-12-01', end: '2026-01-01' });
    const b = monthBounds('2025-12');
    expect(new Date(b.startMs).toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(new Date(b.endMs).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('a year is final from July 1 of the next year', () => {
    expect(new Date(consolidatedFromMs('2026-03')).toISOString()).toBe('2027-07-01T00:00:00.000Z');
  });
});

const ONE: HistorySeries[] = [{ station: 15001, parameterId: 20003, func: 'AVG' }];
const row = (month: string, over: Partial<HistoryMonth> = {}): HistoryMonth => ({
  station: 15001, parameterId: 20003, func: 'AVG', month, status: 'ok', attempts: 0, fetchedAtMs: NOW - DAY, ...over,
});

// The shape of a real hourly answer (29-oct): one series per depth, the 3 m one listed twice, newest first.
const series = (depth: number, samples: Array<[string, number, number]>) => ({
  StationCode: 15001, ParameterId: 20003, ParameterCode: 'TAU', Function: 'AVG', Depth: depth,
  Samples: samples.map(([Date, Value, QualityCode]) => ({ Date, Value, QualityCode })),
});

describe('the rows of a month', () => {
  it('keep the month, drop the next month 00:00 sample and the series listed twice', () => {
    const answer = [
      series(1, [['2025-02-01T00:00:00Z', 11.4, 1], ['2025-01-31T23:00:00Z', 11.5, 1], ['2025-01-01T00:00:00Z', -9999, 9]]),
      series(3, [['2025-02-01T00:00:00Z', 12.2, 1], ['2025-01-31T23:00:00Z', 12.3, 1]]),
      series(3, [['2025-02-01T00:00:00Z', 12.2, 1], ['2025-01-31T23:00:00Z', 12.3, 1]]),
    ];
    const rows = monthRows(answer, '2025-01');
    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.time.toISOString() === '2025-02-01T00:00:00.000Z')).toBe(false);
    expect(rows.find((r) => r.depthM === 1 && r.time.toISOString() === '2025-01-01T00:00:00.000Z')).toMatchObject({ value: null, qualityCode: 9 });
  });

  it('a month where every hour is -9999 is empty: nothing to store', () => {
    expect(monthRows([series(4, [['2025-07-01T00:00:00Z', -9999, 9], ['2025-07-31T23:00:00Z', -9999, 9]])], '2025-07')).toEqual([]);
    expect(monthRows([], '2025-07')).toEqual([]);
  });
});

describe('the queue', () => {
  it('starts with the newest month never asked', () => {
    const q = historyQueue([], NOW, ONE);
    expect(q[0]).toMatchObject({ month: '2026-09', why: 'nuevo' });
    expect(q).toHaveLength(monthsBack('2026-09').length);
  });

  it('skips what is done, and asks a month again once its year is closed', () => {
    const done = monthsBack('2026-09').map((m) => row(m));
    expect(historyQueue(done, NOW, ONE)).toEqual([]);
    const july2027 = Date.parse('2027-07-02T02:30:00Z');
    const again = historyQueue(done, july2027, ONE);
    // the months of 2026 read in 2026 (2026-10 .. 2027-06 are new by then and go first)
    expect(again.filter((t) => t.why === 'consolidar').map((t) => t.month)).toEqual(
      ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(again[0].why).toBe('nuevo');
  });

  it('a month of a closed year read now is final: never read again', () => {
    const done = [row('2025-05', { fetchedAtMs: NOW })];
    const later = historyQueue(done, Date.parse('2030-01-01T03:00:00Z'), ONE);
    expect(later.some((t) => t.month === '2025-05')).toBe(false);
  });

  it('retries a failed month after a week, three times at most, then leaves it for Grafana', () => {
    const failedYesterday = [row('2026-09', { status: 'error', attempts: 1, fetchedAtMs: NOW - DAY })];
    expect(historyQueue(failedYesterday, NOW, ONE).some((t) => t.month === '2026-09')).toBe(false);
    const failedLastWeek = [row('2026-09', { status: 'error', attempts: 2, fetchedAtMs: NOW - HISTORY_RETRY_MS })];
    expect(historyQueue(failedLastWeek, NOW, ONE).find((t) => t.month === '2026-09')?.why).toBe('reintento');
    const givenUp = [row('2026-09', { status: 'error', attempts: HISTORY_MAX_ATTEMPTS, fetchedAtMs: NOW - 30 * DAY })];
    expect(historyQueue(givenUp, NOW, ONE).some((t) => t.month === '2026-09')).toBe(false);
  });

  it('an empty month counts as done (the platform did not exist yet)', () => {
    expect(historyQueue([row('2008-01', { status: 'empty' })], NOW, ONE).some((t) => t.month === '2008-01')).toBe(false);
  });
});

describe('the night budget', () => {
  it('keeps what the live feed still needs today, plus a margin', () => {
    // 02:30 UTC, every 30 min, 37 requests a pass: 43 passes left
    expect(liveReserve(NOW, 30 * 60_000, 37, true)).toBe(43 * 37 + HISTORY_LIVE_MARGIN);
    expect(liveReserve(NOW, 30 * 60_000, 37, false)).toBe(HISTORY_LIVE_MARGIN);
  });

  it('never passes the thousand a night, nor the live reserve, nor goes below zero', () => {
    expect(historyBudget(0, 2900, 1700)).toBe(HISTORY_NIGHT_MAX);
    expect(historyBudget(600, 2900, 1700)).toBe(400);
    expect(historyBudget(0, 2000, 1700)).toBe(300);
    expect(historyBudget(0, 1000, 1700)).toBe(0);
  });

  it('with the default cap, a normal night gets the whole thousand', () => {
    const left = 3000 - 6 * 37 - 60; // 02:30 UTC: live since 00:00 UTC plus the night archive
    expect(historyBudget(0, left, liveReserve(NOW, 30 * 60_000, 37, true))).toBe(HISTORY_NIGHT_MAX);
  });
});
