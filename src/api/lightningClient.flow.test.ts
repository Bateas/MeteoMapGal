/**
 * The map reads lightning from our API: the day once, then the last half hour. When our API
 * fails it keeps the last day it had and never asks MeteoGalicia itself (9-oct: MeteoGalicia
 * asked third parties not to use meteo2api, and for 5 minutes between requests). And it says so:
 * an answer that is not fresh comes marked, so «no strikes» is never read as «no storm».
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const T0 = Date.parse('2026-10-06T14:00:00Z');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** A fresh copy of the module: its cache lives at module level. */
async function client() {
  vi.resetModules();
  return import('./lightningClient');
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchLightningStrikes', () => {
  it('day from our API, then only the new half hour, the last day marked stale when ours fails, fresh again a minute later', async () => {
    const { fetchLightningStrikes } = await client();
    const urls: string[] = [];
    let now = T0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.startsWith('/api/v1/lightning/recent?minutes=1440')) return json({ strikes: [[T0 - 60 * 60_000, 42.3, -8.7, -12, 0]] });
      if (url.startsWith('/api/v1/lightning/recent?minutes=30')) {
        if (urls.length === 3) return json({ error: 'down' }, 500);
        return json({ strikes: [[T0 + 2 * 60_000, 42.4, -8.6, 20, 0]] });
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchLightningStrikes();
    expect(first.strikes).toHaveLength(1);
    expect(first.fresh).toBe(true);
    expect(first.asOf).toBe(T0);

    now = T0 + 3 * 60_000;
    const second = await fetchLightningStrikes();
    expect(second.strikes.map((s) => s.lat)).toEqual([42.4, 42.3]);
    expect(second.fresh).toBe(true);

    now = T0 + 6 * 60_000;
    const third = await fetchLightningStrikes();
    expect(urls[2]).toMatch(/^\/api\/v1\/lightning\/recent\?minutes=30/);
    expect(urls).toHaveLength(3);
    expect(urls.some((u) => /meteo2api/.test(u))).toBe(false);
    expect(third.fresh).toBe(false);
    expect(third.asOf).toBe(T0 + 3 * 60_000); // the last good answer, not now
    expect(third.strikes.map((s) => s.lat)).toEqual([42.4, 42.3]);
    expect(third.strikes[0].ageMinutes).toBe(4);

    // Inside the minute after the failure the hook's quick retries stay off the network.
    now = T0 + 6 * 60_000 + 30_000;
    const retry = await fetchLightningStrikes();
    expect(urls).toHaveLength(3);
    expect(retry.fresh).toBe(false);

    now = T0 + 7 * 60_000 + 5_000;
    const back = await fetchLightningStrikes();
    expect(urls).toHaveLength(4);
    expect(back.fresh).toBe(true);
    expect(back.asOf).toBe(now);
  });

  it('cold start with our API down: no strikes, no time, not fresh', async () => {
    const { fetchLightningStrikes } = await client();
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'down' }, 503)));
    const r = await fetchLightningStrikes();
    expect(r).toEqual({ strikes: [], asOf: null, fresh: false });
  });

  it('our API answers but says MeteoGalicia stopped answering: not fresh, with the time of its last good answer, also from the cache', async () => {
    const { fetchLightningStrikes } = await client();
    let now = T0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const lastOk = new Date(T0 - 25 * 60_000).toISOString();
    const fetchMock = vi.fn(async () => json({ strikes: [], fresh: false, polledAt: lastOk }));
    vi.stubGlobal('fetch', fetchMock);

    const r = await fetchLightningStrikes();
    expect(r.fresh).toBe(false);
    expect(r.feedStale).toEqual({ lastOkAt: T0 - 25 * 60_000 });
    expect(r.asOf).toBe(T0);

    now = T0 + 30_000; // inside the cache: same answer, no new request
    const again = await fetchLightningStrikes();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(again.fresh).toBe(false);
    expect(again.feedStale).toEqual({ lastOkAt: T0 - 25 * 60_000 });
  });

  it('a feed that never answered is stale with no time; a fresh feed and an older API without the fields are fresh', async () => {
    const { readFeedState } = await client();
    expect(readFeedState({ fresh: false, polledAt: null })).toEqual({ fresh: false, polledAt: null });
    expect(readFeedState({ fresh: true, polledAt: '2026-11-26T16:00:00.000Z' })).toEqual({ fresh: true, polledAt: Date.parse('2026-11-26T16:00:00Z') });
    expect(readFeedState({})).toEqual({ fresh: null, polledAt: null });
    expect(readFeedState({ fresh: 'no', polledAt: 'x' })).toEqual({ fresh: null, polledAt: null });

    const { fetchLightningStrikes } = await client();
    vi.spyOn(Date, 'now').mockImplementation(() => T0);
    vi.stubGlobal('fetch', vi.fn(async () => json({ strikes: [] })));
    const r = await fetchLightningStrikes();
    expect(r).toEqual({ strikes: [], asOf: T0, fresh: true });
  });
});
