/**
 * The map reads lightning from our API: the day once, then the last half hour, and only goes
 * to meteo2api when our API fails (6-oct).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchLightningStrikes } from './lightningClient';

const T0 = Date.parse('2026-10-06T14:00:00Z');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchLightningStrikes', () => {
  it('day from our API, then only the new half hour, then meteo2api when ours fails', async () => {
    const urls: string[] = [];
    let now = T0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.startsWith('/api/v1/lightning/recent?minutes=1440')) return json({ strikes: [[T0 - 60 * 60_000, 42.3, -8.7, -12, 0]] });
      if (url.startsWith('/api/v1/lightning/recent?minutes=30')) {
        if (urls.length > 2) return json({ error: 'down' }, 500);
        return json({ strikes: [[T0 + 2 * 60_000, 42.4, -8.6, 20, 0]] });
      }
      return json({ raiosPosit: [{ date: '06-10-2026 14:05', latitude: 42.5, longitude: -8.5, peakCurrent: 9, idCityHall: 1, delaySymbol: 1 }], raiosNegat: [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchLightningStrikes();
    expect(first).toHaveLength(1);

    now = T0 + 3 * 60_000;
    const second = await fetchLightningStrikes();
    expect(second.map((s) => s.lat)).toEqual([42.4, 42.3]);

    now = T0 + 6 * 60_000;
    const third = await fetchLightningStrikes();
    expect(urls[2]).toMatch(/^\/api\/v1\/lightning\/recent\?minutes=30/);
    expect(urls[3]).toMatch(/^\/meteo2api\//);
    expect(third.map((s) => s.lat)).toEqual([42.5]);
  });
});
