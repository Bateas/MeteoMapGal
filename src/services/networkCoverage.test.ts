import { describe, it, expect } from 'vitest';
import { summariseCoverage, sourceLabel, ACTIVE_WINDOW_MS, type CoverageStation } from './networkCoverage';

const NOW = new Date('2026-08-05T12:00:00Z').getTime();
const agoMs = (ms: number) => new Date(NOW - ms).toISOString();

const st = (over: Partial<CoverageStation> = {}): CoverageStation => ({
  station_id: 'mg_1',
  source: 'meteogalicia',
  last_reading: agoMs(5 * 60_000),
  province: 'Pontevedra',
  ...over,
});

describe('summariseCoverage', () => {
  it('separates alive from merely listed', () => {
    // The endpoint is built from `readings`, so it never drops a dead station.
    // A total on its own would keep counting one that went silent in May.
    const out = summariseCoverage([
      st({ station_id: 'a' }),
      st({ station_id: 'b', last_reading: agoMs(60 * 24 * 60 * 60_000) }),
    ], NOW);

    expect(out.total).toBe(2);
    expect(out.active).toBe(1);
  });

  it('counts a station right on the window as alive, and past it as silent', () => {
    const out = summariseCoverage([
      st({ station_id: 'edge', last_reading: agoMs(ACTIVE_WINDOW_MS) }),
      st({ station_id: 'past', last_reading: agoMs(ACTIVE_WINDOW_MS + 60_000) }),
    ], NOW);

    expect(out.active).toBe(1);
  });

  it('treats a station that never reported as silent, not as a crash', () => {
    const out = summariseCoverage([st({ last_reading: null })], NOW);
    expect(out.total).toBe(1);
    expect(out.active).toBe(0);
  });

  it('does not accept an unparseable date as evidence of life', () => {
    const out = summariseCoverage([st({ last_reading: 'no soy una fecha' })], NOW);
    expect(out.active).toBe(0);
  });

  it('groups by province and by source within it', () => {
    const out = summariseCoverage([
      st({ station_id: '1', province: 'Lugo', source: 'aemet' }),
      st({ station_id: '2', province: 'Lugo', source: 'meteogalicia' }),
      st({ station_id: '3', province: 'Lugo', source: 'meteogalicia' }),
      st({ station_id: '4', province: 'Ourense', source: 'netatmo' }),
    ], NOW);

    const lugo = out.provinces.find((p) => p.province === 'Lugo');
    expect(lugo?.total).toBe(3);
    expect(lugo?.bySource[0]).toMatchObject({ source: 'meteogalicia', total: 2 });
    expect(out.provinces.find((p) => p.province === 'Ourense')?.total).toBe(1);
  });

  it('keeps unplaced stations visible instead of dropping them', () => {
    // Hidden, the provinces would add up to less than the network and nobody
    // would know why.
    const out = summariseCoverage([
      st({ station_id: '1', province: null }),
      st({ station_id: '2', province: '   ' }),
    ], NOW);

    expect(out.total).toBe(2);
    expect(out.provinces).toHaveLength(1);
    expect(out.provinces[0].province).toBe('Sin provincia');
  });

  it('sends Sin provincia last however big it is — it is a gap, not a place', () => {
    const out = summariseCoverage([
      ...Array.from({ length: 9 }, (_, i) => st({ station_id: 'x' + i, province: null })),
      st({ station_id: 'p', province: 'Pontevedra' }),
    ], NOW);

    expect(out.provinces[0].province).toBe('Pontevedra');
    expect(out.provinces[out.provinces.length - 1].province).toBe('Sin provincia');
  });

  it('ranks provinces by ACTIVE stations, not by how many are listed', () => {
    // A province full of stations that stopped reporting is not better covered.
    const out = summariseCoverage([
      ...Array.from({ length: 5 }, (_, i) => st({
        station_id: 'dead' + i, province: 'A Coruña', last_reading: agoMs(30 * 24 * 60 * 60_000),
      })),
      st({ station_id: 'alive1', province: 'Ourense' }),
      st({ station_id: 'alive2', province: 'Ourense' }),
    ], NOW);

    expect(out.provinces[0].province).toBe('Ourense');
    expect(out.provinces[0].active).toBe(2);
    expect(out.provinces[1].active).toBe(0);
    expect(out.provinces[1].total).toBe(5);
  });

  it('adds up: the provinces account for the whole network', () => {
    const stations = [
      st({ station_id: '1', province: 'Lugo' }),
      st({ station_id: '2', province: null }),
      st({ station_id: '3', province: 'Ourense', last_reading: agoMs(99 * 60 * 60_000) }),
    ];
    const out = summariseCoverage(stations, NOW);

    expect(out.provinces.reduce((n, p) => n + p.total, 0)).toBe(out.total);
    expect(out.provinces.reduce((n, p) => n + p.active, 0)).toBe(out.active);
    expect(out.bySource.reduce((n, s) => n + s.total, 0)).toBe(out.total);
  });

  it('survives an empty network without inventing one', () => {
    const out = summariseCoverage([], NOW);
    expect(out).toEqual({ provinces: [], total: 0, active: 0, bySource: [] });
  });

  it('names the sources the way the guide does, and passes through anything new', () => {
    expect(sourceLabel('meteogalicia')).toBe('MeteoGalicia');
    expect(sourceLabel('wunderground')).toBe('Wunderground');
    expect(sourceLabel('fuente_nueva')).toBe('fuente_nueva');
  });
});
