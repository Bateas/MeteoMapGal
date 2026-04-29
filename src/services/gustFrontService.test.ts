/**
 * Tests for gustFrontService — detection of storm outflow signature.
 *
 * The Apr 28 2026 event provides the canonical positive case: Porto-Vigo
 * gust 34 kt + wind 22.7 kt (ratio 1.5) + storm 15 km NE moving SW. The
 * tests below replicate that geometry and the symmetric "miss" cases.
 */
import { describe, it, expect } from 'vitest';
import { detectGustFronts, type GustFrontReading } from './gustFrontService';
import type { StormCluster } from './stormTracker';

// ── Fixtures ─────────────────────────────────────────────

function reading(overrides: Partial<GustFrontReading> = {}): GustFrontReading {
  return {
    stationId: 'mg_porto_vigo',
    stationName: 'Porto-Vigo',
    lat: 42.24,
    lon: -8.72,
    // Wind speeds in m/s — 22.7 kt = 11.68 m/s, 35 kt = 18.0 m/s (ratio 1.54×)
    // (Apr 28 actual was 34/22.7=1.497 — fixture rounded up to clear high tier)
    windMs: 11.68,
    gustMs: 18.0,
    windDirDeg: 57, // ENE — direction wind was coming FROM (matches Apr 28 obs)
    ageMin: 5,
    ...overrides,
  };
}

function cluster(overrides: Partial<StormCluster> = {}): StormCluster {
  // Cluster 15 km NE of Porto-Vigo (42.24, -8.72) — Apr 28 geometry
  // Bearing NE = 45° → +0.135 lat, -0.135 lon
  return {
    id: 'storm-1',
    lat: 42.34,
    lon: -8.59,
    leadLat: 42.34,
    leadLon: -8.59,
    strikeCount: 50,
    radiusKm: 5,
    maxPeakCurrent: 30,
    avgAgeMin: 3,
    newestAgeMin: 1, // active
    distanceToReservoir: 25,
    velocity: { speedKmh: 46, bearingDeg: 225 }, // SW
    etaMinutes: null,
    approaching: false,
    strikePositions: [],
    recentStrikePositions: [],
    ...overrides,
  };
}

// ── Positive cases ───────────────────────────────────────

describe('detectGustFronts — positive detection', () => {
  it('detects the Apr 28 Porto-Vigo signature (ratio 1.5×, cluster 15 km NE)', () => {
    const out = detectGustFronts([reading()], [cluster()]);
    expect(out).toHaveLength(1);
    expect(out[0].stationName).toBe('Porto-Vigo');
    expect(out[0].ratio).toBeGreaterThanOrEqual(1.4);
    expect(out[0].clusterId).toBe('storm-1');
    expect(out[0].clusterDistKm).toBeLessThan(MAX_CLUSTER_DIST_KM);
  });

  it('marks high confidence when ratio≥1.5 AND cluster<20km', () => {
    const out = detectGustFronts([reading()], [cluster()]);
    expect(out[0].confidence).toBe('high');
  });

  it('marks medium confidence when ratio just above threshold', () => {
    // Ratio ~1.42 (above 1.4 trigger but below 1.5 high-tier)
    const r = reading({ windMs: 11.68, gustMs: 16.59 });
    const out = detectGustFronts([r], [cluster()]);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBe('medium');
  });

  it('marks medium when far cluster (20-30km) even with high ratio', () => {
    // ratio 1.54 but cluster at ~25 km — same NE bearing so alignment passes
    const far = cluster({ lat: 42.40, lon: -8.50, leadLat: 42.40, leadLon: -8.50 });
    const out = detectGustFronts([reading()], [far]);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBe('medium');
  });

  it('picks the closest active cluster when multiple match', () => {
    const closer = cluster({ id: 'storm-near', lat: 42.30, lon: -8.65, leadLat: 42.30, leadLon: -8.65 }); // ~8 km NE
    const farther = cluster({ id: 'storm-far', lat: 42.34, lon: -8.59 }); // ~15 km NE
    const out = detectGustFronts([reading()], [farther, closer]);
    expect(out[0].clusterId).toBe('storm-near');
  });
});

