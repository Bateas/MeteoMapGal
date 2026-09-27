/**
 * useSurfMarineData is the ONLY writer of the surf verdict every surface
 * reads. These tests pin what makes that true: it keeps the forecast hours,
 * it decides with the spot's consensus wind (the score), a new score re-decides
 * from the stored hours without downloading again, a pending wind is flagged,
 * and entering Rías from Embalse asks at once instead of leaving the markers
 * on a stale or empty cache.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('../api/meteoSixClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/meteoSixClient')>()),
  fetchMeteoSixMarine: vi.fn(async () => []),
}));
vi.mock('../api/marineClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/marineClient')>()),
  fetchMarineForecast: vi.fn(async () => []),
}));

import { useSurfMarineData } from './useSurfMarineData';
import { useSpotStore } from '../store/spotStore';
import { useSectorStore } from '../store/sectorStore';
import { useWeatherStore } from '../store/weatherStore';
import { SECTORS } from '../config/sectors';
import type { SpotScore } from '../services/spotScoringEngine';
import type { NormalizedReading, NormalizedStation } from '../types/station';

const HOUR = 3_600_000;

/** Own-API payload: 48 h like the ingestor serves, swell from the W. */
function apiPayload(swellHeight: number) {
  const start = Math.floor(Date.now() / HOUR) * HOUR - HOUR;
  return {
    hourly: Array.from({ length: 48 }, (_, i) => ({
      time: new Date(start + i * HOUR).toISOString(),
      waveHeight: swellHeight,
      wavePeriod: 8,
      waveDirection: 270,
      swellHeight,
      swellPeriod: 8,
    })),
  };
}

function score(spotId: string, dirDeg: number, provisional = false): SpotScore {
  return {
    spotId,
    provisional,
    wind: { stationCount: 2, avgSpeedKt: 6, rawAvgSpeedKt: 6, dominantDir: 'X', dirDeg, matchedPattern: null, contributions: [] },
  } as unknown as SpotScore;
}

function setSector(id: 'rias' | 'embalse') {
  useSectorStore.setState({ activeSectorId: id, activeSector: SECTORS.find((s) => s.id === id)! });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => 'visible');
  // 0.8 m of W swell: at A Lanzada (0.75, W beach) that is 0.6 m → PEQUE
  // before wind, SURF OK with offshore NE, still PEQUE with onshore W.
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => apiPayload(0.8) }));
  vi.stubGlobal('fetch', fetchMock);
  useSpotStore.setState({ scores: new Map(), surfWaveCache: new Map() });
  useWeatherStore.setState({ stations: [], currentReadings: new Map() });
  setSector('rias');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useWeatherStore.setState({ stations: [], currentReadings: new Map() });
});

/** A sector with `total` discovered stations of which `fresh` have a reading
 *  now — the engine calls the set partial below 40 % (see isReadingSetPartial). */
function readingSet(total: number, fresh: number) {
  const stations = Array.from({ length: total }, (_, i) => ({
    id: `wu_S${i}`, name: `S${i}`, lat: 42.4, lon: -8.8, altitude: 10, source: 'wunderground', tempOnly: false,
  })) as NormalizedStation[];
  const currentReadings = new Map<string, NormalizedReading>();
  for (let i = 0; i < fresh; i++) {
    currentReadings.set(`wu_S${i}`, {
      stationId: `wu_S${i}`, timestamp: new Date(), windSpeed: null, windGust: null, windDirection: null,
      temperature: 18, humidity: 60, precipitation: null, solarRadiation: null, pressure: null, dewPoint: null,
    });
  }
  useWeatherStore.setState({ stations, currentReadings });
}

/** A score whose wind consensus is absent (engine: every reading under 1 kt, or no source). */
function noWindScore(spotId: string): SpotScore {
  return { spotId, provisional: false, wind: null } as unknown as SpotScore;
}

