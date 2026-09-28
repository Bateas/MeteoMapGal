/**
 * The list our server keeps says, per station, whether any recent reading carried wind. For
 * Netatmo that is the only way left to tell a station without its anemometer module, once the
 * browser stops asking Netatmo itself.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchListedStations } from './stationListClient';

const row = (station_id: string, source: string, extra: Record<string, unknown> = {}) => ({
  station_id, source, name: station_id, lat: 42.2, lon: -8.7, altitude: 10, seen_min_ago: 30, ...extra,
});

function serve(stations: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ count: stations.length, stations }))));
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchListedStations — wind flag', () => {
  it('marks a Netatmo without wind (or with no recent reading) as temperature-only', async () => {
    serve([
      row('nt_wind01', 'netatmo', { has_wind: true }),
      row('nt_temp01', 'netatmo', { has_wind: false }),
      row('nt_quiet1', 'netatmo', { has_wind: null }),
    ]);
    const got = await fetchListedStations('netatmo');
    expect(got?.map((s) => [s.id, s.tempOnly])).toEqual([
      ['nt_wind01', false],
      ['nt_temp01', true],
      ['nt_quiet1', true],
    ]);
  });

  it('leaves the flag unset when the server does not send it (older server)', async () => {
    serve([row('nt_wind01', 'netatmo')]);
    const got = await fetchListedStations('netatmo');
    expect(got?.[0].tempOnly).toBeUndefined();
  });

  it('does not touch other networks: an AEMET station without wind keeps its place', async () => {
    serve([row('aemet_1484C', 'aemet', { has_wind: false })]);
    const got = await fetchListedStations('aemet');
    expect(got?.[0].tempOnly).toBeUndefined();
  });
});
