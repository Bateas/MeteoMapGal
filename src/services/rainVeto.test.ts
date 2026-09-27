import { describe, it, expect } from 'vitest';
import { assessRainVeto, RAIN_VETO_MM, RAIN_VETO_MIN_WET_STATIONS, RAIN_VETO_WINDOW_MIN } from './rainVeto';
import type { PrecipSample } from './precipSemantics';

const MIN = 60_000;
const NOW = Date.parse('2026-08-26T15:20:53Z');
// 0.3 mm in the window for an interval station, 0.51 of growth for a day counter.
const wetMg: PrecipSample[] = [{ t: NOW - 110 * MIN, mm: 0.1 }, { t: NOW - 20 * MIN, mm: 0.2 }];
const wetWu: PrecipSample[] = [{ t: NOW - 121 * MIN, mm: 4.32 }, { t: NOW - 26 * MIN, mm: 4.57 }, { t: NOW - 22 * MIN, mm: 4.83 }];
const dryMg: PrecipSample[] = [{ t: NOW - 60 * MIN, mm: 0 }, { t: NOW - 10 * MIN, mm: 0.1 }];
const dryWu: PrecipSample[] = [{ t: NOW - 100 * MIN, mm: 4.83 }, { t: NOW - 5 * MIN, mm: 4.83 }];

describe('assessRainVeto', () => {
  it('uses the approved thresholds: 2 stations, 0.2 mm, 120 min', () => {
    expect([RAIN_VETO_MIN_WET_STATIONS, RAIN_VETO_MM, RAIN_VETO_WINDOW_MIN]).toEqual([2, 0.2, 120]);
  });

  it('one wet station does not veto: it can be a single gauge misbehaving', () => {
    const v = assessRainVeto({
      stationIds: ['mg_10154', 'wu_IREDON36'],
      precip: new Map([['mg_10154', wetMg], ['wu_IREDON36', dryWu]]),
      nowMs: NOW,
    });
    expect(v.vetoed).toBe(false);
    expect(v.reason).toBeNull();
    expect(v.wetStations).toEqual([{ id: 'mg_10154', mm: 0.3 }]);
  });

  it('two wet stations veto, with the reason and the stations, wettest first (26-ago 17:20)', () => {
    const v = assessRainVeto({
      stationIds: ['mg_10154', 'wu_IREDON36', 'mg_other'],
      precip: new Map([['mg_10154', wetMg], ['wu_IREDON36', wetWu], ['mg_other', dryMg]]),
      nowMs: NOW,
    });
    expect(v.vetoed).toBe(true);
    expect(v.reason).toBe('Lluvia en 2 estaciones cercanas en las 2 últimas horas: sin brisa canalizada');
    expect(v.wetStations.map((w) => w.id)).toEqual(['wu_IREDON36', 'mg_10154']);
    expect(v.wetStations[0].mm).toBeCloseTo(0.51, 5);
  });

  it('no data does not veto', () => {
    expect(assessRainVeto({ stationIds: ['mg_10154', 'wu_IREDON36'], precip: new Map(), nowMs: NOW }).vetoed).toBe(false);
    expect(assessRainVeto({ stationIds: [], precip: new Map([['mg_10154', wetMg]]), nowMs: NOW }).vetoed).toBe(false);
  });

  it('only asks the stations it is given, and counts each once', () => {
    const v = assessRainVeto({
      stationIds: ['mg_10154', 'mg_10154'],
      precip: new Map([['mg_10154', wetMg], ['wu_IREDON36', wetWu]]),
      nowMs: NOW,
    });
    expect(v.vetoed).toBe(false);
    expect(v.wetStations).toHaveLength(1);
  });

  it('a network whose rain meaning is unknown never counts as wet', () => {
    const v = assessRainVeto({
      stationIds: ['skyx_A', 'skyx_B'],
      precip: new Map([['skyx_A', wetMg], ['skyx_B', wetMg]]),
      nowMs: NOW,
    });
    expect(v.vetoed).toBe(false);
  });
});