describe('useSurfMarineData', () => {
  it('stores the hours and decides with the consensus wind of the spot', async () => {
    useSpotStore.setState({ scores: new Map([['surf-lanzada', score('surf-lanzada', 60)]]) });
    renderHook(() => useSurfMarineData());

    await waitFor(() => expect(useSpotStore.getState().surfWaveCache.size).toBe(3));
    const e = useSpotStore.getState().surfWaveCache.get('surf-lanzada')!;
    expect(e.hours).toHaveLength(48);
    expect(e.basis).toBe('modelo');
    expect(e.waveHeight).toBeCloseTo(0.6, 3);
    expect(e.windPending).toBe(false);
    expect(e.verdict?.label).toBe('SURF OK'); // PEQUE + offshore NE
    expect(e.verdict?.summary).toMatch(/offshore/);
  });

  it('a wind shift re-decides from the stored hours without downloading again', async () => {
    useSpotStore.setState({ scores: new Map([['surf-lanzada', score('surf-lanzada', 60)]]) });
    renderHook(() => useSurfMarineData());
    await waitFor(() => expect(useSpotStore.getState().surfWaveCache.size).toBe(3));
    const calls = fetchMock.mock.calls.length;
    expect(calls).toBe(3);

    act(() => {
      useSpotStore.setState({ scores: new Map([['surf-lanzada', score('surf-lanzada', 270)]]) });
    });

    const e = useSpotStore.getState().surfWaveCache.get('surf-lanzada')!;
    // SURF OK (offshore NE) → PEQUE: the onshore W takes the bonus away and
    // cannot go further, the wind never makes a 0.6 m sea FLAT.
    expect(e.verdict?.label).toBe('PEQUE');
    expect(e.verdict?.summary).toMatch(/onshore/);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('flags a pending wind while the spot has no score, and clears it when one arrives', async () => {
    renderHook(() => useSurfMarineData());
    await waitFor(() => expect(useSpotStore.getState().surfWaveCache.size).toBe(3));
    expect(useSpotStore.getState().surfWaveCache.get('surf-lanzada')!.windPending).toBe(true);

    act(() => {
      useSpotStore.setState({ scores: new Map([['surf-lanzada', score('surf-lanzada', 60, true)]]) });
    });
    expect(useSpotStore.getState().surfWaveCache.get('surf-lanzada')!.windPending).toBe(true); // provisional

    act(() => {
      useSpotStore.setState({ scores: new Map([['surf-lanzada', score('surf-lanzada', 60)]]) });
    });
    const e = useSpotStore.getState().surfWaveCache.get('surf-lanzada')!;
    expect(e.windPending).toBe(false);
    expect(e.verdict?.label).toBe('SURF OK');
  });

  it('asks nothing in Embalse and asks at once on entering Rías', async () => {
    setSector('embalse');
    renderHook(() => useSurfMarineData());
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useSpotStore.getState().surfWaveCache.size).toBe(0);

    act(() => setSector('rias'));
    await waitFor(() => expect(useSpotStore.getState().surfWaveCache.size).toBe(3));
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      '/api/v1/marine?spot=surf-patos',
      '/api/v1/marine?spot=surf-lanzada',
      '/api/v1/marine?spot=surf-corrubedo',
    ]);
  });

  it('no wind consensus: waits while the readings arrive, decides without wind once they are in', async () => {
    readingSet(10, 1); // 10 % fresh → still arriving
    useSpotStore.setState({ scores: new Map([['surf-lanzada', noWindScore('surf-lanzada')]]) });
    renderHook(() => useSurfMarineData());
    await waitFor(() => expect(useSpotStore.getState().surfWaveCache.size).toBe(3));
    expect(useSpotStore.getState().surfWaveCache.get('surf-lanzada')!.windPending).toBe(true);

    // The set completes; the engine re-scores (a new scores Map) and the spot
    // still has no consensus: calm glassy morning, not a loading state.
    act(() => {
      readingSet(10, 10);
      useSpotStore.setState({ scores: new Map([['surf-lanzada', noWindScore('surf-lanzada')]]) });
    });
    const e = useSpotStore.getState().surfWaveCache.get('surf-lanzada')!;
    expect(e.windPending).toBe(false);
    expect(e.verdict?.label).toBe('PEQUE'); // 0.6 m, no wind modifier
    expect(e.verdict?.summary).not.toMatch(/onshore|offshore/);
  });

  it('coming back to Rías marks the kept entries pending at once, before any render', async () => {
    useSpotStore.setState({ scores: new Map([['surf-lanzada', score('surf-lanzada', 60)]]) });
    renderHook(() => useSurfMarineData());
    await waitFor(() => expect(useSpotStore.getState().surfWaveCache.get('surf-lanzada')?.verdict?.label).toBe('SURF OK'));

    act(() => setSector('embalse'));
    // Embalse scores replace the Rías ones while the user is away
    act(() => { useSpotStore.setState({ scores: new Map([['castrelo', score('castrelo', 250)]]) }); });
    expect(useSpotStore.getState().surfWaveCache.get('surf-lanzada')!.windPending).toBe(false); // untouched in Embalse

    // Synchronous: the sector subscription rebuilds inside setState itself,
    // so the check runs before act() lets React render or run any effect.
    act(() => {
      setSector('rias');
      expect(useSpotStore.getState().surfWaveCache.get('surf-lanzada')!.windPending).toBe(true);
    });
  });

  it('with no forecast at all the entry says «sin dato» instead of a FLAT', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({}) }));
    useSpotStore.setState({ scores: new Map([['surf-patos', score('surf-patos', 190)]]) });
    renderHook(() => useSurfMarineData());
    await waitFor(() => expect(useSpotStore.getState().surfWaveCache.size).toBe(3));
    const e = useSpotStore.getState().surfWaveCache.get('surf-patos')!;
    expect(e.verdict).toBeNull();
    expect(e.waveHeight).toBeNull();
  });
});
