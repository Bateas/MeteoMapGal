/**
 * The sky at night: only the two icons with a sun change (sun → moon, sun behind a cloud → cloud). The random breaks
 * of 11-nov turned that round, so every OTHER icon became a plain cloud at night (rain, storm, fog), and no test saw it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('../icons/WeatherIcons', async (orig) => ({
  ...(await orig<typeof import('../icons/WeatherIcons')>()),
  WeatherIcon: ({ id }: { id: string }) => <i data-icon={id} />,
}));

import { ForecastHoursG } from './ForecastPartG';
import type { HourlyForecast } from '../../types/forecast';

/** Three hours in the small hours of tomorrow: night whatever the season. */
function nightHours(skyState: string): HourlyForecast[] {
  const start = new Date(); start.setDate(start.getDate() + 1); start.setHours(1, 0, 0, 0);
  return Array.from({ length: 3 }, (_, i) => ({
    time: new Date(start.getTime() + i * 3_600_000), temperature: 12, humidity: 80, windSpeed: 3, windDirection: 225,
    windGusts: null, precipitation: 0, precipProbability: 0, cloudCover: 50, pressure: 1018, solarRadiation: 0,
    cape: null, boundaryLayerHeight: null, visibility: null, liftedIndex: null, cin: null, snowLevel: null, skyState,
    isDay: false,
  })) as unknown as HourlyForecast[];
}

const skyOf = (container: HTMLElement) => [...new Set([...container.querySelectorAll('.g-sky [data-icon]')].map((e) => e.getAttribute('data-icon')))];

afterEach(cleanup);

describe('the sky of the forecast at night', () => {
  it('the columns of the test are night ones', () => {
    const { container } = render(<ForecastHoursG hourly={nightHours('RAIN')} />);
    expect(container.querySelectorAll('.g-night').length).toBeGreaterThan(0);
  });

  it('rain stays rain, a storm stays a storm and fog stays fog', () => {
    for (const [state, icon] of [['RAIN', 'cloud-rain'], ['STORMS', 'zap'], ['FOG', 'fog']] as const) {
      const { container } = render(<ForecastHoursG hourly={nightHours(state)} />);
      expect(skyOf(container)).toEqual([icon]);
      cleanup();
    }
  });

  it('the sun behind a cloud is a plain cloud, and the sun is the moon', () => {
    expect(skyOf(render(<ForecastHoursG hourly={nightHours('PARTLY_CLOUDY')} />).container)).toEqual(['cloud']);
    cleanup();
    expect(skyOf(render(<ForecastHoursG hourly={nightHours('SUNNY')} />).container)).toEqual(['moon']);
  });
});
