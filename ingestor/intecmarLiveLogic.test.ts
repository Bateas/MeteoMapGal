import { afterEach, describe, expect, it, vi } from 'vitest';
import { platformRows } from './intecmarLogic';
import {
  addRequest, dailyCap, describeDay, describePlatform, emptyLedger, INTECMAR_PLATFORMS, liveBuoyRow, liveEnabled,
  liveIntervalMs, livePlan, liveReading, liveWindow, requestsLeft, rollLedger,
} from './intecmarLiveLogic';
import { OBS_STATIONS, parseObsResponse } from './buoyFetcher';
import fixture from '../src/api/observatorioCosteiro.fixture.json';

// Shapes copied from real answers of /moorings/data/{station}/{parameter}/10minute (19-oct-2026),
// trimmed: one object per depth, samples newest first, Date in UTC with Z.
type S = [string, number, number];
const series = (station: number, parameterId: number, code: string, func: string, depth: number, samples: S[]) => ({
  StationCode: station, ParameterId: parameterId, ParameterCode: code, Function: func, Depth: depth, UnitDepth: 'm',
  Frequency: '10minute', Samples: samples.map(([Date, Value, QualityCode]) => ({ Date, Value, QualityCode })),
});
const T = (hhmm: string) => `2026-10-19T${hhmm}:00Z`;
const NOW = Date.parse('2026-10-19T16:20:00Z');
const SIX_H = 6 * 3_600_000;

/** Cortegada at 16:10 UTC on 19-oct: wind values as INTECMAR published them (VV AVG 6.29, 16:00 6.05). */
function cortegada(over: { gust1610?: S; water1m?: S } = {}) {
  return platformRows([
    series(15001, 81, 'VV', 'AVG', -5, [[T('16:10'), 6.29, 1], [T('16:00'), 6.05, 1]]),
    series(15001, 81, 'VV', 'RACHA', -5, [over.gust1610 ?? [T('16:10'), 8.9, 1], [T('16:00'), 8.1, 1]]),
    series(15001, 82, 'DV', 'AVG', -5, [[T('16:10'), 64, 1], [T('16:00'), 60, 1]]),
    series(15001, 83, 'TA', 'AVG', -5, [[T('16:10'), 17.4, 1]]),
    series(15001, 86, 'HR', 'AVG', -5, [[T('16:10'), 44, 1]]),
    series(15001, 10018, 'TO', 'AVG', -5, [[T('16:10'), 5.15, 1]]),
    series(15001, 20003, 'TAU', 'AVG', 1, [over.water1m ?? [T('16:10'), 15.8, 1]]),
    series(15001, 20003, 'TAU', 'AVG', 3, [[T('16:10'), 15.6, 1]]),
    series(15001, 20005, 'SAL', 'AVG', 1, [[T('16:10'), 34.7, 1]]),
  ]);
}

describe('livePlan', () => {
  const plan = livePlan();

  it('asks the series the map reads: 8 per platform with an anemometer, 5 for Rande, 37 in all', () => {
    expect(plan).toHaveLength(37);
    expect(plan.filter((p) => p.station === 15001)).toHaveLength(8);
    expect(plan.filter((p) => p.station === 15100)).toHaveLength(5);
  });

  it('never asks Rande for wind, and nobody for the current (archived at night only)', () => {
    expect(plan.filter((p) => p.station === 15100).map((p) => p.parameterId)).not.toContain(81);
    expect(plan.map((p) => p.parameterId)).not.toContain(20000);
  });

  it('asks the gust and the dew point', () => {
    const c = plan.filter((p) => p.station === 15009);
    expect(c.some((p) => p.parameterId === 81 && p.func === 'RACHA')).toBe(true);
    expect(c.some((p) => p.parameterId === 10018)).toBe(true);
  });

  it('fits 24 hourly passes, and even 72 (20 min), under the default cap of 1500 and 3000', () => {
    expect(plan.length * 24).toBeLessThan(1500);
    expect(plan.length * 72).toBeLessThan(3000);
  });
});

