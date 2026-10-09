/**
 * The map reads lightning from our API: the day once, then the last half hour. When our API
 * fails it keeps the last day it had and never asks MeteoGalicia itself (9-oct: MeteoGalicia
 * asked third parties not to use meteo2api, and for 5 minutes between requests).
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
  it('day from our API, then only the new half hour, then the last day when ours fails', async () => {
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
      throw new Error(`unexpected url ${url}`);
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
    expect(urls).toHaveLength(3);
    expect(urls.some((u) => /meteo2api/.test(u))).toBe(false);
    expect(third.map((s) => s.lat)).toEqual([42.4, 42.3]);
    expect(third[0].ageMinutes).toBe(4);
  });
});
