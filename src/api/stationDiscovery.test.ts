import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getCachedSectorStations, discoverStations, clearSectorStationsCache } from './stationDiscovery';
import type { NormalizedStation } from '../types/station';

describe('stationDiscovery caching', () => {
  const dummyStation: NormalizedStation = {
    id: 'mg_10144',
    name: 'Castrelo de Miño',
    source: 'meteogalicia',
    lat: 42.29,
    lon: -8.1,
    altitude: 95,
  };

  beforeEach(() => {
    clearSectorStationsCache();
  });

  afterEach(() => {
    clearSectorStationsCache();
  });

  it('returns null when no station cache exists', () => {
    expect(getCachedSectorStations('embalse_test')).toBeNull();
  });

  it('retrieves cached stations from sessionStorage when fresh', () => {
    const payload = {
      stations: [dummyStation],
      ts: Date.now(),
    };
    sessionStorage.setItem('meteo_discovered_stations_embalse_test', JSON.stringify(payload));

    const cached = getCachedSectorStations('embalse_test');
    expect(cached).toHaveLength(1);
    expect(cached?.[0].id).toBe('mg_10144');
    expect(cached?.[0].name).toBe('Castrelo de Miño');
  });

  it('ignores expired cache in sessionStorage (>60min)', () => {
    const expiredPayload = {
      stations: [dummyStation],
      ts: Date.now() - 61 * 60 * 1000,
    };
    sessionStorage.setItem('meteo_discovered_stations_embalse_test', JSON.stringify(expiredPayload));

    expect(getCachedSectorStations('embalse_test')).toBeNull();
  });

  it('discoverStations uses cached sector stations without making network requests', async () => {
    const payload = {
      stations: [dummyStation],
      ts: Date.now(),
    };
    sessionStorage.setItem('meteo_discovered_stations_embalse_test', JSON.stringify(payload));

    const stations = await discoverStations({
      center: [-8.1, 42.29],
      radiusKm: 35,
      meteoclimaticRegions: ['ESGAL32'],
      sectorId: 'embalse_test',
    });

    expect(stations).toHaveLength(1);
    expect(stations[0].id).toBe('mg_10144');
  });
});
