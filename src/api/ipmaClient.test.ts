import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchIpmaData, fetchIpmaNearby, clearIpmaCache, isInsideNorthPortugal } from './ipmaClient';

describe('isInsideNorthPortugal', () => {
  it('correctly identifies Northern Portugal coordinates', () => {
    // Viana do Castelo
    expect(isInsideNorthPortugal(41.69, -8.83)).toBe(true);
    // Monção
    expect(isInsideNorthPortugal(42.07, -8.48)).toBe(true);
    // Madrid (outside)
    expect(isInsideNorthPortugal(40.41, -3.70)).toBe(false);
    // A Coruña (outside north)
    expect(isInsideNorthPortugal(43.37, -8.41)).toBe(false);
  });
});

describe('ipmaClient', () => {
  beforeEach(() => {
    clearIpmaCache();
    vi.restoreAllMocks();
  });

  const mockGeoJson = {
    type: 'FeatureCollection',
    features: [
      // Older reading for station 1200545
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-8.83, 41.69] },
        properties: {
          idEstacao: 1200545,
          localEstacao: 'Viana do Castelo',
          time: '2026-09-20T17:00:00',
          temperatura: 19.5,
          humidade: 80,
          ventoIntensidadeKm: 15,
        },
      },
      // Newer reading for station 1200545 (should be kept)
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-8.83, 41.69] },
        properties: {
          idEstacao: 1200545,
          localEstacao: 'Viana do Castelo',
          time: '2026-09-20T18:00:00',
          temperatura: 20.5,
          humidade: 75,
          ventoIntensidadeKm: 18,
        },
      },
      // Station outside North Portugal (Lisboa ~38.7N) -> should be excluded
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-9.13, 38.72] },
        properties: {
          idEstacao: 1210000,
          localEstacao: 'Lisboa',
          time: '2026-09-20T18:00:00',
          temperatura: 25.0,
          humidade: 50,
        },
      },
    ],
  };

  it('fetches, filters for North Portugal, and deduplicates to latest reading', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockGeoJson,
    } as Response);

    const { stations, readings } = await fetchIpmaData();

    expect(stations.length).toBe(1);
    expect(readings.length).toBe(1);
    expect(stations[0].id).toBe('ipma_1200545');
    expect(stations[0].name).toBe('Viana do Castelo');
    expect(readings[0].temperature).toBe(20.5); // latest reading kept
  });

  it('uses in-memory cache on second call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockGeoJson,
    } as Response);

    await fetchIpmaData();
    await fetchIpmaData();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('fetchIpmaNearby filters by sector radius or extra coverage points', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockGeoJson,
    } as Response);

    // Center in Vigo [-8.72, 42.23] with 70km radius (covers Viana do Castelo ~41.69, -8.83 ~60km away)
    const result = await fetchIpmaNearby([-8.72, 42.23], 70);
    expect(result.stations.length).toBe(1);
    expect(result.readings.length).toBe(1);

    // Center far away without extra points
    clearIpmaCache();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockGeoJson,
    } as Response);
    const resultFar = await fetchIpmaNearby([-7.5, 43.5], 10);
    expect(resultFar.stations.length).toBe(0);
  });
});
