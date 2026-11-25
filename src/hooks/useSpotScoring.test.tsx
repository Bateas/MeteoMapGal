/**
 * From the stores to the verdict every surface reads. The «same verdict everywhere» tests build their score with the
 * engine directly; nothing went through this hook, which is the one that feeds the map. A wrong argument in its call to
 * the engine, or a lost «calculando» while the buoys are still on their way, would have passed every test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../api/naoClient', () => ({ fetchTeleconnections: () => Promise.resolve([]) }));
vi.mock('../api/upperAirClient', () => ({ fetchUpperAirLevels: () => Promise.resolve(null) }));
vi.mock('../api/swanSpotHeights', () => ({ swanHeightsFor: () => new Map<string, number>() }));

import { useSpotScoring } from './useSpotScoring';
import { useWeatherStore } from '../store/weatherStore';
import { useBuoyStore } from '../store/buoyStore';
import { useSpotStore } from '../store/spotStore';
import { useSectorStore } from '../store/sectorStore';
import { SECTORS } from '../config/sectors';
import { getSpotsForSector } from '../config/spots';
import { scoreAllSpots, type SpotThermalContext } from '../services/spotScoringEngine';
import { displayVerdict, displayWindKt } from '../config/verdictStyles';
import type { NormalizedStation, NormalizedReading } from '../types/station';

const RIAS = SECTORS.find((s) => s.id === 'rias')!;
const EMBALSE = SECTORS.find((s) => s.id === 'embalse')!;
const msFromKt = (kt: number) => kt / 1.94384;

/** Six official stations around a point, all reading the same wind a few minutes ago. */
function network(center: [number, number], kt: number, dir: number) {
  const [lon, lat] = center;
  const stations: NormalizedStation[] = [[0.02, 0.01], [-0.02, 0.02], [0.01, -0.03], [-0.03, -0.01], [0.03, 0.03], [0, 0.04]].map(([a, b], i) => ({
    id: `mg_9990${i}`, name: `Estación ${i}`, lat: lat + a, lon: lon + b, altitude: 20, source: 'meteogalicia', tempOnly: false,
  }));
  const readings = new Map<string, NormalizedReading>(stations.map((s) => [s.id, {
    stationId: s.id, timestamp: new Date(Date.now() - 4 * 60_000),
    windSpeed: msFromKt(kt), windGust: null, windDirection: dir,
    temperature: 14, humidity: 80, precipitation: null, solarRadiation: null, pressure: 1015, dewPoint: 10,
  }]));
  return { stations, readings };
}

/** What the hook hands the engine as thermal context when the thermal stores are still empty. */
const NO_THERMAL: SpotThermalContext = {
  deltaT: null, thermalProbability: 0, windWindow: null, atmosphere: { cloudCover: null, cape: null },
  bestTendency: 'none', hasStormAlert: false, rainProbability: null,
};

function seed(sector: typeof RIAS, kt: number, dir = 225) {
  const spots = getSpotsForSector(sector.id);
  const anchor = spots.find((s) => s.id === (sector.id === 'rias' ? 'cesantes' : 'castrelo')) ?? spots[0];
  const { stations, readings } = network(anchor.center as [number, number], kt, dir);
  useSectorStore.setState({ activeSectorId: sector.id, activeSector: sector } as never);
  useWeatherStore.setState({ stations, currentReadings: readings, readingHistory: new Map(), readingsEpoch: 1 } as never);
  return { spots, anchor, stations, readings };
}

/** The scoring is deferred 50 ms; the mocked fetches settle in the same turn. */
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(80); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 24, 16, 0));
  useSpotStore.setState({ scores: new Map(), surfWaveCache: new Map(), windHistory: new Map() } as never);
  useBuoyStore.setState({ buoys: [], error: null } as never);
});

afterEach(() => {
  vi.useRealTimers();
  useWeatherStore.setState({ stations: [], currentReadings: new Map(), readingHistory: new Map(), readingsEpoch: 0 } as never);
  useSpotStore.setState({ scores: new Map() } as never);
  useBuoyStore.setState({ buoys: [], error: null } as never);
});

describe('useSpotScoring', () => {
  it('stores, for every spot of the sector, the verdict and the figure the engine gives for the same readings', async () => {
    const { spots, stations, readings } = seed(RIAS, 14);
    useBuoyStore.setState({ buoys: [], error: 'sin respuesta' } as never); // a failed fetch: scored without buoys
    const { unmount } = renderHook(() => useSpotScoring());
    await settle();

    const stored = useSpotStore.getState().scores;
    const expected = scoreAllSpots(spots, stations, readings, [], NO_THERMAL, undefined, new Map(), undefined, null,
      { states: new Map(), nowMs: Date.now() }, new Map());
    expect(stored.size).toBe(spots.length);
    for (const spot of spots) {
      const got = stored.get(spot.id), want = expected.get(spot.id);
      expect([spot.id, displayVerdict(got), displayWindKt(got)]).toEqual([spot.id, displayVerdict(want), displayWindKt(want)]);
    }
    // And the case is a real one: the spot the stations surround has wind and a verdict.
    const anchor = stored.get('cesantes')!;
    expect(displayVerdict(anchor)).not.toBe('unknown');
    expect(displayWindKt(anchor)).toBeGreaterThan(8);
    unmount();
  });

  it('on the coast, while the buoys have neither landed nor failed, every sailing spot says «calculando»', async () => {
    const { spots } = seed(RIAS, 14);
    const { unmount } = renderHook(() => useSpotScoring());
    await settle();

    const stored = useSpotStore.getState().scores;
    const sailing = spots.filter((s) => s.category !== 'surf');
    expect(sailing.length).toBeGreaterThan(0);
    for (const spot of sailing) {
      expect([spot.id, displayVerdict(stored.get(spot.id)), displayWindKt(stored.get(spot.id))]).toEqual([spot.id, 'unknown', null]);
    }
    unmount();
  });

  it('and gives the verdict at once when the buoy fetch settles, without waiting for the next tick', async () => {
    seed(RIAS, 14);
    const { unmount } = renderHook(() => useSpotScoring());
    await settle();
    expect(displayVerdict(useSpotStore.getState().scores.get('cesantes'))).toBe('unknown');

    act(() => useBuoyStore.setState({ error: 'sin respuesta' } as never));
    await settle(); // 80 ms: far inside the 5 s between scorings
    expect(displayVerdict(useSpotStore.getState().scores.get('cesantes'))).not.toBe('unknown');
    unmount();
  });

  it('inland there are no buoys to wait for: the verdict shows from the first scoring', async () => {
    const { anchor } = seed(EMBALSE, 14);
    const { unmount } = renderHook(() => useSpotScoring());
    await settle();
    const score = useSpotStore.getState().scores.get(anchor.id);
    expect(score).toBeDefined();
    expect(displayVerdict(score)).not.toBe('unknown');
    unmount();
  });

  it('readings that change again inside five seconds do not score twice, and do after', async () => {
    const { stations } = seed(EMBALSE, 14);
    const { unmount } = renderHook(() => useSpotScoring());
    await settle();
    const first = useSpotStore.getState().scores;

    const calmer = network([stations[0].lon - 0.01, stations[0].lat - 0.02], 3, 225).readings;
    act(() => useWeatherStore.setState({ currentReadings: calmer, readingsEpoch: 2 } as never));
    await settle();
    expect(useSpotStore.getState().scores).toBe(first);

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    act(() => useWeatherStore.setState({ readingsEpoch: 3 } as never));
    await settle();
    expect(useSpotStore.getState().scores).not.toBe(first);
    unmount();
  });
});
