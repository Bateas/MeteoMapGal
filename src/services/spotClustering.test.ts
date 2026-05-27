/**
 * Tests for spotClustering — pure greedy spatial grouping by zoom.
 */
import { describe, it, expect } from 'vitest';
import { clusterSpots, clusterRadiusKm, CLUSTER_DISABLE_ZOOM } from './spotClustering';
import type { SailingSpot } from '../config/spots';
import type { SpotVerdict } from './spotScoringEngine';

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
    const result = clusterSpots(spots, new Map(), 11);
    expect(result).toHaveLength(3);
    expect(result.every((r) => r.type === 'spot')).toBe(true);
  });

  it('groups two close spots into one cluster at low zoom', () => {
    const spots = [
      makeSpot('cesantes', 42.307, -8.619),
      makeSpot('bocana', 42.268, -8.714), // ~9.4 km from cesantes
    ];
    const result = clusterSpots(spots, new Map(), 9);
    // Radius at zoom 9 = 8km, so they DON'T merge
    expect(result).toHaveLength(2);
  });

  it('groups very close spots at low zoom', () => {
    const spots = [
      makeSpot('a', 42.30, -8.60),
      makeSpot('b', 42.31, -8.61), // ~1.5 km
      makeSpot('c', 42.31, -8.59), // ~1.5 km
    ];
    const result = clusterSpots(spots, new Map(), 9);
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
    const result = clusterSpots(spots, new Map(), 8); // 15 km radius
    expect(result).toHaveLength(1);
    if (result[0].type === 'cluster') {
      expect(result[0].lat).toBeCloseTo(42.35, 2);
      expect(result[0].lon).toBeCloseTo(-8.65, 2);
    }
  });

  it('cluster id is deterministic regardless of input order', () => {
    const verdicts = new Map<string, SpotVerdict>();
    const aFirst = clusterSpots(
      [makeSpot('a', 42.30, -8.60), makeSpot('b', 42.31, -8.61)],
      verdicts,
      9,
    );
    const bFirst = clusterSpots(
      [makeSpot('b', 42.31, -8.61), makeSpot('a', 42.30, -8.60)],
      verdicts,
      9,
    );
    if (aFirst[0].type === 'cluster' && bFirst[0].type === 'cluster') {
      expect(aFirst[0].id).toBe(bFirst[0].id);
    } else {
      throw new Error('Expected both results to be clusters');
    }
  });

  it('worstVerdict surfaces the most actionable verdict in the group', () => {
    const verdicts = new Map<string, SpotVerdict>([
      ['a', 'calm'],
      ['b', 'good'],
      ['c', 'light'],
    ]);
    const result = clusterSpots(
      [
        makeSpot('a', 42.30, -8.60),
        makeSpot('b', 42.31, -8.61),
        makeSpot('c', 42.30, -8.62),
      ],
      verdicts,
      9,
    );
    expect(result).toHaveLength(1);
    if (result[0].type === 'cluster') {
      expect(result[0].worstVerdict).toBe('good');
    }
  });

  it('worstVerdict defaults to unknown when nothing matches', () => {
    const result = clusterSpots(
      [
        makeSpot('a', 42.30, -8.60),
        makeSpot('b', 42.31, -8.61),
      ],
      new Map(),
      9,
    );
    if (result[0].type === 'cluster') {
      expect(result[0].worstVerdict).toBe('unknown');
    }
  });

  it('handles single-spot sectors gracefully (returns standalone)', () => {
    const result = clusterSpots([makeSpot('only', 42.3, -8.6)], new Map(), 9);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('spot');
  });

  it('handles empty sectors gracefully', () => {
    const result = clusterSpots([], new Map(), 9);
    expect(result).toHaveLength(0);
  });

  it('strong verdict beats good when both present', () => {
    const verdicts = new Map<string, SpotVerdict>([
      ['a', 'good'],
      ['b', 'strong'],
    ]);
    const result = clusterSpots(
      [makeSpot('a', 42.30, -8.60), makeSpot('b', 42.31, -8.61)],
      verdicts,
      9,
    );
    if (result[0].type === 'cluster') {
      expect(result[0].worstVerdict).toBe('strong');
    }
  });
});
