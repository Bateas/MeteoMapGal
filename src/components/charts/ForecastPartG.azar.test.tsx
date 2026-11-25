/**
 * Random break of 12-nov night that went through with the whole suite green: clear hours of daylight drew the moon.
 * Checked to fail with that break. The clock is fixed: what is day comes from the hour, not from the data.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ForecastHoursG } from './ForecastPartG';
import type { HourlyForecast } from '../../types/forecast';

function hours(start: Date): HourlyForecast[] {
  return Array.from({ length: 3 }, (_, i) => ({
    time: new Date(start.getTime() + i * 3_600_000), temperature: 18, humidity: 70, windSpeed: 5, windDirection: 225,
    windGusts: null, precipitation: 0, precipProbability: 0, cloudCover: 5, pressure: 1018, solarRadiation: 0,
    cape: null, boundaryLayerHeight: null, visibility: null, liftedIndex: null, cin: null, snowLevel: null, skyState: null,
    isDay: true,
  })) as HourlyForecast[];
}

afterEach(() => vi.useRealTimers());

describe('the sky of a clear hour', () => {
  it('at midday it is the sun, never the moon', () => {
    const noon = new Date('2026-07-15T10:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(noon);
    const { container } = render(<ForecastHoursG hourly={hours(noon)} />);
    expect(container.querySelector('.lucide-sun')).not.toBeNull();
    expect(container.querySelector('.lucide-moon')).toBeNull();
  });

  it('after midnight it is the moon', () => {
    const night = new Date('2026-07-15T23:00:00Z');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(night);
    const { container } = render(<ForecastHoursG hourly={hours(night)} />);
    expect(container.querySelector('.lucide-moon')).not.toBeNull();
    expect(container.querySelector('.lucide-sun')).toBeNull();
  });
});
