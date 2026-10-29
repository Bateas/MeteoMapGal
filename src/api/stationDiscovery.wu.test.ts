/**
 * Wunderground discovery reads the list our server keeps. Only in development, when that list
 * cannot be read, does it ask api.weather.com: in production that handed every visitor's
 * address to WU, with the key in the URL, and with WU silent since 21-oct each Rías visit made
 * 15 lookups that came back with nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NormalizedStation } from '../types/station';

const direct = vi.hoisted(() => ({ value: true }));

vi.mock('./aemetClient', () => ({ fetchStationInventory: vi.fn(async () => []) }));
vi.mock('./meteogaliciaClient', () => ({ fetchStationList: vi.fn(async () => []) }));
vi.mock('./meteoclimaticClient', () => ({ fetchMeteoclimaticFeed: vi.fn(async () => []) }));
vi.mock('./wundergroundClient', () => ({
  fetchWUNearbyStations: vi.fn(async () => []),
  fetchWUStationsFromApi: vi.fn(async () => null),
  get WU_DIRECT() { return direct.value; },
}));
vi.mock('./netatmoClient', () => ({
  fetchNetatmoStations: vi.fn(async () => []),
  netatmoStationsInRadius: vi.fn(() => null),
  NETATMO_DIRECT: true,
}));
vi.mock('./ipmaClient', () => ({ fetchIpmaNearby: vi.fn(async () => ({ stations: [], readings: [] })) }));
vi.mock('./skyxClient', () => ({ fetchSkyXData: vi.fn(async () => ({ station: null, reading: null })) }));

import { discoverStations, clearSectorStationsCache } from './stationDiscovery';
import { fetchWUNearbyStations, fetchWUStationsFromApi } from './wundergroundClient';

const extra = [{ name: 'Baiona', lon: -8.85, lat: 42.12 }, { name: 'Cangas', lon: -8.78, lat: 42.26 }];
const rias = { center: [-8.68, 42.3] as [number, number], radiusKm: 40, meteoclimaticRegions: [], sectorId: 'rias', extraCoveragePoints: extra };
const embalse = { center: [-8.1, 42.29] as [number, number], radiusKm: 35, meteoclimaticRegions: [], sectorId: 'embalse' };

const wu = (id: string, lat: number, lon: number): NormalizedStation =>
  ({ id: `wu_${id}`, source: 'wunderground', name: id, lat, lon, altitude: 0 });

describe('Wunderground discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSectorStationsCache();
    direct.value = true;
  });

  it('in production never asks WU, even when our list holds nothing current', async () => {
    direct.value = false;
    vi.mocked(fetchWUStationsFromApi).mockResolvedValue(null);
    const r = await discoverStations(rias);

    expect(fetchWUNearbyStations).not.toHaveBeenCalled();
    expect(r.filter((s) => s.source === 'wunderground')).toEqual([]);
  });

  it('takes the stations from our list and never asks WU when the list is there', async () => {
    vi.mocked(fetchWUStationsFromApi).mockResolvedValue([
      wu('ICARTE66', 42.247, -8.055),   // Cartelle, inside the Embalse radius
      wu('IVIGO73', 42.204, -8.713),    // Vigo, inside the Rías radius
    ]);
    const [e, r] = await Promise.all([discoverStations(embalse), discoverStations(rias)]);

    expect(fetchWUNearbyStations).not.toHaveBeenCalled();
    expect(fetchWUStationsFromApi).toHaveBeenCalledTimes(1); // one request for both sectors
    // The same radius check as before still decides which sector gets which station.
    expect(e.map((s) => s.id)).toEqual(['wu_ICARTE66']);
    expect(r.map((s) => s.id)).toEqual(['wu_IVIGO73']);
  });

  it('asks WU directly, centre plus every coverage point, when the list cannot be read', async () => {
    vi.mocked(fetchWUStationsFromApi).mockResolvedValue(null);
    vi.mocked(fetchWUNearbyStations).mockResolvedValue([wu('IVIGO73', 42.204, -8.713)]);
    const r = await discoverStations(rias);

    expect(fetchWUNearbyStations).toHaveBeenCalledTimes(1 + extra.length);
    expect(r.map((s) => s.id)).toEqual(['wu_IVIGO73']);
  });
});
