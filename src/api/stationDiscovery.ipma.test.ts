/**
 * IPMA and SkyX discovery read the list our server keeps (21-oct audit, findings 7 and 12).
 * Before, every visitor downloaded IPMA's GeoJSON of all of Portugal to find four stations,
 * and asked SkyX for its position, on every discovery.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NormalizedStation } from '../types/station';

vi.mock('./aemetClient', () => ({ fetchStationInventory: vi.fn(async () => []) }));
vi.mock('./aemetFromApi', () => ({ fetchListedAemetStations: vi.fn(async () => []) }));
vi.mock('./meteogaliciaClient', () => ({ fetchStationList: vi.fn(async () => []) }));
vi.mock('./meteoclimaticClient', () => ({ fetchMeteoclimaticFeed: vi.fn(async () => []) }));
vi.mock('./wundergroundClient', () => ({
  fetchWUNearbyStations: vi.fn(async () => []),
  fetchWUStationsFromApi: vi.fn(async () => []),
}));
vi.mock('./netatmoClient', () => ({
  fetchNetatmoStations: vi.fn(async () => []),
  netatmoStationsInRadius: vi.fn(() => []),
  NETATMO_DIRECT: false,
}));
vi.mock('./stationListClient', () => ({ fetchListedStations: vi.fn(async () => null) }));
vi.mock('./ipmaClient', () => ({ fetchIpmaNearby: vi.fn(async () => ({ stations: [], readings: [] })) }));
vi.mock('./skyxClient', () => ({ fetchSkyXData: vi.fn(async () => ({ station: null, reading: null })) }));

import { discoverStations, clearSectorStationsCache } from './stationDiscovery';
import { fetchListedStations } from './stationListClient';
import { fetchIpmaNearby } from './ipmaClient';
import { fetchSkyXData } from './skyxClient';

const rias = { center: [-8.68, 42.3] as [number, number], radiusKm: 40, meteoclimaticRegions: [], sectorId: 'rias' };
const embalse = { center: [-8.1, 42.29] as [number, number], radiusKm: 35, meteoclimaticRegions: [], sectorId: 'embalse' };

const ipma = (id: string, lat: number, lon: number): NormalizedStation =>
  ({ id: `ipma_${id}`, source: 'ipma', name: id, lat, lon, altitude: 0 });
const skyx: NormalizedStation = { id: 'skyx_SKY100', source: 'skyx', name: 'SkyX1', lat: 42.29, lon: -8.1, altitude: 0 };

describe('IPMA and SkyX discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSectorStationsCache();
  });

  it('takes both from our list, once for both sectors, and never asks IPMA or SkyX', async () => {
    vi.mocked(fetchListedStations).mockImplementation(async (source) => {
      if (source === 'ipma') return [ipma('valenca', 42.03, -8.63), ipma('braga', 41.55, -8.4)];
      if (source === 'skyx') return [skyx];
      return null;
    });
    const [e, r] = await Promise.all([discoverStations(embalse), discoverStations(rias)]);

    expect(fetchIpmaNearby).not.toHaveBeenCalled();
    expect(fetchSkyXData).not.toHaveBeenCalled();
    expect(vi.mocked(fetchListedStations).mock.calls.filter((c) => c[0] === 'ipma')).toHaveLength(1);
    expect(vi.mocked(fetchListedStations).mock.calls.filter((c) => c[0] === 'skyx')).toHaveLength(1);
    // Valença is 30 km from the Rías centre; Braga is outside both circles.
    expect(r.filter((s) => s.source === 'ipma').map((s) => s.id)).toEqual(['ipma_valenca']);
    expect(e.some((s) => s.id === 'ipma_braga')).toBe(false);
    // The reservoir unit belongs to the reservoir sector only.
    expect(e.some((s) => s.id === 'skyx_SKY100')).toBe(true);
    expect(r.some((s) => s.id === 'skyx_SKY100')).toBe(false);
  });

  it('without a usable list it falls back to IPMA and SkyX themselves', async () => {
    vi.mocked(fetchListedStations).mockResolvedValue(null);
    vi.mocked(fetchIpmaNearby).mockResolvedValue({ stations: [ipma('valenca', 42.03, -8.63)], readings: [] });
    vi.mocked(fetchSkyXData).mockResolvedValue({ station: skyx, reading: null });
    const e = await discoverStations(embalse);

    expect(fetchIpmaNearby).toHaveBeenCalledTimes(1);
    expect(fetchSkyXData).toHaveBeenCalledTimes(1);
    expect(e.some((s) => s.id === 'skyx_SKY100')).toBe(true);
  });
});
