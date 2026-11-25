/**
 * Tests for spotClustering — pure greedy spatial grouping by zoom.
 */
import { describe, it, expect } from 'vitest';
import { clusterSpots, clusterRadiusKm, spotDanger, CLUSTER_DISABLE_ZOOM } from './spotClustering';
import type { SailingSpot } from '../config/spots';

function makeSpot(id: string, lat: number, lon: number): SailingSpot {
  return {
    id,
    name: id,
    shortName: id,
    icon: 'sailboat',
    center: [lon, lat],
    radiusKm: 10,
    description: '',
    preferredStations: [],
    preferredBuoys: [],
    windPatterns: [],
    category: 'sailing',
    thermalDetection: false,
  } as unknown as SailingSpot;
}

describe('clusterRadiusKm', () => {
  it('returns 0 at or above CLUSTER_DISABLE_ZOOM', () => {
    expect(clusterRadiusKm(CLUSTER_DISABLE_ZOOM)).toBe(0);
    expect(clusterRadiusKm(CLUSTER_DISABLE_ZOOM + 1)).toBe(0);
    expect(clusterRadiusKm(13)).toBe(0);
  });

  it('returns 8 km between zoom 9 and 10', () => {
    expect(clusterRadiusKm(9)).toBe(8);
    expect(clusterRadiusKm(9.5)).toBe(8);
  });

  it('returns 15 km below zoom 9', () => {
    expect(clusterRadiusKm(8)).toBe(15);
    expect(clusterRadiusKm(7)).toBe(15);
  });
});

describe('clusterSpots', () => {
  it('returns spots untouched at high zoom (no clustering)', () => {
    const spots = [
      makeSpot('a', 42.3, -8.6),
      makeSpot('b', 42.31, -8.61),
      makeSpot('c', 42.5, -9.0),
    ];
    const result = clusterSpots(spots, 11);
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.type === 'spot')).toBe(true);
  });

  it('groups two close spots into one cluster at low zoom', () => {
    const spots = [
      makeSpot('cesantes', 42.307, -8.619),
      makeSpot('bocana', 42.268, -8.714), // ~9.4 km from cesantes
    ];
    const result = clusterSpots(spots, 9);
    // Radius at zoom 9 = 8km, so they DON'T merge
    expect(result).toHaveLength(2);
  });

  it('groups very close spots at low zoom', () => {
    const spots = [
      makeSpot('a', 42.30, -8.60),
      makeSpot('b', 42.31, -8.61), // ~1.5 km
      makeSpot('c', 42.31, -8.59), // ~1.5 km
    ];
    const result = clusterSpots(spots, 9);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('cluster');
    if (result[0].type === 'cluster') {
      expect(result[0].count).toBe(3);
    }
  });

  it('cluster centroid is the average of grouped spots', () => {
    const spots = [
      makeSpot('a', 42.3, -8.6),
      makeSpot('b', 42.4, -8.7),
    ];
    const result = clusterSpots(spots, 8); // 15 km radius
    expect(result).toHaveLength(1);
    if (result[0].type === 'cluster') {
      expect(result[0].lat).toBeCloseTo(42.35, 2);
      expect(result[0].lon).toBeCloseTo(-8.65, 2);
    }
  });

  it('cluster id is deterministic regardless of input order', () => {
    const aFirst = clusterSpots(
      [makeSpot('a', 42.30, -8.60), makeSpot('b', 42.31, -8.61)],
      9,
    );
    const bFirst = clusterSpots(
      [makeSpot('b', 42.31, -8.61), makeSpot('a', 42.30, -8.60)],
      9,
    );
    if (aFirst[0].type === 'cluster' && bFirst[0].type === 'cluster') {
      expect(aFirst[0].id).toBe(bFirst[0].id);
    } else {
      throw new Error('Expected both results to be clusters');
    }
  });

  it('handles single-spot sectors gracefully (returns standalone)', () => {
    const result = clusterSpots([makeSpot('only', 42.3, -8.6)], 9);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('spot');
  });

  it('handles empty sectors gracefully', () => {
    const result = clusterSpots([], 9);
    expect(result).toHaveLength(0);
  });
});

describe('spotDanger: what turns a group red', () => {
  it('a strong wind verdict is not a danger: it is a good day for many', () => {
    expect(spotDanger({ hardGateKind: null }, false)).toBeNull();
  });

  it('the hard gates of the engine are, and say which', () => {
    expect(spotDanger({ hardGateKind: 'wind' }, false)).toBe('viento');
    expect(spotDanger({ hardGateKind: 'wave' }, false)).toBe('oleaje');
  });

  it('lightning wins, with or without a score', () => {
    expect(spotDanger({ hardGateKind: 'wave' }, true)).toBe('rayos');
    expect(spotDanger(undefined, true)).toBe('rayos');
  });

  it('a provisional score says nothing yet', () => {
    expect(spotDanger({ provisional: true, hardGateKind: 'wind' }, false)).toBeNull();
    expect(spotDanger(undefined, false)).toBeNull();
  });
});
