import { describe, it, expect } from 'vitest';
import {
  summarizeDays, rainBands, rainLevel, windTone, describeBands, describeNextRain, warningsForZones, warningTypeEs,
} from './pointForecast';
import type { HourlyForecast } from '../types/forecast';
import type { MGWarning } from '../api/mgWarningsClient';

/** One forecast hour; `iso` carries its own offset (CET in November). */
function hour(iso: string, precipitation: number, ms = 5, dir = 180, temperature = 14): HourlyForecast {
  return {
    time: new Date(iso), temperature, humidity: 90, windSpeed: ms, windDirection: dir, windGusts: null,
    precipitation, precipProbability: null, cloudCover: 50, pressure: 1015, solarRadiation: null,
    cape: null, liftedIndex: null, cin: null, boundaryLayerHeight: null, visibility: null, snowLevel: null,
    skyState: null, isDay: true,
  } as HourlyForecast;
}

const day = (d: string, rain: Record<number, number> = {}) =>
  Array.from({ length: 24 }, (_, h) => hour(`2026-11-${d}T${String(h).padStart(2, '0')}:00:00+01:00`, rain[h] ?? 0));

describe('summarizeDays', () => {
  const hours = [...day('09', { 8: 4.9, 11: 0.2, 16: 3 }), ...day('10'), ...day('11'), ...day('12')];
  const sunday = new Date('2026-11-08T21:56:00+01:00');

  it('gives the next three days, each hour from 7 to 20 h', () => {
    const out = summarizeDays(hours, sunday);
    expect(out.map((d) => d.dayKey)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
    expect(out[0].hours).toHaveLength(14);
    expect(out[0].hours[1]).toMatchObject({ hour: 8, rainMm: 4.9, dir: 'S', temp: 14 });
    expect(out[0].bands.map((b) => b.fromH)).toEqual([8, 11, 16]);
    expect(out[0].label).toMatch(/lun.* 9/);
  });

  it('keeps today until its last hour has gone', () => {
    expect(summarizeDays(hours, new Date('2026-11-09T19:00:00+01:00'))[0].dayKey).toBe('2026-11-09');
    expect(summarizeDays(hours, new Date('2026-11-09T21:00:00+01:00'))[0].dayKey).toBe('2026-11-10');
  });

  it('gives wind in knots and no rainy stretch for a dry day', () => {
    const d = summarizeDays(hours, sunday)[1];
    expect(d.bands).toEqual([]);
    expect(Math.round(d.hours[0].kt!)).toBe(10);
  });

  it('leaves out a day the forecast does not reach, and marks the hours it lacks', () => {
    const shortRun = [hour('2026-11-09T09:00:00+01:00', 1), hour('2026-11-10T02:00:00+01:00', 0)];
    const out = summarizeDays(shortRun, sunday);
    expect(out.map((d) => d.dayKey)).toEqual(['2026-11-09']);
    expect(out[0].hours[0].rainMm).toBeNull();
  });
});

describe('describeNextRain', () => {
  const now = new Date('2026-11-09T10:10:00+01:00');
  const h = (hh: number, mm: number) => hour(`2026-11-09T${String(hh).padStart(2, '0')}:00:00+01:00`, mm);

  it('says roughly when and how much the next shower leaves', () => {
    expect(describeNextRain([h(11, 0), h(12, 0), h(13, 1.5), h(14, 0.5), h(15, 0)], now))
      .toBe('Lluvia en unas 3 h, hacia las 13 h: 2,0 mm en 2 h');
  });

  it('names the day when it is not today', () => {
    expect(describeNextRain([hour('2026-11-10T07:00:00+01:00', 1)], now)).toMatch(/hacia las 7 h del martes/);
  });

  it('says «la 1 h», not «las 1 h»', () => {
    expect(describeNextRain([hour('2026-11-10T01:00:00+01:00', 1)], now)).toMatch(/hacia la 1 h del martes/);
  });

  it('says one hour without the plural', () => {
    expect(describeNextRain([h(11, 1), h(12, 0)], now)).toBe('Lluvia en 1 h aprox., hacia las 11 h: 1,0 mm en 1 h');
  });

  it('when the model already has rain, says when it stops', () => {
    expect(describeNextRain([h(10, 2), h(11, 1), h(12, 0)], now)).toBe('Según el modelo llueve ahora. Para hacia las 12 h');
  });

  it('says so when the model sees none', () => {
    expect(describeNextRain([h(11, 0), h(16, 0)], now)).toBe('Sin lluvia en las próximas 6 h');
  });

  it('gives nothing without hours ahead', () => {
    expect(describeNextRain([h(5, 3)], now)).toBeNull();
  });
});

describe('rainBands', () => {
  it('joins consecutive rainy hours and adds their rain', () => {
    expect(rainBands([0, 0.6, 4.9, 0], 7)).toEqual([{ fromH: 8, toH: 9, mm: 5.5 }]);
  });

  it('one dry hour is enough to split a band', () => {
    expect(rainBands([1, 0, 1], 7).map((b) => [b.fromH, b.toH])).toEqual([[7, 7], [9, 9]]);
  });

  it('counts 0.1 mm as rain, less as dry, and a missing hour as no band', () => {
    expect(rainBands([0.1], 7)).toHaveLength(1);
    expect(rainBands([0.09], 7)).toHaveLength(0);
    expect(rainBands([1, null, 1], 7)).toHaveLength(2);
  });
});

describe('rainLevel', () => {
  it('steps at 0.1, 0.5 and 2 mm/h, and a missing hour is not rain', () => {
    expect([null, 0.09, 0.1, 0.49, 0.5, 1.99, 2, 7.1].map(rainLevel)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
});

describe('windTone', () => {
  it('uses the steps of the map, on the rounded knots', () => {
    expect([null, 5.4, 5.6, 7.9, 11, 12, 17.4, 18].map(windTone)).toEqual([0, 0, 1, 2, 2, 3, 3, 4]);
  });
});

describe('describeBands', () => {
  const b = (fromH: number, toH: number) => ({ fromH, toH, mm: 1 });

  it('reads as a sentence', () => {
    expect(describeBands([b(7, 8), b(11, 14), b(17, 17), b(19, 20)])).toBe('Llueve 7-8, 11-14, 17 y 19-20 h');
    expect(describeBands([b(12, 19)])).toBe('Llueve 12-19 h');
  });

  it('says so when it does not rain', () => {
    expect(describeBands([])).toBe('Sin lluvia de 7 a 20 h');
  });
});

describe('warningsForZones', () => {
  const zone = (name: string, id: number, start: string, end: string, comment = '') =>
    ({ name, id, level: 1, startTime: new Date(start), endTime: new Date(end), comment });
  const gusts: MGWarning = {
    type: 'Refacho máximo de vento', typeId: 7, maxLevel: 1, publishedAt: new Date(), link: '',
    zones: [
      zone('Zona Norte', 1, '2026-11-10T09:00:00+01:00', '2026-11-10T18:00:00+01:00', 'tarde'),
      zone('Zona Norte', 1, '2026-11-09T00:00:00+01:00', '2026-11-10T00:00:00+01:00', ' Refachos de máis de 70 km/h. '),
      zone('Zona Vecina', 2, '2026-11-09T00:00:00+01:00', '2026-11-09T21:00:00+01:00'),
      zone('Zona Pasada', 3, '2026-11-08T00:00:00+01:00', '2026-11-08T12:00:00+01:00'),
    ],
  };
  const now = new Date('2026-11-09T07:00:00+01:00');

  it('keeps only the zones asked for, whatever their neighbours have', () => {
    expect(warningsForZones([gusts], ['Zona Norte'], now).map((w) => w.zone)).toEqual(['Zona Norte']);
    expect(warningsForZones([gusts], ['Otra'], now)).toEqual([]);
  });

  it('drops what is over', () => {
    expect(warningsForZones([gusts], ['Zona Pasada'], now)).toEqual([]);
  });

  it('one line per kind and zone: the soonest stretch, already marked active', () => {
    const [w] = warningsForZones([gusts], ['zona norte'], now);
    expect(w.active).toBe(true);
    expect(w.comment).toBe('Refachos de máis de 70 km/h.');
    expect(w.type).toBe('Rachas de viento');
  });

  it('says it has not started yet', () => {
    const [w] = warningsForZones([gusts], ['Zona Norte'], new Date('2026-11-08T22:00:00+01:00'));
    expect(w.active).toBe(false);
  });

  it('translates what it knows and keeps the feed name otherwise', () => {
    expect(warningTypeEs('Precipitación 12 horas')).toBe('Lluvia en 12 horas');
    expect(warningTypeEs('Precipitación 1 hora')).toBe('Lluvia en 1 hora');
    expect(warningTypeEs('Algo novo')).toBe('Algo novo');
  });
});
