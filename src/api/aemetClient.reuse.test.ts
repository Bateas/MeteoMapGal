/**
 * The AEMET observations are one ~3 MB file for all of Spain. A cold load
 * downloaded and parsed it twice (default sector, then the linked one); a
 * download is now reused for a minute, and a failed one is not.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAllObservations, __resetObservationsReuseForTests } from './aemetClient';

function aemetFetch(ok = true) {
  return vi.fn(async (url: string) => {
    if (url.includes('/api/v1/aemet/')) {
      return new Response(JSON.stringify({ estado: 200, datos: 'https://opendata.aemet.es/opendata/sh/abc' }), { status: 200 });
    }
    if (!ok) return new Response('fail', { status: 500 });
    return new Response(JSON.stringify([{ idema: '1484C', vis: 3 }]), {
      status: 200, headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  });
}

describe('fetchAllObservations — one download per minute', () => {
  beforeEach(() => __resetObservationsReuseForTests());
  afterEach(() => vi.unstubAllGlobals());

  it('reuses a recent download instead of fetching the file again', async () => {
    const f = aemetFetch();
    vi.stubGlobal('fetch', f);
    const [a, b] = await Promise.all([fetchAllObservations(), fetchAllObservations()]);
    await fetchAllObservations();
    expect(a).toEqual(b);
    expect(f).toHaveBeenCalledTimes(2); // one step-one + one data file, not three of each
  });

  it('does not reuse a failed download', async () => {
    vi.stubGlobal('fetch', aemetFetch(false));
    await expect(fetchAllObservations()).rejects.toThrow();
    const f = aemetFetch();
    vi.stubGlobal('fetch', f);
    await expect(fetchAllObservations()).resolves.toHaveLength(1);
  });
});
