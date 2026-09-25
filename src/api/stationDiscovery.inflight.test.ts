/**
 * A cold load ran discovery three times at once (default sector, then the
 * linked sector twice) and every run fetched everything again. Runs for the
 * same sector must be joined, and the sector-independent fetches shared.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./aemetClient', () => ({ fetchStationInventory: vi.fn(async () => []) }));
vi.mock('./meteogaliciaClient', () => ({ fetchStationList: vi.fn(async () => []) }));
vi.mock('./meteoclimaticClient', () => ({ fetchMeteoclimaticFeed: vi.fn(async () => []) }));
vi.mock('./wundergroundClient', () => ({
  fetchWUNearbyStations: vi.fn(async () => []),
  // Our own list unavailable, so these runs take the direct WU path this test counts.
  fetchWUStationsFromApi: vi.fn(async () => null),
}));
vi.mock('./netatmoClient', () => ({ fetchNetatmoStations: vi.fn(async () => []) }));
vi.mock('./ipmaClient', () => ({ fetchIpmaNearby: vi.fn(async () => ({ stations: [], readings: [] })) }));
vi.mock('./skyxClient', () => ({ fetchSkyXData: vi.fn(async () => ({ station: null, reading: null })) }));

import { discoverStations, clearSectorStationsCache } from './stationDiscovery';
import { fetchStationInventory } from './aemetClient';
import { fetchStationList } from './meteogaliciaClient';
import { fetchWUNearbyStations } from './wundergroundClient';

const rias = { center: [-8.68, 42.3] as [number, number], radiusKm: 40, meteoclimaticRegions: [], sectorId: 'rias' };
const embalse = { center: [-8.1, 42.29] as [number, number], radiusKm: 35, meteoclimaticRegions: [], sectorId: 'embalse' };

describe('discoverStations — one run of each at a time', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSectorStationsCache();
  });

  it('joins runs for the same sector and shares the sector-independent fetches', async () => {
    await Promise.all([discoverStations(embalse), discoverStations(rias), discoverStations(rias)]);

    // Before: 3 each. The inventory and the MG list do not depend on the sector.
    expect(fetchStationInventory).toHaveBeenCalledTimes(1);
    expect(fetchStationList).toHaveBeenCalledTimes(1);
    // One lookup per sector, not one per run.
    expect(fetchWUNearbyStations).toHaveBeenCalledTimes(2);
  });

  it('fetches again once the previous run has finished', async () => {
    await discoverStations(rias);
    clearSectorStationsCache();
    await discoverStations(rias);
    expect(fetchStationInventory).toHaveBeenCalledTimes(2);
  });
});