describe('INTECMAR_PLATFORMS', () => {
  it('maps each INTECMAR code to the station_id buoyFetcher stores for the same buoy', () => {
    for (const p of INTECMAR_PLATFORMS) {
      const s = OBS_STATIONS.find((o) => o.obsId === p.code);
      expect(s, String(p.code)).toBeDefined();
      expect(s!.canonicalId).toBe(p.canonicalId);
      expect(s!.name).toBe(p.name);
      expect(s!.enabled).not.toBe(false);
    }
    expect(INTECMAR_PLATFORMS.map((p) => [p.code, p.canonicalId])).toEqual([[15001, 1250], [15004, 1253], [15005, 1255], [15100, 1251], [15009, 15009]]);
  });

  it('covers every enabled platform of the MeteoGalicia path, and only those with a plan', () => {
    const enabled = OBS_STATIONS.filter((o) => o.enabled !== false).map((o) => o.obsId).sort();
    expect(INTECMAR_PLATFORMS.map((p) => p.code).sort()).toEqual(enabled);
    expect([...new Set(livePlan().map((p) => p.station))].sort()).toEqual(enabled);
  });
});

describe('liveWindow', () => {
  it('asks today, ending tomorrow (end_date stops at its 00:00)', () => {
    expect(liveWindow(Date.parse('2026-10-21T10:00:00Z'))).toEqual({ begin: '2026-10-21', end: '2026-10-22' });
  });

  it('before 01:00 UTC also asks yesterday, so its last samples are stored', () => {
    expect(liveWindow(Date.parse('2026-10-21T00:40:00Z'))).toEqual({ begin: '2026-10-20', end: '2026-10-22' });
    expect(liveWindow(Date.parse('2026-10-21T01:00:00Z'))).toEqual({ begin: '2026-10-21', end: '2026-10-22' });
  });

  it('crosses a month end', () => {
    expect(liveWindow(Date.parse('2026-10-31T23:50:00Z'))).toEqual({ begin: '2026-10-31', end: '2026-11-01' });
    expect(liveWindow(Date.parse('2026-11-01T00:10:00Z'))).toEqual({ begin: '2026-10-31', end: '2026-11-02' });
  });
});

describe('environment', () => {
  it('INTECMAR_LIVE is on unless switched off', () => {
    expect(liveEnabled(undefined)).toBe(true);
    expect(liveEnabled('1')).toBe(true);
    for (const off of ['0', 'off', 'OFF', 'false', 'no', ' 0 ']) expect(liveEnabled(off)).toBe(false);
  });

  it('INTECMAR_LIVE_MS defaults to 60 min and never goes below 10', () => {
    expect(liveIntervalMs(undefined)).toBe(3_600_000);
    expect(liveIntervalMs('abc')).toBe(3_600_000);
    expect(liveIntervalMs('3600000')).toBe(3_600_000);
    expect(liveIntervalMs('60000')).toBe(600_000);
  });

  it('INTECMAR_MAX_REQUESTS_PER_DAY defaults to 1500', () => {
    expect(dailyCap(undefined)).toBe(1500);
    expect(dailyCap('-5')).toBe(1500);
    expect(dailyCap('5000')).toBe(5000);
  });
});

describe('request ledger', () => {
  const t0 = Date.parse('2026-10-20T23:59:00Z');

  it('counts per UTC day and per caller', () => {
    let l = emptyLedger(t0);
    l = addRequest(l, t0, 'vivo');
    l = addRequest(l, t0, 'vivo');
    l = addRequest(l, t0, 'noche');
    expect(l.current).toEqual({ day: '2026-10-20', total: 3, byTag: { vivo: 2, noche: 1 } });
    expect(describeDay(l.current)).toBe('2026-10-20: 3 (noche 1, vivo 2)');
  });

  it('a new UTC day starts at zero and keeps yesterday', () => {
    let l = addRequest(emptyLedger(t0), t0, 'vivo');
    l = addRequest(l, t0 + 120_000, 'noche');
    expect(l.current).toEqual({ day: '2026-10-21', total: 1, byTag: { noche: 1 } });
    expect(l.previous).toEqual({ day: '2026-10-20', total: 1, byTag: { vivo: 1 } });
    expect(rollLedger(l, t0 + 120_000)).toBe(l);
  });

  it('what is left of the cap resets with the day', () => {
    let l = emptyLedger(t0);
    for (let i = 0; i < 5; i++) l = addRequest(l, t0, 'vivo');
    expect(requestsLeft(l, t0, 5)).toBe(0);
    expect(requestsLeft(l, t0 + 120_000, 5)).toBe(5);
  });
});

