/**
 * Netatmo discovery reads the list our server keeps. Before, every new visitor cost a token
 * request and a POST to Netatmo that no cache could share; in production the browser now never
 * asks Netatmo itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NormalizedStation } from '../types/station';

const direct = vi.hoisted(() => ({ value: false }));

vi.mock('./aemetClient', () => ({ fetchStationInventory: vi.fn(async () => []) }));
vi.mock('./meteogaliciaClient', () => ({ fetchStationList: vi.fn(async () => []) }));
vi.mock('./meteoclimaticClient', () => ({ fetchMeteoclimaticFeed: vi.fn(async () => []) }));
vi.mock('./wundergroundClient', () => ({
  fetchWUNearbyStations: vi.fn(async () => []),
  fetchWUStationsFromApi: vi.fn(async () => []),
}));
vi.mock('./netatmoClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./netatmoClient')>()),
  fetchNetatmoStations: vi.fn(async () => []),
  get NETATMO_DIRECT() { return direct.value; },
}));
vi.mock('./stationListClient', () => ({ fetchListedStations: vi.fn(async () => null) }));
vi.mock('./ipmaClient', () => ({ fetchIpmaNearby: vi.fn(async () => ({ stations: [], readings: [] })) }));
vi.mock('./skyxClient', () => ({ fetchSkyXData: vi.fn(async () => ({ station: null, reading: null })) }));

import { discoverStations, clearSectorStationsCache } from './stationDiscovery';
import { fetchNetatmoStations, netatmoStationsInRadius } from './netatmoClient';
import { fetchListedStations } from './stationListClient';

const rias = { center: [-8.68, 42.3] as [number, number], radiusKm: 40, meteoclimaticRegions: [], sectorId: 'rias' };
const embalse = { center: [-8.1, 42.29] as [number, number], radiusKm: 35, meteoclimaticRegions: [], sectorId: 'embalse' };

const nt = (id: string, lat: number, lon: number, tempOnly?: boolean): NormalizedStation =>
  ({ id: `nt_${id}`, source: 'netatmo', name: id, lat, lon, altitude: 0, tempOnly });

describe('netatmoStationsInRadius', () => {
  it('keeps the stations inside the circle, with their wind flag', () => {
    const got = netatmoStationsInRadius(
      [nt('gondom', 42.087, -8.801, true), nt('vigo01', 42.23, -8.72, false), nt('lugo01', 43.01, -7.55, false)],
      rias.center, rias.radiusKm,
    );
    expect(got?.map((s) => [s.id, s.tempOnly])).toEqual([['nt_gondom', true], ['nt_vigo01', false]]);
  });

  it('gives no answer without a list, or when the server does not say which have wind', () => {
    expect(netatmoStationsInRadius(null, rias.center, rias.radiusKm)).toBeNull();
    expect(netatmoStationsInRadius([nt('vigo01', 42.23, -8.72)], rias.center, rias.radiusKm)).toBeNull();
  });
});

describe('Netatmo discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSectorStationsCache();
    direct.value = false;
  });

  it('takes the stations from our list, once for both sectors, and never asks Netatmo', async () => {
    vi.mocked(fetchListedStations).mockImplementation(async (source) =>
      source === 'netatmo'
        ? [nt('cartel', 42.25, -8.06, false), nt('vigo01', 42.23, -8.72, true)]
        : null);
    const [e, r] = await Promise.all([discoverStations(embalse), discoverStations(rias)]);

    expect(fetchNetatmoStations).not.toHaveBeenCalled();
    expect(vi.mocked(fetchListedStations).mock.calls.filter((c) => c[0] === 'netatmo')).toHaveLength(1);
    expect(e.filter((s) => s.source === 'netatmo').map((s) => s.id)).toEqual(['nt_cartel']);
    const vigo = r.find((s) => s.id === 'nt_vigo01');
    expect(vigo?.tempOnly).toBe(true); // stays off the wind map
  });

  it('in production, without a usable list, goes without Netatmo rather than asking it', async () => {
    vi.mocked(fetchListedStations).mockResolvedValue(null);
    const r = await discoverStations(rias);

    expect(fetchNetatmoStations).not.toHaveBeenCalled();
    expect(r.filter((s) => s.source === 'netatmo')).toEqual([]);
  });

  it('in development, without a usable list, asks Netatmo as before', async () => {
    direct.value = true;
    vi.mocked(fetchListedStations).mockResolvedValue(null);
    vi.mocked(fetchNetatmoStations).mockResolvedValue([nt('vigo01', 42.23, -8.72, false)]);
    const r = await discoverStations(rias);

    expect(fetchNetatmoStations).toHaveBeenCalledTimes(1);
    expect(r.some((s) => s.id === 'nt_vigo01')).toBe(true);
  });
});
