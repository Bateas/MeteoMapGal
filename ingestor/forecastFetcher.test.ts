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

import { getForecast, isForecastFresh } from './forecastFetcher';

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

describe('isForecastFresh', () => {
  const at = (hhmm: string) => Date.UTC(2026, 8, 24, +hhmm.slice(0, 2), +hhmm.slice(3, 5));

  it('expires at the next clock hour, not only after the TTL', () => {
    expect(isForecastFresh(at('20:10'), at('20:50'))).toBe(true);
    expect(isForecastFresh(at('20:59'), at('21:01'))).toBe(false);
  });

  it('gives every clock hour an issue when the caller asks every 30-35 minutes', () => {
    // The analyzer asks every 30 min on a 5-min poll, so real calls land 30-35 min apart.
    const issued = new Set<number>();
    let fetchedAt = -Infinity;
    for (let t = at('00:03'), i = 0; t < at('23:59'); t += (i++ % 2 ? 35 : 30) * 60_000) {
      if (!isForecastFresh(fetchedAt, t)) { fetchedAt = t; issued.add(Math.floor(t / 3_600_000)); }
    }
    expect(issued.size).toBe(24);
  });
});
