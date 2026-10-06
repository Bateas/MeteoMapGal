import { describe, it, expect } from 'vitest';
import { buildDayParts, buildHourCols, daySentence, windTone, cardinalEs, type PartHour } from './forecastParte';
import type { HourlyForecast } from '../types/forecast';

const KT = 1 / 1.944;
function hour(day: number, h: number, kt: number, extra: Partial<HourlyForecast> = {}): HourlyForecast {
  return {
    time: new Date(2026, 9, day, h), temperature: 18, humidity: 70, windSpeed: kt * KT, windDirection: 225,
    windGusts: kt * 1.3 * KT, precipitation: 0, precipProbability: 0, cloudCover: 30, pressure: 1018,
    solarRadiation: 400, cape: null, boundaryLayerHeight: null, visibility: null, liftedIndex: null, cin: null,
    snowLevel: null, skyState: null, isDay: h >= 8 && h <= 20, ...extra,
  };
}
const ph = (h: number, kt: number, extra: Partial<PartHour> = {}): PartHour => ({
  time: new Date(2026, 9, 8, h), kt, gustKt: kt * 1.3, dirDeg: 225, tone: windTone(kt), rainMm: 0, rainProb: 0, temp: 18, ...extra,
});

describe('windTone: the words of the map', () => {
  it('calma < 6, flojo 6-8, navegable 8-12, bueno 12-18, fuerte 18+', () => {
    expect([5.4, 6, 7.4, 8, 11.4, 12, 17.4, 18].map(windTone))
      .toEqual(['calma', 'flojo', 'flojo', 'navegable', 'navegable', 'bueno', 'bueno', 'fuerte']);
  });
});

describe('cardinalEs', () => {
  it('Spanish 16 points', () => {
    expect([0, 225, 247, 270, 337.5, 359].map(cardinalEs)).toEqual(['N', 'SO', 'OSO', 'O', 'NNO', 'N']);
  });
});

describe('daySentence', () => {
  it('names the sailing window, its best part and the rest', () => {
    const s = daySentence([ph(10, 4), ph(11, 7), ph(12, 9), ph(13, 13), ph(14, 14), ph(15, 10), ph(16, 5)]);
    expect(s).toBe('Navegable de 12 a 16 h, bueno de 13 a 15 h (hasta 14 kt del SO); el resto, flojo o en calma.');
  });
  it('a window that is all «bueno» says so once', () => {
    expect(daySentence([ph(13, 13), ph(14, 15)])).toBe('Bueno de 13 a 15 h (hasta 15 kt del SO).');
  });
  it('no wind: the best it gets and when', () => {
    expect(daySentence([ph(10, 2), ph(15, 5), ph(18, 3)])).toBe('Sin viento para navegar: como mucho 5 kt hacia las 15 h.');
  });
  it('strong wind goes first, with its gusts', () => {
    const s = daySentence([ph(12, 14), ph(13, 20, { gustKt: 31 }), ph(14, 19, { gustKt: 28 }), ph(15, 10)]);
    expect(s.startsWith('Fuerte de 13 a 15 h (rachas de 31 kt); ')).toBe(true);
  });
  it('rain only when the model gives it even odds', () => {
    expect(daySentence([ph(13, 9, { rainMm: 1.2, rainProb: 70 }), ph(14, 9), ph(15, 9), ph(16, 9)])).toMatch(/Lluvia hacia las 13 h\.$/);
    expect(daySentence([ph(13, 9, { rainMm: 1.2, rainProb: 20 }), ph(14, 9)])).not.toMatch(/Lluvia/);
  });
});

describe('buildDayParts', () => {
  it('night hours are left out by the daylight test, not by the model flag', () => {
    const now = new Date(2026, 9, 6, 6, 0);
    const hourly = Array.from({ length: 24 }, (_, h) => hour(6, h, 9, { isDay: true }));
    const parts = buildDayParts(hourly, now, 1, (t) => t.getHours() >= 9 && t.getHours() <= 19);
    expect(parts[0].hours.map((h) => h.time.getHours())).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it('daylight hours from the current hour, one entry per day, today first', () => {
    const now = new Date(2026, 9, 6, 15, 20);
    const hourly = [6, 7].flatMap((d) => Array.from({ length: 24 }, (_, h) => hour(d, h, h >= 12 && h <= 15 ? 10 : 4)));
    const parts = buildDayParts(hourly, now, 3, (t) => t.getHours() >= 8 && t.getHours() <= 20);
    expect(parts.map((p) => p.label)).toEqual(['Hoy', 'Mañana']);
    expect(parts[0].hours.map((h) => h.time.getHours())).toEqual([15, 16, 17, 18, 19, 20]);
    expect(parts[1].hours[0].time.getHours()).toBe(8);
    expect(parts[1].sentence).toBe('Navegable de 12 a 16 h (hasta 10 kt del SO); el resto, en calma.');
  });
});

describe('buildHourCols', () => {
  it('every hour from now for the window, night flagged, days labelled', () => {
    const now = new Date(2026, 9, 6, 22, 40);
    const hourly = [6, 7].flatMap((d) => Array.from({ length: 24 }, (_, h) => hour(d, h, 9, { humidity: 80, pressure: 1016 })));
    const cols = buildHourCols(hourly, now, 6, (t) => t.getHours() >= 8 && t.getHours() <= 20);
    expect(cols.map((c) => c.time.getHours())).toEqual([22, 23, 0, 1, 2, 3]);
    expect(cols.every((c) => !c.light)).toBe(true);
    expect(cols.map((c) => c.dayLabel)).toEqual(['Hoy', 'Hoy', 'Mañana', 'Mañana', 'Mañana', 'Mañana']);
    expect(cols[0]).toMatchObject({ tone: 'navegable', humidity: 80, pressure: 1016 });
  });
  it('skips hours without wind instead of inventing a calm', () => {
    const now = new Date(2026, 9, 6, 10, 0);
    const hourly = [hour(6, 10, 9), hour(6, 11, 9, { windSpeed: null }), hour(6, 12, 9)];
    expect(buildHourCols(hourly, now, 4, () => true).map((c) => c.time.getHours())).toEqual([10, 12]);
  });
});
