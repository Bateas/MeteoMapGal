import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWUStationsFromApi, WU_LIST_SEEN_MAX_MIN } from './wundergroundClient';

const listed = (id: string, seen: number, extra: Record<string, unknown> = {}) => ({
  station_id: id, source: 'wunderground', name: 'Cartelle', lat: 42.247, lon: -8.055,
  altitude: 0, province: 'Ourense', seen_min_ago: seen, last_reading: null, ...extra,
});

function answer(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })));
}

describe('fetchWUStationsFromApi', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns the listed stations into map stations', async () => {
    answer({ count: 1, stations: [listed('wu_ICARTE66', 20)] });
    expect(await fetchWUStationsFromApi()).toEqual([
      { id: 'wu_ICARTE66', source: 'wunderground', name: 'Cartelle', lat: 42.247, lon: -8.055, altitude: 0 },
    ]);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/v1/stations/list?source=wunderground');
  });

  it('drops stations discovery has not returned for a while, and anything that is not WU', async () => {
    answer({ stations: [
      listed('wu_OLD', WU_LIST_SEEN_MAX_MIN + 1),
      listed('mg_10144', 5, { source: 'meteogalicia' }),
      listed('wu_NOCOORD', 5, { lat: null }),
      listed('wu_OK', WU_LIST_SEEN_MAX_MIN),
    ] });
    expect((await fetchWUStationsFromApi())?.map((s) => s.id)).toEqual(['wu_OK']);
  });

  it('returns null, so the caller asks WU directly, when the list is unusable', async () => {
    answer({}, false);
    expect(await fetchWUStationsFromApi()).toBeNull();
    answer({ stations: 'nope' });
    expect(await fetchWUStationsFromApi()).toBeNull();
    answer({ stations: [listed('wu_OLD', 999)] });   // nothing current is as good as nothing
    expect(await fetchWUStationsFromApi()).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    expect(await fetchWUStationsFromApi()).toBeNull();
  });
});
