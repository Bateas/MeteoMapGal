/**
 * Tests for stationClustering — pure greedy spatial grouping by zoom.
 */
import { describe, it, expect } from 'vitest';
import {
  clusterStations,
  stationClusterRadiusKm,
  STATION_CLUSTER_DISABLE_ZOOM,
} from './stationClustering';
import type { NormalizedStation, NormalizedReading } from '../types/station';

function makeStation(id: string, lat: number, lon: number): NormalizedStation {
  return {
    id,
    source: 'meteogalicia',
    name: id,
    lat,
    lon,
    altitude: 50,
  };
}

function makeReading(stationId: string, temperature: number | null): NormalizedReading {
  return {
    stationId,
    timestamp: new Date(),
    windSpeed: null,
    windGust: null,
    windDirection: null,
    temperature,
    humidity: null,
    precipitation: null,
    solarRadiation: null,
    pressure: null,
    dewPoint: null,
  };
}

describe('stationClusterRadiusKm', () => {
  it('returns 0 at or above STATION_CLUSTER_DISABLE_ZOOM', () => {
    expect(stationClusterRadiusKm(STATION_CLUSTER_DISABLE_ZOOM)).toBe(0);
    expect(stationClusterRadiusKm(STATION_CLUSTER_DISABLE_ZOOM + 1)).toBe(0);
  });

  it('returns 4 km between zoom 8.5 and 9.5', () => {
    expect(stationClusterRadiusKm(8.5)).toBe(4);
    expect(stationClusterRadiusKm(9)).toBe(4);
  });

  it('returns 10 km between zoom 7.5 and 8.5 (ría-level)', () => {
    expect(stationClusterRadiusKm(7.5)).toBe(10);
    expect(stationClusterRadiusKm(8)).toBe(10);
  });

  it('returns 22 km below zoom 7.5 (sector blobs — merge hard, no pile-up)', () => {
    expect(stationClusterRadiusKm(7)).toBe(22);
    expect(stationClusterRadiusKm(6)).toBe(22);
  });
});

describe('clusterStations', () => {
  it('returns stations untouched at high zoom (no clustering)', () => {
    const stations = [
      makeStation('a', 42.3, -8.6),
      makeStation('b', 42.31, -8.61),
    ];
    const result = clusterStations(stations, new Map(), 11);
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.type === 'station')).toBe(true);
  });

  it('groups very close stations at low zoom', () => {
    const stations = [
      makeStation('a', 42.30, -8.60),
      makeStation('b', 42.305, -8.605), // ~0.7 km
      makeStation('c', 42.298, -8.602), // ~0.4 km
    ];
    const result = clusterStations(stations, new Map(), 9); // 3 km radius
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('cluster');
    if (result[0].type === 'cluster') {
      expect(result[0].count).toBe(3);
      expect(result[0].stationIds.sort()).toEqual(['a', 'b', 'c']);
    }
  });

  it('does not merge stations beyond the radius', () => {
    const stations = [
      makeStation('a', 42.30, -8.60),
      makeStation('b', 42.40, -8.70), // ~12 km
    ];
    const result = clusterStations(stations, new Map(), 9); // 3 km radius
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.type === 'station')).toBe(true);
  });

  it('aggregates avgTemp + spread from group readings', () => {
    const stations = [
      makeStation('a', 42.30, -8.60),
      makeStation('b', 42.302, -8.602),
      makeStation('c', 42.301, -8.598),
    ];
    const readings = new Map([
      ['a', makeReading('a', 18)],
      ['b', makeReading('b', 22)],
      ['c', makeReading('c', 20)],
    ]);
    const result = clusterStations(stations, readings, 9);
    expect(result).toHaveLength(1);
    if (result[0].type === 'cluster') {
      expect(result[0].avgTemp).toBe(20);
      expect(result[0].tempSpread).toBe(4); // 22 - 18
      expect(result[0].representativeTemp).toBe(20); // median
    }
  });

  it('handles missing temperatures gracefully', () => {
    const stations = [
      makeStation('a', 42.30, -8.60),
      makeStation('b', 42.302, -8.602),
    ];
    const readings = new Map([
      ['a', makeReading('a', null)],
      ['b', makeReading('b', null)],
    ]);
    const result = clusterStations(stations, readings, 9);
    if (result[0].type === 'cluster') {
      expect(result[0].avgTemp).toBeNull();
      expect(result[0].tempSpread).toBeNull();
      expect(result[0].representativeTemp).toBeNull();
    }
  });

  it('handles partial temperature data (some stations missing)', () => {
    const stations = [
      makeStation('a', 42.30, -8.60),
      makeStation('b', 42.302, -8.602),
      makeStation('c', 42.301, -8.598),
    ];
    const readings = new Map([
      ['a', makeReading('a', 18)],
      ['b', makeReading('b', null)],
      ['c', makeReading('c', 22)],
    ]);
    const result = clusterStations(stations, readings, 9);
    if (result[0].type === 'cluster') {
      expect(result[0].avgTemp).toBe(20); // (18+22)/2
      expect(result[0].count).toBe(3); // still 3 stations
    }
  });

  it('cluster id is deterministic regardless of input order', () => {
    const a = makeStation('alpha', 42.30, -8.60);
    const b = makeStation('beta', 42.302, -8.602);
    const result1 = clusterStations([a, b], new Map(), 9);
    const result2 = clusterStations([b, a], new Map(), 9);
    if (result1[0].type === 'cluster' && result2[0].type === 'cluster') {
      expect(result1[0].id).toBe(result2[0].id);
    } else {
      throw new Error('Expected both results to be clusters');
    }
  });

  it('handles empty list gracefully', () => {
    expect(clusterStations([], new Map(), 9)).toEqual([]);
  });

  it('handles single-station gracefully (returns as standalone)', () => {
    const result = clusterStations([makeStation('only', 42.3, -8.6)], new Map(), 9);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('station');
  });

  it('centroid is the average of grouped station coords', () => {
    const stations = [
      makeStation('a', 42.30, -8.60),
      makeStation('b', 42.32, -8.62),
    ];
    const result = clusterStations(stations, new Map(), 9);
    if (result[0].type === 'cluster') {
      expect(result[0].lat).toBeCloseTo(42.31, 2);
      expect(result[0].lon).toBeCloseTo(-8.61, 2);
    }
  });
});
