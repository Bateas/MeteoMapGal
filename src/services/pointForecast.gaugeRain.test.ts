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
    const week = describeGaugeRain(full({ n7d: 900, mm7d: 30 }), NOW)!;
    expect(week.note).toBe('Faltan lecturas: lo caído es como mínimo esto.');
    expect(week.cells[2].floor).toBe(true);
    expect(week.cells[0].floor).toBeUndefined();
    expect(describeGaugeRain(full({ n24h: 120 }), NOW)!.note).toContain('Faltan lecturas');
    expect(describeGaugeRain(full({ n7d: 910 }), NOW)!.note).toBeNull();
  });

  it('a gauge that barely reported says how many readings came and gives a floor', () => {
    const v = describeGaugeRain(full({ gauge: 'Amiudal', n24h: 44, mm24h: 1.1 }), NOW)!;
    expect(v.cells[0]).toEqual({ label: '24 h', mm: '1,1', floor: true });
    expect(v.note).toContain('Amiudal solo ha enviado 44 de sus 144 lecturas');
    expect(v.note).toContain('mínimo');
  });

  it('a nearby station gives the size of the rain only while the gauge barely reports, and with a full day behind it', () => {
    const witness = { gauge: 'Surribas', mm24h: 11.3, coveredMin: 1410, lastAt: new Date(NOW.getTime() - 20 * 60_000).toISOString() };
    const sparse = describeGaugeRain(full({ n24h: 44, mm24h: 1.1, witness }), NOW)!;
    // 12-nov: the barely reporting gauge no longer leads; the complete station gives the day
    expect(sparse.gauge).toBe('Surribas, estación particular cercana');
    expect(sparse.cells).toEqual([{ label: '24 h', mm: '11' }]);
    expect(sparse.note).toBe('Amiudal, la estación oficial, solo ha enviado 44 de sus 144 lecturas de las últimas 24 h: no sirve para el total.');
    const halfWitness = describeGaugeRain(full({ n24h: 44, mm24h: 1.1, witness: { ...witness, coveredMin: 600 } }), NOW)!;
    expect(halfWitness.gauge).toBe('Amiudal');
    expect(halfWitness.note).not.toContain('Surribas');
    expect(describeGaugeRain(full({ n24h: 44, mm24h: 1.1, witness: { ...witness, lastAt: new Date(NOW.getTime() - 3 * 3_600_000).toISOString() } }), NOW)!.note).not.toContain('Surribas');
    expect(describeGaugeRain(full({ n24h: 44, mm24h: 20, witness }), NOW)!.note).not.toContain('Surribas');
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
