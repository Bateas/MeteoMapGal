import { describe, it, expect } from 'vitest';
import { describeGaugeRain } from './pointForecast';
import { METEO_POINTS, pointRainGauge } from '../config/userSpots';
import type { GaugeRain } from '../api/meteoPointStatusClient';

const NOW = new Date('2026-11-09T22:00:00Z');
const full = (extra: Partial<GaugeRain> = {}): GaugeRain => ({
  gauge: 'Amiudal', mm24h: 36.1, mm3d: 46.1, mm7d: 48.1, n24h: 144, n3d: 432, n7d: 1008,
  lastAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(), ...extra,
});

describe('describeGaugeRain', () => {
  it('gives the three totals, with the comma and no decimals from 10 mm', () => {
    const v = describeGaugeRain(full({ mm24h: 4.6 }), NOW)!;
    expect(v.gauge).toBe('Amiudal');
    expect(v.cells).toEqual([{ label: '24 h', mm: '4,6' }, { label: '3 días', mm: '46' }, { label: '7 días', mm: '48' }]);
    expect(v.note).toBeNull();
  });

  it('a dry gauge says 0, not 0,0', () => {
    expect(describeGaugeRain(full({ mm24h: 0 }), NOW)!.cells[0].mm).toBe('0');
  });

  it('with readings missing the totals are a floor, and it says so', () => {
    expect(describeGaugeRain(full({ n7d: 900 }), NOW)!.note).toBe('Faltan lecturas: puede haber caído algo más.');
    expect(describeGaugeRain(full({ n24h: 120 }), NOW)!.note).toContain('Faltan lecturas');
    expect(describeGaugeRain(full({ n7d: 910 }), NOW)!.note).toBeNull();
  });

  it('a reading of more than 40 minutes ago gives its hour', () => {
    const late = full({ lastAt: new Date(NOW.getTime() - 60 * 60_000).toISOString() });
    expect(describeGaugeRain(late, NOW)!.note).toBe('Última lectura a las 22:00.');
  });

  it('a silent gauge gives no figure rather than an old one', () => {
    expect(describeGaugeRain(full({ lastAt: new Date(NOW.getTime() - 181 * 60_000).toISOString() }), NOW)).toBeNull();
    expect(describeGaugeRain(full({ lastAt: null }), NOW)).toBeNull();
    expect(describeGaugeRain(null, NOW)).toBeNull();
  });
});

describe('pointRainGauge', () => {
  it('takes the nearest MeteoGalicia gauge of the point', () => {
    expect(pointRainGauge(METEO_POINTS[0])?.id).toBe('mg_10109');
  });

  it('a point without one has none', () => {
    expect(pointRainGauge({ ...METEO_POINTS[0], gauges: [{ id: 'nt_1', name: 'x' }] })).toBeNull();
    expect(pointRainGauge({ ...METEO_POINTS[0], gauges: undefined })).toBeNull();
  });
});
