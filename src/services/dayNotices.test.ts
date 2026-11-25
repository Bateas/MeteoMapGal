import { describe, it, expect } from 'vitest';
import { dayNotices, officialNotices, stormNotice } from './dayNotices';
import { isStormRiskHour } from './stormRiskRule';
import type { MGWarning } from '../api/mgWarningsClient';
import type { IpmaWarning } from '../api/ipmaWarningsClient';
import type { HourlyForecast } from '../types/forecast';

const at = (d: number, h: number) => new Date(2026, 9, d, h);
const mg = (type: string, zones: [level: number, from: Date, to: Date][]): MGWarning => ({
  type, typeId: 1, maxLevel: Math.max(...zones.map((z) => z[0])), publishedAt: at(6, 8), link: '',
  zones: zones.map(([level, startTime, endTime], i) => ({ name: `z${i}`, id: 336 + i, level, startTime, endTime, comment: '' })),
});
const conv = (d: number, h: number, cape: number, li: number, cin = 0) =>
  ({ time: at(d, h), cape, liftedIndex: li, cin } as unknown as HourlyForecast);

describe('isStormRiskHour: the summary rule', () => {
  it('CAPE >= 300, LI <= -2 and CIN < 200', () => {
    expect(isStormRiskHour({ cape: 300, liftedIndex: -2, cin: 0 })).toBe(true);
    expect(isStormRiskHour({ cape: 299, liftedIndex: -4, cin: 0 })).toBe(false);
    expect(isStormRiskHour({ cape: 900, liftedIndex: -1, cin: 0 })).toBe(false);
    expect(isStormRiskHour({ cape: 900, liftedIndex: -4, cin: 250 })).toBe(false);
    expect(isStormRiskHour({ cape: null, liftedIndex: null, cin: null })).toBe(false);
  });
});

describe('officialNotices', () => {
  it('one line per source and type: the top level with its own window, the lower one when it covers more time', () => {
    const w = mg('Vento', [[1, at(7, 12), at(7, 20)], [2, at(7, 14), at(7, 18)]]);
    expect(officialNotices(at(7, 0), [w], [])).toEqual([{ level: 2, text: 'Aviso naranja por viento, de 14 a 18 h (amarillo de 12 a 20 h)' }]);
  });
  it('a warning crossing midnight reads «desde» on the first day and «hasta» on the next', () => {
    const w = mg('Ondas', [[1, at(7, 15), at(8, 9)]]);
    expect(officialNotices(at(7, 0), [w], [])[0].text).toBe('Aviso amarillo por oleaje, desde las 15 h');
    expect(officialNotices(at(8, 0), [w], [])[0].text).toBe('Aviso amarillo por oleaje, hasta las 9 h');
    expect(officialNotices(at(9, 0), [w], [])).toEqual([]);
  });
  it('IPMA warnings name their source, in Spanish', () => {
    const ipma: IpmaWarning = { id: 'x', districtCode: 'VCT', districtName: 'Viana', type: 'Agitação Marítima', level: 1, levelName: 'yellow', startTime: at(7, 0), endTime: at(8, 0), description: '' };
    expect(officialNotices(at(7, 0), [], [ipma])[0].text).toBe('Aviso amarillo por oleaje, todo el día (IPMA)');
  });
  it('yellow from 3 h and orange from 18 h is not «naranja desde las 3 h» (Castrelo, 16-nov)', () => {
    const base = { id: 'x', districtCode: 'VCT', districtName: 'Viana', type: 'Precipitação', description: '' };
    const y: IpmaWarning = { ...base, level: 1, levelName: 'yellow', startTime: at(7, 3), endTime: at(7, 18) };
    const o: IpmaWarning = { ...base, level: 2, levelName: 'orange', startTime: at(7, 18), endTime: at(8, 19) };
    expect(officialNotices(at(7, 0), [], [y, o])[0].text).toBe('Aviso naranja por lluvia, desde las 18 h (amarillo de 3 a 18 h) (IPMA)');
  });
  it('one line per phenomenon: IPMA only speaks of what MeteoGalicia does not (Cesantes, 18-nov)', () => {
    const base = { id: 'x', districtCode: 'VCT', districtName: 'Viana', description: '' };
    const sea: IpmaWarning = { ...base, type: 'Agitação Marítima', level: 2, levelName: 'orange', startTime: at(7, 18), endTime: at(8, 0) };
    const rain: IpmaWarning = { ...base, type: 'Precipitação', level: 1, levelName: 'yellow', startTime: at(7, 12), endTime: at(7, 18) };
    const w = mg('Ondas', [[2, at(7, 12), at(8, 0)]]);
    expect(officialNotices(at(7, 0), [w], [sea, rain]).map((n) => n.text)).toEqual([
      'Aviso naranja por oleaje, desde las 12 h',
      'Aviso amarillo por lluvia, de 12 a 18 h (IPMA)',
    ]);
  });
  it('a lower level inside the top window adds nothing', () => {
    const w = mg('Vento', [[2, at(7, 12), at(7, 20)], [1, at(7, 14), at(7, 18)]]);
    expect(officialNotices(at(7, 0), [w], [])[0].text).toBe('Aviso naranja por viento, de 12 a 20 h');
  });
});

describe('stormNotice and dayNotices', () => {
  it('first daytime hour with uncapped instability', () => {
    const c = [conv(7, 6, 900, -4), conv(7, 13, 200, -3), conv(7, 14, 450, -3), conv(7, 16, 800, -5)];
    expect(stormNotice(at(7, 0), c)).toEqual({ level: 0, text: 'Riesgo de tormenta desde las 14 h' });
  });
  it('today only from the current hour', () => {
    const c = [conv(6, 11, 500, -3), conv(6, 17, 500, -3)];
    expect(dayNotices(at(6, 0), at(6, 15), [], [], c)).toEqual([{ level: 0, text: 'Riesgo de tormenta desde las 17 h' }]);
  });
  it('an official storm warning replaces the model risk; nothing at all on a quiet day', () => {
    const c = [conv(7, 14, 600, -4)];
    const storm = mg('Tormenta', [[1, at(7, 13), at(7, 21)]]);
    expect(dayNotices(at(7, 0), at(6, 20), [storm], [], c).map((n) => n.text)).toEqual(['Aviso amarillo por tormenta, de 13 a 21 h']);
    expect(dayNotices(at(7, 0), at(6, 20), [], [], [conv(7, 14, 100, 1)])).toEqual([]);
  });
});
