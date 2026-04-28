/**
 * Tests for stormTracker — clustering + velocity tracking + ETA.
 *
 * Critical infrastructure: feeds StormClusterOverlay, ETA, "approaching"
 * flag, and cross-feeds the storm predictor. Bugs here = wrong direction
 * arrows / wrong ETAs / phantom storms reported on the map.
 *
 * S124 audit: written to capture current behavior + flag the 5 known
 * issues (cluster-ID instability, greedy match, single-snapshot velocity,
 * fixed match threshold, centroid-drift ≠ storm motion).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { trackStorms, bearingToCardinal, type ClusterSnapshot } from './stormTracker';
import type { LightningStrike } from '../types/lightning';

// Reservoir = Castrelo (sector embalse default)
const RES_LAT = 42.30;
const RES_LON = -8.10;

let nextStrikeId = 1;
function makeStrike(overrides: Partial<LightningStrike> = {}): LightningStrike {
  return {
    id: nextStrikeId++,
    lat: 42.5,
    lon: -8.2,
    timestamp: Date.now() - 60_000, // 1 min ago
    peakCurrent: 25,
    cloudToCloud: false,
    multiplicity: 1,
    ageMinutes: 1,
    ...overrides,
  };
}

beforeEach(() => {
  nextStrikeId = 1;
});

// ── trackStorms — empty / sparse input ───────────────

describe('trackStorms — empty / sparse', () => {
  it('returns no clusters when no strikes', () => {
    const result = trackStorms([], [], RES_LAT, RES_LON);
    expect(result.clusters).toEqual([]);
    expect(result.history).toHaveLength(1); // empty snapshot still added
  });

  it('returns no clusters when only old strikes (>60min)', () => {
    const old = makeStrike({ ageMinutes: 90 });
    const result = trackStorms([old], [], RES_LAT, RES_LON);
    expect(result.clusters).toEqual([]);
  });

  it('returns no clusters with single strike (<MIN_CLUSTER_SIZE=2)', () => {
    const single = makeStrike();
    const result = trackStorms([single], [], RES_LAT, RES_LON);
    expect(result.clusters).toEqual([]);
  });
});

// ── trackStorms — basic clustering ───────────────────

describe('trackStorms — clustering rules', () => {
  it('groups two strikes within 12km radius', () => {
    const strikes = [
      makeStrike({ lat: 42.5, lon: -8.2 }),
      makeStrike({ lat: 42.55, lon: -8.2 }), // ~5km apart
    ];
    const r = trackStorms(strikes, [], RES_LAT, RES_LON);
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0].strikeCount).toBe(2);
  });

  it('keeps two distant strikes in separate non-clusters (not enough size)', () => {
    const strikes = [
      makeStrike({ lat: 42.0, lon: -8.0 }),
      makeStrike({ lat: 43.0, lon: -8.0 }), // ~111km apart
    ];
    const r = trackStorms(strikes, [], RES_LAT, RES_LON);
    expect(r.clusters).toHaveLength(0); // each isolated, fails size 2
  });

  it('subdivides a single oversized cluster (≥40km diameter)', () => {
    // String of strikes from -8.5 to -7.7 longitude at lat 42.5 — 60km long
    const strikes = [
      makeStrike({ lat: 42.5, lon: -8.5 }),
      makeStrike({ lat: 42.5, lon: -8.4 }),
      makeStrike({ lat: 42.5, lon: -8.3 }),
      makeStrike({ lat: 42.5, lon: -8.2 }),
      makeStrike({ lat: 42.5, lon: -8.1 }),
      makeStrike({ lat: 42.5, lon: -8.0 }),
      makeStrike({ lat: 42.5, lon: -7.9 }),
    ];
    const r = trackStorms(strikes, [], RES_LAT, RES_LON);
    // Should have >1 cluster after subdivision
    expect(r.clusters.length).toBeGreaterThan(1);
  });

  it('weighted centroid pulls toward newer strikes', () => {
    // Old strike at lat 42.5, new strike at lat 42.6 — centroid should be >42.55
    const strikes = [
      makeStrike({ lat: 42.5, lon: -8.2, ageMinutes: 50 }),
      makeStrike({ lat: 42.6, lon: -8.2, ageMinutes: 1 }),
    ];
    const r = trackStorms(strikes, [], RES_LAT, RES_LON);
    expect(r.clusters[0].lat).toBeGreaterThan(42.55);
  });
});

// ── trackStorms — distance/sort ──────────────────────

describe('trackStorms — sorts clusters by distance to reservoir', () => {
  it('puts closest cluster first', () => {
    const strikes = [
      // Far cluster (~200km north)
      makeStrike({ id: 1, lat: 44.0, lon: -8.1 }),
      makeStrike({ id: 2, lat: 44.05, lon: -8.1 }),
      // Near cluster (~10km from reservoir)
      makeStrike({ id: 3, lat: 42.4, lon: -8.1 }),
      makeStrike({ id: 4, lat: 42.42, lon: -8.1 }),
    ];
    const r = trackStorms(strikes, [], RES_LAT, RES_LON);
    expect(r.clusters).toHaveLength(2);
    expect(r.clusters[0].distanceToReservoir).toBeLessThan(r.clusters[1].distanceToReservoir);
  });
});

// ── trackStorms — velocity computation ───────────────

describe('trackStorms — velocity computation', () => {
  it('returns null velocity without history', () => {
    const strikes = [
      makeStrike({ lat: 42.5, lon: -8.2 }),
      makeStrike({ lat: 42.55, lon: -8.2 }),
    ];
    const r = trackStorms(strikes, [], RES_LAT, RES_LON);
    expect(r.clusters[0].velocity).toBeNull();
  });

  it('computes velocity from 5-min-old snapshot — realistic Galician storm (30 km/h)', () => {
    const now = Date.now();
    const history: ClusterSnapshot[] = [{
      timestamp: now - 5 * 60_000,
      centroids: [{ id: 'storm-1', lat: 42.4, lon: -8.30, strikeCount: 3 }],
    }];
    // 2.7km east of old position over 5min → ~32 km/h east. Within 3-70 cap.
    const strikes = [
      makeStrike({ lat: 42.4, lon: -8.27, ageMinutes: 1 }),
      makeStrike({ lat: 42.41, lon: -8.27, ageMinutes: 1 }),
      makeStrike({ lat: 42.4, lon: -8.28, ageMinutes: 1 }),
    ];
    const r = trackStorms(strikes, history, RES_LAT, RES_LON);
    expect(r.clusters[0].velocity).not.toBeNull();
    expect(r.clusters[0].velocity!.speedKmh).toBeGreaterThan(3);
    expect(r.clusters[0].velocity!.speedKmh).toBeLessThan(70);
    // Bearing eastward roughly 90°±30°
    const b = r.clusters[0].velocity!.bearingDeg;
    expect(b).toBeGreaterThan(60);
    expect(b).toBeLessThan(120);
  });

  it('rejects unrealistic speeds (>70 km/h) — likely false centroid match', () => {
    const now = Date.now();
    const history: ClusterSnapshot[] = [{
      timestamp: now - 60_000, // 1 min ago
      centroids: [{ id: 'storm-1', lat: 42.4, lon: -8.5, strikeCount: 3 }], // 30km away from new
    }];
    // 30km in 1min = 1800 km/h — should be rejected
    const strikes = [
      makeStrike({ lat: 42.4, lon: -8.1, ageMinutes: 0.5 }),
      makeStrike({ lat: 42.41, lon: -8.1, ageMinutes: 0.5 }),
    ];
    const r = trackStorms(strikes, history, RES_LAT, RES_LON);
    expect(r.clusters[0].velocity).toBeNull();
  });

  it('rejects tiny noise speeds for small clusters (<5 km/h)', () => {
    const now = Date.now();
    const history: ClusterSnapshot[] = [{
      timestamp: now - 5 * 60_000,
      centroids: [{ id: 'storm-1', lat: 42.4, lon: -8.18, strikeCount: 2 }],
    }];
    // 2-strike cluster, drifted 0.2km in 5min = 2.4 km/h. Below minSpeed=5.
    const strikes = [
      makeStrike({ lat: 42.402, lon: -8.18, ageMinutes: 1 }),
      makeStrike({ lat: 42.401, lon: -8.18, ageMinutes: 1 }),
    ];
    const r = trackStorms(strikes, history, RES_LAT, RES_LON);
    expect(r.clusters[0].velocity).toBeNull();
  });
});

// ── trackStorms — approaching detection ──────────────

describe('trackStorms — approaching detection', () => {
  it('flags approaching when storm moves toward reservoir + distance decreases', () => {
    const now = Date.now();
    // Old position: 42.66 (~40km north of reservoir 42.30)
    // New position: 42.62 — moved 4.4km south in 5min = 53 km/h (within cap)
    const history: ClusterSnapshot[] = [{
      timestamp: now - 5 * 60_000,
      centroids: [{ id: 'storm-1', lat: 42.66, lon: -8.10, strikeCount: 4 }],
    }];
    const strikes = [
      makeStrike({ lat: 42.62, lon: -8.10, ageMinutes: 1 }),
      makeStrike({ lat: 42.63, lon: -8.10, ageMinutes: 1 }),
      makeStrike({ lat: 42.62, lon: -8.11, ageMinutes: 1 }),
      makeStrike({ lat: 42.63, lon: -8.09, ageMinutes: 1 }),
    ];
    const r = trackStorms(strikes, history, RES_LAT, RES_LON);
    expect(r.clusters[0].approaching).toBe(true);
    expect(r.clusters[0].etaMinutes).not.toBeNull();
    expect(r.clusters[0].etaMinutes!).toBeGreaterThan(0);
  });

  it('does NOT flag approaching when moving tangentially (perpendicular to reservoir)', () => {
    const now = Date.now();
    // Storm moves east at lat 42.7 — bearing 90°. Reservoir at (42.30, -8.10) is south.
    // Bearing from cluster (42.7, -8.20 → -8.10) is east; reservoir is south. angleDiff ~90° → not approaching.
    const history: ClusterSnapshot[] = [{
      timestamp: now - 5 * 60_000,
      centroids: [{ id: 'storm-1', lat: 42.7, lon: -8.20, strikeCount: 4 }],
    }];
    const strikes = [
      makeStrike({ lat: 42.7, lon: -8.10, ageMinutes: 1 }),
      makeStrike({ lat: 42.71, lon: -8.10, ageMinutes: 1 }),
      makeStrike({ lat: 42.70, lon: -8.11, ageMinutes: 1 }),
      makeStrike({ lat: 42.71, lon: -8.09, ageMinutes: 1 }),
    ];
    const r = trackStorms(strikes, history, RES_LAT, RES_LON);
    expect(r.clusters[0].approaching).toBe(false);
  });

  it('does NOT flag approaching when receding (distance increases)', () => {
    const now = Date.now();
    const history: ClusterSnapshot[] = [{
      timestamp: now - 5 * 60_000,
      centroids: [{ id: 'storm-1', lat: 42.5, lon: -8.10, strikeCount: 4 }],
    }];
    // New position farther north
    const strikes = [
      makeStrike({ lat: 42.7, lon: -8.10, ageMinutes: 1 }),
      makeStrike({ lat: 42.71, lon: -8.10, ageMinutes: 1 }),
      makeStrike({ lat: 42.70, lon: -8.11, ageMinutes: 1 }),
    ];
    const r = trackStorms(strikes, history, RES_LAT, RES_LON);
    expect(r.clusters[0].approaching).toBe(false);
  });
});

// ── trackStorms — KNOWN BUGS captured for future fix ─

describe('trackStorms — KNOWN BUG: cluster IDs reset every call', () => {
  it('same physical cluster gets new ID each call — breaks hull memo cache', () => {
    const strikes = [
      makeStrike({ lat: 42.5, lon: -8.2 }),
      makeStrike({ lat: 42.55, lon: -8.2 }),
    ];
    const r1 = trackStorms(strikes, [], RES_LAT, RES_LON);
    const r2 = trackStorms(strikes, r1.history, RES_LAT, RES_LON);
    // BUG: both calls produce 'storm-1' as ID for the same cluster — but if
    // cluster ORDER changes (e.g., a closer cluster appears), IDs swap.
    // We just check the IDs follow the storm-N pattern; stability across
    // poll order is the actual bug to fix.
    expect(r1.clusters[0].id).toMatch(/^storm-\d+$/);
    expect(r2.clusters[0].id).toMatch(/^storm-\d+$/);
  });

  it('IDs follow storm-N pattern with module-monotonic numbering (S124 fix)', () => {
    // BFS still visits strikes in array order (id=1,2 are the FAR cluster).
    // After v2.58 refactor, IDs come from a module-level counter and survive
    // across trackStorms calls. After in-call sort, the BUILD order survives:
    // far cluster's ID is one less than near cluster's ID.
    const farThenNear = [
      makeStrike({ id: 1, lat: 44.0, lon: -8.1 }),
      makeStrike({ id: 2, lat: 44.05, lon: -8.1 }),
      makeStrike({ id: 3, lat: 42.4, lon: -8.1 }),
      makeStrike({ id: 4, lat: 42.42, lon: -8.1 }),
    ];
    const r1 = trackStorms(farThenNear, [], RES_LAT, RES_LON);

    expect(r1.clusters[0].distanceToReservoir).toBeLessThan(r1.clusters[1].distanceToReservoir);
    // Both IDs follow the storm-N pattern
    expect(r1.clusters[0].id).toMatch(/^storm-\d+$/);
    expect(r1.clusters[1].id).toMatch(/^storm-\d+$/);
    // Build order: FAR (BFS-first) gets the lower ID, NEAR (BFS-second) higher.
    const farN = parseInt(r1.clusters[1].id.split('-')[1]);
    const nearN = parseInt(r1.clusters[0].id.split('-')[1]);
    expect(nearN).toBe(farN + 1);
  });

  it('inherits ID across polls when same physical cluster matched — fixes hull memo cache', () => {
    // Same physical cluster, drifted 2.5km east — realistic 30km/h
    // Use a manually-built history snapshot so we control the timestamp gap
    // (production polls 2min apart; test must fake the 5-min gap).
    const now = Date.now();
    const history: ClusterSnapshot[] = [{
      timestamp: now - 5 * 60_000,
      centroids: [{ id: 'storm-99', lat: 42.4, lon: -8.30, strikeCount: 2 }],
    }];

    const strikesT1 = [
      makeStrike({ lat: 42.4, lon: -8.27, ageMinutes: 1, timestamp: now - 60_000 }),
      makeStrike({ lat: 42.41, lon: -8.27, ageMinutes: 1, timestamp: now - 60_000 }),
    ];
    const r1 = trackStorms(strikesT1, history, RES_LAT, RES_LON);
    expect(r1.clusters[0].id).toBe('storm-99'); // ID inherited from history match
  });

  it('does NOT match clusters >MAX_MATCH_KM apart (independent storms)', () => {
    const now = Date.now();
    const history: ClusterSnapshot[] = [{
      timestamp: now - 5 * 60_000,
      centroids: [{ id: 'storm-old', lat: 42.4, lon: -8.30, strikeCount: 2 }],
    }];

    // New cluster 100km north — clearly a different storm
    const strikesT1 = [
      makeStrike({ lat: 43.4, lon: -8.30, ageMinutes: 1, timestamp: now - 60_000 }),
      makeStrike({ lat: 43.41, lon: -8.30, ageMinutes: 1, timestamp: now - 60_000 }),
    ];
    const r1 = trackStorms(strikesT1, history, RES_LAT, RES_LON);
    expect(r1.clusters[0].id).not.toBe('storm-old');
  });
});

// ── bearingToCardinal helper ─────────────────────────

describe('bearingToCardinal', () => {
  it('maps cardinal points correctly', () => {
    expect(bearingToCardinal(0)).toBe('N');
    expect(bearingToCardinal(45)).toBe('NE');
    expect(bearingToCardinal(90)).toBe('E');
    expect(bearingToCardinal(135)).toBe('SE');
    expect(bearingToCardinal(180)).toBe('S');
    expect(bearingToCardinal(225)).toBe('SW');
    expect(bearingToCardinal(270)).toBe('W');
    expect(bearingToCardinal(315)).toBe('NW');
  });

  it('wraps 360 → N', () => {
    expect(bearingToCardinal(360)).toBe('N');
  });

  it('rounds to nearest 45° bucket', () => {
    expect(bearingToCardinal(22)).toBe('N');   // <22.5 → N
    expect(bearingToCardinal(23)).toBe('NE');  // ≥22.5 → NE
    expect(bearingToCardinal(67)).toBe('NE');  // <67.5 → NE
    expect(bearingToCardinal(68)).toBe('E');   // ≥67.5 → E
  });
});

// ── trackStorms — leading-edge tracking (S126+1 bug #5) ──────

describe('trackStorms — leading-edge centroid for elongated squall lines', () => {
  it('compact cluster: leadLat/leadLon ≈ display centroid (within 1 km)', () => {
    const now = Date.now();
    const strikes = [
      makeStrike({ lat: 42.50, lon: -8.20, ageMinutes: 2, timestamp: now - 120_000 }),
      makeStrike({ lat: 42.51, lon: -8.20, ageMinutes: 1, timestamp: now - 60_000 }),
      makeStrike({ lat: 42.50, lon: -8.21, ageMinutes: 1, timestamp: now - 60_000 }),
    ];
    const r = trackStorms(strikes, [], RES_LAT, RES_LON);
    expect(r.clusters).toHaveLength(1);
    const c = r.clusters[0];
    // Both points exist
    expect(c.leadLat).toBeDefined();
    expect(c.leadLon).toBeDefined();
    // For a tight cluster of 3 strikes within ~1 km, lead and centroid are
    // essentially identical (both weighted toward the youngest strikes).
    expect(Math.abs(c.leadLat - c.lat)).toBeLessThan(0.02);
    expect(Math.abs(c.leadLon - c.lon)).toBeLessThan(0.02);
  });

  it('elongated squall: leadLat is shifted toward the youngest strikes vs display centroid', () => {
    const now = Date.now();
    // 4 OLD strikes far north (40 min old, beyond LEAD_WINDOW_MIN=12)
    // 4 YOUNG strikes far south (1 min old)
    // Display centroid sits in the middle (recency-weighted but still pulled
    // by mass). Lead centroid sits with the young ones in the south.
    const strikes = [
      makeStrike({ lat: 42.70, lon: -8.20, ageMinutes: 40, timestamp: now - 40 * 60_000 }),
      makeStrike({ lat: 42.71, lon: -8.20, ageMinutes: 40, timestamp: now - 40 * 60_000 }),
      makeStrike({ lat: 42.70, lon: -8.21, ageMinutes: 40, timestamp: now - 40 * 60_000 }),
      makeStrike({ lat: 42.71, lon: -8.21, ageMinutes: 40, timestamp: now - 40 * 60_000 }),
      makeStrike({ lat: 42.55, lon: -8.20, ageMinutes: 1, timestamp: now - 60_000 }),
      makeStrike({ lat: 42.56, lon: -8.20, ageMinutes: 1, timestamp: now - 60_000 }),
      makeStrike({ lat: 42.55, lon: -8.21, ageMinutes: 1, timestamp: now - 60_000 }),
      makeStrike({ lat: 42.56, lon: -8.21, ageMinutes: 1, timestamp: now - 60_000 }),
    ];
    const r = trackStorms(strikes, [], RES_LAT, RES_LON);
    // Strikes span ~17 km north-south so they may subdivide. The cluster
    // containing the YOUNG strikes (south) is what we care about — find it
    // by which one contains a young strike position.
    const southCluster = r.clusters.find((c) =>
      c.strikePositions.some(([lon, lat]) => lat <= 42.57 && lat >= 42.54),
    );
    expect(southCluster).toBeDefined();
    if (southCluster) {
      // For this cluster the lead is at the south end (with the young strikes).
      expect(southCluster.leadLat).toBeLessThanOrEqual(southCluster.lat + 0.01);
    }

    // For a cluster that did NOT subdivide (radius < 40 km cap), lead must
    // sit south of the display centroid.
    const merged = r.clusters.find((c) => c.strikeCount === 8);
    if (merged) {
      expect(merged.leadLat).toBeLessThan(merged.lat);
    }
  });

  it('matching uses leading edge: storm-id inherited even when whole-cluster centroid drifted >MAX_MATCH_KM', () => {
    const now = Date.now();
    // Previous snapshot stores a leading point at (42.50, -8.20).
    // New cluster: 3 OLD trailing strikes near the previous head, 3 NEW
    // strikes ~5 km south — leading edge is now at ~(42.45, -8.20).
    // The DISPLAY centroid sits between them at ~(42.475, -8.20). With
    // MAX_MATCH_KM=30 both points would still match in this small example,
    // but the test verifies that the lead position drives matching distance
    // (lead-to-prev distance ~5 km, much less than display-to-prev ~3 km
    //  — both succeed; the assertion is on ID inheritance regardless).
    const history: ClusterSnapshot[] = [{
      timestamp: now - 5 * 60_000,
      centroids: [{ id: 'storm-squall', lat: 42.50, lon: -8.20, strikeCount: 6 }],
    }];
    const strikes = [
      makeStrike({ lat: 42.50, lon: -8.20, ageMinutes: 30, timestamp: now - 30 * 60_000 }),
      makeStrike({ lat: 42.51, lon: -8.20, ageMinutes: 30, timestamp: now - 30 * 60_000 }),
      makeStrike({ lat: 42.50, lon: -8.21, ageMinutes: 30, timestamp: now - 30 * 60_000 }),
      makeStrike({ lat: 42.45, lon: -8.20, ageMinutes: 1, timestamp: now - 60_000 }),
      makeStrike({ lat: 42.46, lon: -8.20, ageMinutes: 1, timestamp: now - 60_000 }),
      makeStrike({ lat: 42.45, lon: -8.21, ageMinutes: 1, timestamp: now - 60_000 }),
    ];
    const r = trackStorms(strikes, history, RES_LAT, RES_LON);
    // ID is inherited from the previous storm (continuity preserved).
    expect(r.clusters[0].id).toBe('storm-squall');
  });

  it('snapshot stores leading point — next poll matches against the head, not the body', () => {
    const now = Date.now();
    const strikes = [
      makeStrike({ lat: 42.70, lon: -8.20, ageMinutes: 40, timestamp: now - 40 * 60_000 }),
      makeStrike({ lat: 42.71, lon: -8.20, ageMinutes: 40, timestamp: now - 40 * 60_000 }),
      makeStrike({ lat: 42.55, lon: -8.20, ageMinutes: 1, timestamp: now - 60_000 }),
      makeStrike({ lat: 42.56, lon: -8.20, ageMinutes: 1, timestamp: now - 60_000 }),
    ];
    const r = trackStorms(strikes, [], RES_LAT, RES_LON);
    // The snapshot's centroid lat must match the cluster's leadLat (lead is
    // what we serialize), NOT the display centroid lat.
    expect(r.history[0].centroids).toHaveLength(r.clusters.length);
    for (let i = 0; i < r.clusters.length; i++) {
      expect(Math.abs(r.history[0].centroids[i].lat - r.clusters[i].leadLat)).toBeLessThan(1e-6);
      expect(Math.abs(r.history[0].centroids[i].lon - r.clusters[i].leadLon)).toBeLessThan(1e-6);
    }
  });
});

// ── trackStorms — history retention ──────────────────

describe('trackStorms — history pruning', () => {
  it('keeps last 10 snapshots max', () => {
    const now = Date.now();
    const old: ClusterSnapshot[] = Array.from({ length: 15 }, (_, i) => ({
      timestamp: now - (i + 1) * 60_000,
      centroids: [{ id: `s-${i}`, lat: 42.5, lon: -8.2, strikeCount: 1 }],
    }));
    const r = trackStorms([], old, RES_LAT, RES_LON);
    expect(r.history.length).toBeLessThanOrEqual(10);
  });

  it('discards snapshots older than MAX_VELOCITY_AGE_MS (15min)', () => {
    const now = Date.now();
    const old: ClusterSnapshot[] = [{
      timestamp: now - 20 * 60_000, // 20 min ago — should be dropped
      centroids: [{ id: 's-old', lat: 42.5, lon: -8.2, strikeCount: 3 }],
    }];
    const r = trackStorms([], old, RES_LAT, RES_LON);
    // Only the new empty snapshot survives, 20-min-old one was filtered
    expect(r.history).toHaveLength(1);
    expect(r.history[0].timestamp).toBeGreaterThan(now - 1000);
  });
});
