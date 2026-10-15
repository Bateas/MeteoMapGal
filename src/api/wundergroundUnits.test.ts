import { describe, it, expect } from 'vitest';
import { wuKmhToMs, wuMetricFields, WU_UNITS } from './wundergroundUnits';

describe('Wunderground metric units', () => {
  it('asks in km/h, not in whole m/s', () => {
    expect(WU_UNITS).toBe('m');
  });

  it('converts km/h to m/s keeping the 0,28 m/s step (15-oct: 1 km/h, which units=s gave as 0)', () => {
    expect(wuKmhToMs(1)).toBeCloseTo(0.28, 2);
    expect(wuKmhToMs(14)).toBeCloseTo(3.89, 2);
    expect(wuKmhToMs(0)).toBe(0);
    expect(wuKmhToMs(null)).toBeNull();
    expect(wuKmhToMs(-3)).toBeNull();
    expect(wuKmhToMs(Number.NaN)).toBeNull();
  });

  it('reads the metric block of a real reply (IRIANX1, 15-oct 20:03 UTC)', () => {
    const f = wuMetricFields({ temp: 16, windSpeed: 1, windGust: 1, pressure: 1016.93, precipRate: 0, precipTotal: 0, elev: 1, dewpt: 15 });
    expect(f.windSpeed).toBeCloseTo(0.28, 2);
    expect(f.windGust).toBeCloseTo(0.28, 2);
    expect(f).toMatchObject({ temperature: 16, pressure: 1016.93, precipitation: 0, dewPoint: 15 });
    expect(wuMetricFields(undefined).windSpeed).toBeNull();
  });
});