describe('liveReading', () => {
  it('reads the 16:10 instant of every series, like the MeteoGalicia path would', () => {
    const r = liveReading(cortegada(), 15001, NOW, SIX_H)!;
    expect(r).toEqual({
      time: '2026-10-19T16:10:00Z', windSpeed: 6.29, windDir: 64, windGust: 8.9, waterTemp: 15.8,
      airTemp: 17.4, salinity: 34.7, humidity: 44, dewPoint: 5.15,
    });
  });

  it('a speed whose gust is missing or rejected takes the latest instant that has both, with that instant\'s direction', () => {
    const r = liveReading(cortegada({ gust1610: [T('16:10'), -9999, 9] }), 15001, NOW, SIX_H)!;
    expect(r.time).toBe('2026-10-19T16:10:00Z');
    expect([r.windSpeed, r.windGust, r.windDir]).toEqual([6.05, 8.1, 60]);
  });

  it('no gust within 20 minutes: no wind at all (Muros\'s broken records)', () => {
    const rows = platformRows([
      series(15009, 81, 'VV', 'AVG', -5, [[T('16:10'), 27.7, 1]]),
      series(15009, 81, 'VV', 'RACHA', -5, [[T('16:10'), -9999, 9], [T('15:30'), 9.1, 1]]),
      series(15009, 82, 'DV', 'AVG', -5, [[T('16:10'), 29, 1]]),
      series(15009, 83, 'TA', 'AVG', -5, [[T('16:10'), 16.1, 1]]),
    ]);
    const r = liveReading(rows, 15009, NOW, SIX_H)!;
    expect([r.windSpeed, r.windGust, r.windDir]).toEqual([null, null, null]);
    expect(r.airTemp).toBe(16.1);
  });

  it('only quality code 1: a code 4 wind (Muros 78 m/s) is not read', () => {
    const rows = platformRows([
      series(15009, 81, 'VV', 'AVG', -5, [[T('16:10'), 78.05, 4]]),
      series(15009, 81, 'VV', 'RACHA', -5, [[T('16:10'), 80, 4]]),
      series(15009, 83, 'TA', 'AVG', -5, [[T('16:10'), 16.1, 1]]),
    ]);
    expect(liveReading(rows, 15009, NOW, SIX_H)!.windSpeed).toBeNull();
  });

  it('water from the shallowest sensor down to 2 m; a rejected 1 m sensor is not replaced by the 3 m one', () => {
    expect(liveReading(cortegada(), 15001, NOW, SIX_H)!.waterTemp).toBe(15.8);
    expect(liveReading(cortegada({ water1m: [T('16:10'), 8.3, 4] }), 15001, NOW, SIX_H)!.waterTemp).toBeNull();
  });

  it('Rande: surface water at 1.5 m out of 1.5, 5.5 and 14 m, and no wind', () => {
    const rows = platformRows([
      series(15100, 20003, 'TAU', 'AVG', 1.5, [[T('15:50'), 15.194, 1]]),
      series(15100, 20003, 'TAU', 'AVG', 5.5, [[T('15:50'), 15.0, 1]]),
      series(15100, 20003, 'TAU', 'AVG', 14, [[T('15:50'), 14.6, 1]]),
      series(15100, 83, 'TA', 'AVG', -10, [[T('15:50'), 16.9, 1]]),
    ]);
    const r = liveReading(rows, 15100, NOW, SIX_H)!;
    expect(r).toMatchObject({ time: '2026-10-19T15:50:00Z', waterTemp: 15.194, airTemp: 16.9, windSpeed: null, windGust: null });
  });

  it('a field older than 20 minutes from the row time belongs to another moment', () => {
    const rows = platformRows([
      series(15004, 83, 'TA', 'AVG', -5, [[T('16:10'), 17.0, 1]]),
      series(15004, 86, 'HR', 'AVG', -5, [[T('15:40'), 60, 1]]),
      series(15004, 20003, 'TAU', 'AVG', 1.5, [[T('15:50'), 15.1, 1]]),
    ]);
    const r = liveReading(rows, 15004, NOW, SIX_H)!;
    expect(r.humidity).toBeNull();
    expect(r.waterTemp).toBe(15.1);
  });

  it('nothing valid, or older than the gate, gives no reading; other platforms\' rows are ignored', () => {
    expect(liveReading(platformRows([series(15005, 83, 'TA', 'AVG', -5, [[T('16:10'), -9999, 9]])]), 15005, NOW, SIX_H)).toBeNull();
    expect(liveReading(cortegada(), 15001, NOW + SIX_H, SIX_H)).toBeNull();
    expect(liveReading(cortegada(), 15004, NOW, SIX_H)).toBeNull();
  });
});

