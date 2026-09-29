/**
 * 29-sep 04:04: every request failed for a few seconds during the hourly rediscovery, and
 * MeteoGalicia, Wunderground, AEMET and IPMA were not polled again until 05:04.
 */
import { describe, it, expect } from 'vitest';
import { carryOverEmptySources, DISCOVERY_CARRY_MAX_MS } from './discoveryCarry';
import type { NormalizedStation, StationSource } from '../src/types/station';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 29, 2, 4);

function st(id: string, source: StationSource): NormalizedStation {
  return { id, source, name: id, lat: 42.3, lon: -8.7, altitude: 10 };
}
const map = (list: NormalizedStation[]) => new Map(list.map((s) => [s.id, s]));

const before = map([
  st('mg_10905', 'meteogalicia'), st('mg_14001', 'meteogalicia'), st('aemet_1495', 'aemet'),
  st('wu_EXAMPLE1', 'wunderground'), st('ipma_1', 'ipma'), st('nt_1', 'netatmo'), st('mc_1', 'meteoclimatic'),
]);
const goodAnHourAgo = new Map<string, number>(
  ['meteogalicia', 'aemet', 'wunderground', 'ipma', 'netatmo', 'meteoclimatic'].map((s) => [s, NOW - HOUR]),
);

describe('carryOverEmptySources — a failed discovery keeps the stations it had', () => {
  it('04:04: the four sources that failed keep their stations; the ones that answered are taken as they came', () => {
    const answered = map([st('nt_1', 'netatmo'), st('nt_2', 'netatmo'), st('mc_1', 'meteoclimatic')]);
    const r = carryOverEmptySources(before, answered, goodAnHourAgo, NOW);
    expect([...r.stations.keys()].sort()).toEqual(
      ['aemet_1495', 'ipma_1', 'mc_1', 'mg_10905', 'mg_14001', 'nt_1', 'nt_2', 'wu_EXAMPLE1'],
    );
    expect(r.carried.sort((a, b) => a.source.localeCompare(b.source))).toEqual([
      { source: 'aemet', count: 1 }, { source: 'ipma', count: 1 }, { source: 'meteogalicia', count: 2 }, { source: 'wunderground', count: 1 },
    ]);
    expect(r.lastGoodAt.get('netatmo')).toBe(NOW);
    expect(r.lastGoodAt.get('meteogalicia')).toBe(NOW - HOUR); // not refreshed by a carry
  });

  it('a source that answers is taken as it comes: a station it stops listing is dropped', () => {
    const answered = map([st('mg_10905', 'meteogalicia'), st('aemet_1495', 'aemet'), st('wu_EXAMPLE1', 'wunderground'),
      st('ipma_1', 'ipma'), st('nt_1', 'netatmo'), st('mc_1', 'meteoclimatic')]);
    const r = carryOverEmptySources(before, answered, goodAnHourAgo, NOW);
    expect(r.stations.has('mg_14001')).toBe(false);
    expect(r.carried).toEqual([]);
  });

  it('after a day without a good discovery, an empty source is taken as really empty', () => {
    const stale = new Map(goodAnHourAgo);
    stale.set('meteogalicia', NOW - DISCOVERY_CARRY_MAX_MS - 1);
    const r = carryOverEmptySources(before, map([st('nt_1', 'netatmo')]), stale, NOW);
    expect(r.stations.has('mg_10905')).toBe(false);
    expect(r.stations.has('aemet_1495')).toBe(true);
  });

  it('first discovery (nothing before): nothing to carry', () => {
    const r = carryOverEmptySources(new Map(), map([st('nt_1', 'netatmo')]), new Map(), NOW);
    expect([...r.stations.keys()]).toEqual(['nt_1']);
    expect(r.carried).toEqual([]);
  });
});
