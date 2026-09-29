import { describe, it, expect } from 'vitest';
import {
  judgeHealth, outKeys, withoutOutVariables, healthKey,
  HEALTH_OUT_MIN_DAYS, HEALTH_CLEAN_DAYS, HEALTH_WINDOW_DAYS, type HealthStrike,
} from './stationHealth';
import type { NormalizedReading } from '../types/station';

const strike = (day: string, stationId = 'mg_10087', variable: HealthStrike['variable'] = 'temperature', rule = 'spike'): HealthStrike =>
  ({ day, stationId, variable, rule });

describe('judgeHealth — out only when the failure repeats on distinct days', () => {
  it('a one-off failure (a leaf, a spider) does not take anything out', () => {
    const [v] = judgeHealth([strike('2026-09-29'), strike('2026-09-29', 'mg_10087', 'temperature', 'range')], '2026-09-30');
    expect(v.strikeDays).toBe(1);
    expect(v.out).toBe(false);
  });

  it(`${HEALTH_OUT_MIN_DAYS} distinct days in the window: out`, () => {
    const [v] = judgeHealth([strike('2026-09-10'), strike('2026-09-20'), strike('2026-09-29')], '2026-09-30');
    expect(v).toMatchObject({ strikeDays: 3, firstDay: '2026-09-10', lastDay: '2026-09-29', out: true });
  });

  it(`back in after ${HEALTH_CLEAN_DAYS} clean days`, () => {
    const strikes = [strike('2026-09-01'), strike('2026-09-02'), strike('2026-09-03')];
    expect(judgeHealth(strikes, '2026-09-16')[0].out).toBe(true);
    expect(judgeHealth(strikes, '2026-09-17')[0].out).toBe(false);
  });

  it(`only the last ${HEALTH_WINDOW_DAYS} days count`, () => {
    const [v] = judgeHealth([strike('2026-08-20'), strike('2026-09-25'), strike('2026-09-29')], '2026-09-30');
    expect(v.strikeDays).toBe(2);
    expect(v.out).toBe(false);
  });

  it('per variable: a broken thermometer does not take the anemometer out', () => {
    const verdicts = judgeHealth([strike('2026-09-10'), strike('2026-09-20'), strike('2026-09-29')], '2026-09-30');
    const out = outKeys(verdicts);
    expect(out.has(healthKey('mg_10087', 'temperature'))).toBe(true);
    expect(out.has(healthKey('mg_10087', 'wind'))).toBe(false);
  });
});

describe('withoutOutVariables — who uses the data, not what is kept', () => {
  const reading: NormalizedReading = {
    stationId: 'mg_10087', timestamp: new Date('2026-09-29T16:30:00Z'), windSpeed: 12, windGust: 20, windDirection: 200,
    temperature: -13.2, humidity: 97, precipitation: 1.2, solarRadiation: 40, pressure: 1006, dewPoint: -13.6,
  };

  it('nulls the variables that are out and the dew point that depends on them', () => {
    const r = withoutOutVariables(reading, new Set([healthKey('mg_10087', 'temperature')]));
    expect(r.temperature).toBeNull();
    expect(r.dewPoint).toBeNull();
    expect(r.windSpeed).toBe(12);
    expect(r.humidity).toBe(97);
    expect(reading.temperature).toBe(-13.2); // the original is untouched
  });

  it('another station, or nothing out: the same object', () => {
    expect(withoutOutVariables(reading, new Set([healthKey('mg_14001', 'temperature')]))).toBe(reading);
    expect(withoutOutVariables(reading, new Set())).toBe(reading);
  });
});
