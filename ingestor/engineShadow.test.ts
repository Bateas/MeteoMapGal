import { describe, it, expect } from 'vitest';
import { toEngineInputs, scoreWithEngine, findDivergences, describeDivergences } from './engineShadow';
import { isWorthAlerting, type SpotResult, type StationReading, type BuoyWind } from './analyzerLogic';
import type { SpotScore } from '../src/services/spotScoringEngine';
import { RIAS_SPOTS } from '../src/config/spots';

const lourido = RIAS_SPOTS.find((s) => s.id === 'lourido')!;

function row(id: string, lat: number, lon: number, ms: number, dir: number): StationReading {
  return {
    station_id: id, latitude: lat, longitude: lon, wind_speed: ms, wind_gust: ms * 1.3, wind_dir: dir,
    temperature: 22, humidity: 60, time: new Date().toISOString(), name: id, source: 'meteogalicia', altitude: 20,
  };
}

describe('toEngineInputs', () => {
  it('keeps units and metadata, and drops rows without coordinates', () => {
    const { stations, readingMap } = toEngineInputs(
      [row('mg_1', 42.4, -8.7, 4, 250), { ...row('mg_2', 0, 0, 3, 200) }],
      [],
    );
    expect(stations.map((s) => s.id)).toEqual(['mg_1']);
    expect(stations[0]).toMatchObject({ source: 'meteogalicia', altitude: 20, lat: 42.4, lon: -8.7 });
    expect(readingMap.get('mg_1')).toMatchObject({ windSpeed: 4, windDirection: 250 });
  });

  it('gives each buoy its real age, not "now"', () => {
    const old = new Date(Date.now() - 4 * 3600_000).toISOString();
    const buoy: BuoyWind = { station_id: 3221, wind_speed: 5, wind_dir: 240, lat: 42.2, lon: -8.8, time: old };
    const { buoyReadings } = toEngineInputs([], [buoy]);
    expect(buoyReadings[0].timestamp).toBe(old);
  });
});

describe('scoreWithEngine', () => {
  it('scores the non-surf spots of both sectors from database rows', () => {
    const [lon, lat] = lourido.center;
    const scores = scoreWithEngine([row('mg_near', lat + 0.01, lon, 5, 250), row('mg_near2', lat - 0.01, lon, 5.5, 255)], []);
    expect(scores.has('lourido')).toBe(true);
    expect(scores.has('castrelo')).toBe(true);
    expect([...scores.keys()].some((id) => RIAS_SPOTS.find((s) => s.id === id)?.category === 'surf')).toBe(false);
  });
});

describe('findDivergences', () => {
  const result = (spotId: string, verdict: SpotResult['verdict'], kt: number) =>
    ({ spot: { id: spotId }, verdict, avgWindKt: kt } as unknown as SpotResult);
  const score = (verdict: SpotScore['verdict'], kt: number, provisional = false) =>
    ({ verdict, effectiveWindKt: kt, wind: { avgSpeedKt: kt }, provisional } as unknown as SpotScore);

  it('flags the 25-sep Lourido case: 10kt on the map, 6 in the pipeline', () => {
    const d = findDivergences([result('lourido', 'light', 6)], new Map([['lourido', score('sailing', 10)]]));
    expect(d).toHaveLength(1);
    expect(describeDivergences(d, 1)).toContain('lourido light 6kt vs sailing 10kt');
  });

  it('ignores agreement within 2kt and spots the engine still calls provisional', () => {
    expect(findDivergences([result('a', 'light', 6)], new Map([['a', score('light', 7.5)]]))).toHaveLength(0);
    expect(findDivergences([result('b', 'light', 6)], new Map([['b', score('good', 14, true)]]))).toHaveLength(0);
    expect(describeDivergences([], 3)).toBeNull();
  });

  it('stays quiet on a calm-vs-light split that changes no alert', () => {
    expect(findDivergences([result('vao', 'calm', 5)], new Map([['vao', score('light', 5.8)]]))).toHaveLength(0);
  });

  it('flags a small gap when only one side would announce the spot', () => {
    const d = findDivergences([result('lanzada', 'sailing', 9)], new Map([['lanzada', score('sailing', 10.5)]]));
    expect(d.map((x) => x.spotId)).toEqual(['lanzada']);
  });
});

describe('isWorthAlerting', () => {
  it('announces good and strong, and sailing only from 10kt', () => {
    expect(isWorthAlerting('good', 12)).toBe(true);
    expect(isWorthAlerting('strong', null)).toBe(true);
    expect(isWorthAlerting('sailing', 10)).toBe(true);
    expect(isWorthAlerting('sailing', 9)).toBe(false);
    expect(isWorthAlerting('light', 7)).toBe(false);
  });
});
