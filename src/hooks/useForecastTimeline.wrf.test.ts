import { describe, it, expect } from 'vitest';
import { isWrfAnswer } from './useForecastTimeline';
import type { HourlyForecast } from '../types/forecast';

const hour = (skyState: string | null) => ({ time: new Date(), skyState } as unknown as HourlyForecast);

describe('isWrfAnswer', () => {
  it('our forecast with the sky state is the WRF: no need to ask MeteoSIX again', () => {
    expect(isWrfAnswer([hour('SUNNY'), hour('CLOUDY'), hour(null)])).toBe(true);
  });
  it('without it the server fell back to Open-Meteo, or gave nothing', () => {
    expect(isWrfAnswer([hour(null), hour(null), hour('SUNNY')])).toBe(false);
    expect(isWrfAnswer([])).toBe(false);
    expect(isWrfAnswer(null)).toBe(false);
  });
});
