/**
 * The API serves the forecast to visitors. When the hourly copy expires, a
 * crowd arriving during the refresh must cost the providers ONE refresh, not
 * one per visitor.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./meteoSixFetcher.js', () => ({
  isMeteoSixConfigured: () => false,
  getWrfForecast: vi.fn(),
  getUswanForecast: vi.fn(),
}));

import { getForecast } from './forecastFetcher';

const OM_BODY = {
  hourly: {
    time: ['2026-09-23T12:00', '2026-09-23T13:00'],
    temperature_2m: [20, 21],
    wind_speed_10m: [3, 4],
  },
};

describe('getForecast', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return new Response(JSON.stringify(OM_BODY), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the provider once for a crowd arriving on a cold copy', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => getForecast('rias')));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r).toHaveLength(2);
  });

  it('serves the refreshed copy without asking again', async () => {
    await getForecast('rias');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