describe('liveBuoyRow', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('has exactly the fields of the MeteoGalicia path row, with its own source', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T23:00:00Z'));
    const fixtureRow = parseObsResponse(
      { obsId: 15001, canonicalId: 1250, name: 'Cortegada (Arousa)' },
      (fixture as Record<string, unknown>)['15001'] as Parameters<typeof parseObsResponse>[1],
    );
    expect(fixtureRow).not.toBeNull();
    const live = liveBuoyRow(INTECMAR_PLATFORMS[0], liveReading(cortegada(), 15001, NOW, SIX_H)!);
    expect(Object.keys(live).sort()).toEqual(Object.keys(fixtureRow!).sort());
    expect(live).toMatchObject({ stationId: 1250, stationName: 'Cortegada (Arousa)', source: 'intecmar', windSpeed: 6.29, waveHeight: null, seaLevel: null });
  });
});

describe('describePlatform', () => {
  it('says INTECMAR\'s instant, its delay and MeteoGalicia\'s instant, in Madrid time', () => {
    expect(describePlatform('Cortegada (Arousa)', Date.parse(T('16:10')), Date.parse(T('15:20')), NOW))
      .toBe('Cortegada 18:10 (+10 min; MG 17:20)');
    expect(describePlatform('Rande (Ría Vigo)', null, null, NOW)).toBe('Rande sin dato (MG sin dato)');
  });
});

describe('breaker and empty series (pure)', () => {
  it('opens on the 5th failure in a row for an hour; a success resets the count', async () => {
    const { breakerNote, breakerOpen, closedBreaker, BREAKER_FAILS, BREAKER_OPEN_MS } = await import('./intecmarLiveLogic');
    let s = closedBreaker();
    for (let i = 0; i < BREAKER_FAILS - 1; i++) s = breakerNote(s, false, NOW);
    expect(breakerOpen(s, NOW)).toBe(false);
    expect(breakerOpen(breakerNote(breakerNote(s, true, NOW), false, NOW), NOW)).toBe(false);
    s = breakerNote(s, false, NOW);
    expect(breakerOpen(s, NOW)).toBe(true);
    expect(breakerOpen(s, NOW + BREAKER_OPEN_MS)).toBe(false);
  });

  it('an empty answer rests the series; any sample brings it back', async () => {
    const { noteSeriesAnswer, seriesDue, seriesKey } = await import('./intecmarLiveLogic');
    const rest = new Map<string, number>();
    const k = seriesKey({ station: 15100, parameterId: 20003, func: 'AVG' });
    noteSeriesAnswer(rest, k, 0, NOW, 3_600_000);
    expect(seriesDue(rest, k, NOW + 1)).toBe(false);
    expect(seriesDue(rest, k, NOW + 3_600_000)).toBe(true);
    noteSeriesAnswer(rest, k, 12, NOW, 3_600_000);
    expect(seriesDue(rest, k, NOW + 1)).toBe(true);
  });
});
