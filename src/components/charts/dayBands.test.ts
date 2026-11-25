import { describe, expect, it } from 'vitest';
import { bandLabel, bandRain, bandSky, bandTemp, buildDayBands } from './dayBands';
import { buildHourCols } from '../../services/forecastParte';
import type { HourlyForecast } from '../../types/forecast';

const NOW = new Date(2026, 10, 11, 9, 20);

/** One forecast hour, `h` hours from 00:00 of 11-nov. Wind in m/s, as the forecast carries it. */
function hour(h: number, over: Partial<HourlyForecast> = {}): HourlyForecast {
  return {
    time: new Date(2026, 10, 11, h), temperature: 12, humidity: 80, windSpeed: 2, windDirection: 200, windGusts: null,
    precipitation: 0, precipProbability: null, cloudCover: 50, pressure: null, skyState: null,
    ...over,
  } as HourlyForecast;
}

const bandsOf = (hours: HourlyForecast[]) => buildDayBands(buildHourCols(hours, NOW, 48, () => true));

describe('buildDayBands: today and tomorrow in stretches', () => {
  it('sums the rain, takes the strongest wind and the range of the temperature of each stretch', () => {
    const hours = Array.from({ length: 48 }, (_, h) => hour(h, {
      temperature: h === 15 ? 17 : h === 19 ? 11 : 13,
      precipitation: h === 16 ? 1.5 : h === 17 ? 0.9 : 0,
      windSpeed: h === 18 ? 6 : 2,
    }));
    const [today, tomorrow] = bandsOf(hours);
    expect(today.label).toBe('Hoy');
    expect(today.bands.map((b) => b.id)).toEqual(['manana', 'tarde', 'noche']);
    const tarde = today.bands[1];
    expect(tarde.rainMm).toBeCloseTo(2.4, 5);
    expect(bandRain(tarde)).toBe('2,4 mm');
    expect([tarde.tMin, tarde.tMax]).toEqual([11, 17]);
    expect(bandTemp(tarde)).toBe('11-17°');
    expect(tarde.windKt).toBe(12); // 6 m/s
    expect(tarde.tone).toBe('bueno');
    expect(bandSky(tarde)).toBe('cloud-rain');
    expect(tomorrow.label).toBe('Mañana');
    expect(tomorrow.bands).toHaveLength(3);
  });

  it('the morning starts at the hour it is, and says so', () => {
    const [today] = bandsOf(Array.from({ length: 48 }, (_, h) => hour(h)));
    expect(today.bands[0].span).toBe('9-14 h');
  });

  it('a stretch with one hour left is not summed up, and never more than two days', () => {
    const late = new Date(2026, 10, 11, 20, 10);
    const days = buildDayBands(buildHourCols(Array.from({ length: 72 }, (_, h) => hour(h)), late, 48, () => true));
    expect(days[0].bands.map((b) => b.id)).toEqual(['noche']);
    const night = new Date(2026, 10, 11, 23, 50);
    const after = buildDayBands(buildHourCols(Array.from({ length: 72 }, (_, h) => hour(h)), night, 48, () => true));
    expect(after.map((d) => d.bands.map((b) => b.id))).toEqual([['noche'], ['manana', 'tarde', 'noche']]);
  });

  it('drizzle noise is not rain, a storm shows as one, and the night takes the moon', () => {
    const hours = Array.from({ length: 48 }, (_, h) => hour(h, {
      precipitation: h === 10 ? 0.1 : 0,
      cloudCover: h >= 21 ? 5 : 50,
      skyState: h === 15 ? 'STORMS' : null,
    }));
    const [today] = bandsOf(hours);
    expect(bandRain(today.bands[0])).toBe('Sin lluvia');
    expect(bandSky(today.bands[0])).toBe('cloud-sun');
    expect(bandSky(today.bands[1])).toBe('zap');
    expect(bandSky(today.bands[2])).toBe('moon');
  });

  it('ten millimetres or more go without decimals, and a flat temperature is one figure', () => {
    const hours = Array.from({ length: 48 }, (_, h) => hour(h, { precipitation: h >= 14 && h <= 20 ? 2 : 0, temperature: 14 }));
    const tarde = bandsOf(hours)[0].bands[1];
    expect(bandRain(tarde)).toBe('14 mm');
    expect(bandTemp(tarde)).toBe('14°');
    expect(bandLabel('Hoy', tarde)).toBe('Hoy, de tarde (14-21 h): lluvia, 14 mm, 14°, viento hasta 4 nudos');
  });
});

describe('sunLine: daylight beside the name of the day', () => {
  const VIGO: [number, number] = [-8.72, 42.24];
  it('gives sunrise and sunset in plain hours, no leading zero', async () => {
    const { sunLine } = await import('./dayBands');
    const line = sunLine(new Date(2026, 10, 12, 0), new Date(2026, 10, 11, 9, 20), VIGO)!;
    expect(line).toMatch(/^sol de 8:\d\d a 18:\d\d$/);
  });
  it('today says it until the sun is down, then leaves it to tomorrow', async () => {
    const { sunLine } = await import('./dayBands');
    expect(sunLine(new Date(2026, 10, 11, 9), new Date(2026, 10, 11, 9, 20), VIGO)).toMatch(/^sol de 8:/);
    expect(sunLine(new Date(2026, 10, 11, 21), new Date(2026, 10, 11, 21, 0), VIGO)).toBeNull();
  });
});