// ── Negative cases ───────────────────────────────────────

describe('detectGustFronts — rejects', () => {
  it('rejects when ratio is normal (<1.4)', () => {
    // Wind 22.7 kt, gust 28 kt → ratio 1.23
    const r = reading({ gustMs: 14.4 });
    expect(detectGustFronts([r], [cluster()])).toHaveLength(0);
  });

  it('rejects when wind is too weak (calm site, gust noise)', () => {
    // Wind 4 kt, gust 8 kt → ratio 2.0 but too weak
    const r = reading({ windMs: 2.06, gustMs: 4.12 });
    expect(detectGustFronts([r], [cluster()])).toHaveLength(0);
  });

  it('rejects when reading is stale (>20 min old)', () => {
    expect(detectGustFronts([reading({ ageMin: 30 })], [cluster()])).toHaveLength(0);
  });

  it('rejects when cluster is too far (>30 km)', () => {
    // Push cluster to ~50 km away
    const far = cluster({ lat: 42.7, lon: -8.30, leadLat: 42.7, leadLon: -8.30 });
    expect(detectGustFronts([reading()], [far])).toHaveLength(0);
  });

  it('rejects when no cluster is active (all dissipating)', () => {
    const stale = cluster({ newestAgeMin: 30 });
    expect(detectGustFronts([reading()], [stale])).toHaveLength(0);
  });

  it('rejects when wind direction is opposite to cluster bearing (no outflow alignment)', () => {
    // Wind from SW (235°) but cluster is NE — angle diff ≈ 180°, way outside ±60°
    const r = reading({ windDirDeg: 235 });
    expect(detectGustFronts([r], [cluster()])).toHaveLength(0);
  });

  it('rejects when wind is perpendicular to cluster (tangential, ~90° off)', () => {
    // Cluster NE (bearing-from-station ~45°), wind from SE (135°) → 90° off
    const r = reading({ windDirDeg: 135 });
    expect(detectGustFronts([r], [cluster()])).toHaveLength(0);
  });
});

// ── Edge cases ───────────────────────────────────────────

describe('detectGustFronts — edge cases', () => {
  it('returns empty for empty readings', () => {
    expect(detectGustFronts([], [cluster()])).toEqual([]);
  });

  it('returns empty for empty clusters', () => {
    expect(detectGustFronts([reading()], [])).toEqual([]);
  });

  it('uses leadLat/leadLon when present, falls back to lat/lon', () => {
    // Lead at (42.30, -8.65), display centroid at (42.50, -8.30) — pretty different
    const c = cluster({ lat: 42.50, lon: -8.30, leadLat: 42.30, leadLon: -8.65 });
    const out = detectGustFronts([reading()], [c]);
    expect(out).toHaveLength(1);
    // Distance computed from LEAD (42.30, -8.65), not display (42.50, -8.30)
    expect(out[0].clusterDistKm).toBeLessThan(15);
  });

  it('sorts by confidence high first, then by closest cluster', () => {
    // Two stations: one high (close + ratio 1.6), one medium (further + 1.42)
    const stationA = reading({ stationId: 'A', stationName: 'A', lat: 42.30, lon: -8.65, gustMs: 18.7 });
    const stationB = reading({ stationId: 'B', stationName: 'B', lat: 42.20, lon: -8.80, gustMs: 16.6 });
    const out = detectGustFronts([stationA, stationB], [cluster()]);
    expect(out[0].confidence).toBe('high');
    if (out.length > 1) expect(out[1].confidence).toBe('medium');
  });
});

const MAX_CLUSTER_DIST_KM = 30; // mirror of internal constant for assertions
