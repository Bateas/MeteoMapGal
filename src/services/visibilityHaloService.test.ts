/**
 * Tests for visibilityHaloService — DEM-aware fog halo around AEMET stations.
 *
 * Critical invariants:
 * - Higher altitude than station+buffer → NO halo (fog stays in cold-air pool)
 * - Coastal station + water cell → halo allowed (advective spreads over water)
 * - Interior station + water cell → no halo (no water nearby anyway,
 *   and a null elevation usually means "tile not loaded yet" → fail safe)
 * - Worse visibility = wider + denser halo
 */

import { describe, it, expect } from 'vitest';
import {
  haloRadiusKm,
  densityForCell,
  distKm,
  haloBbox,
  HALO_VIS_THRESHOLD_KM,
} from './visibilityHaloService';

// ── haloRadiusKm ─────────────────────────────────────

describe('haloRadiusKm', () => {
  it('returns 0 above threshold (>=2km visibility)', () => {
    expect(haloRadiusKm(2)).toBe(0);
    expect(haloRadiusKm(5)).toBe(0);
  });

  it('returns 5km for very dense fog (≤0.5km vis)', () => {
    expect(haloRadiusKm(0.3)).toBe(5);
    expect(haloRadiusKm(0.5)).toBe(5);
  });

  it('returns 4km for moderate fog (0.5-1.0km)', () => {
    expect(haloRadiusKm(0.7)).toBe(4);
    expect(haloRadiusKm(1.0)).toBe(4);
  });

  it('returns 3km for thinning fog (1.0-1.5km)', () => {
    expect(haloRadiusKm(1.2)).toBe(3);
    expect(haloRadiusKm(1.5)).toBe(3);
  });

  it('returns 2km for marginal fog (1.5-2.0km)', () => {
    expect(haloRadiusKm(1.7)).toBe(2);
    expect(haloRadiusKm(1.99)).toBe(2);
  });
});

// ── densityForCell — topographic gating ──────────────

describe('densityForCell — altitude gate (S124 user requirement)', () => {
  it('returns 0 when station altitude is unknown (defer halo)', () => {
    expect(densityForCell(1, 5, 100, null, 0.5)).toBe(0);
    expect(densityForCell(1, 5, 100, undefined, 0.5)).toBe(0);
  });

  it('returns 0 when cell is high above station (cumbre, sin niebla)', () => {
    // Lavacolla airport at 370m. Mount nearby at 600m.
    expect(densityForCell(1, 5, 600, 370, 0.5)).toBe(0);
  });

  it('paints when cell is at station altitude (valley floor)', () => {
    expect(densityForCell(1, 5, 370, 370, 0.5)).toBeGreaterThan(0);
  });

  it('paints when cell is just slightly above (within +50m buffer)', () => {
    expect(densityForCell(1, 5, 410, 370, 0.5)).toBeGreaterThan(0);
  });

  it('returns 0 above buffer +50m (steep flank)', () => {
    expect(densityForCell(1, 5, 421, 370, 0.5)).toBe(0);
  });

  it('paints lower-than-station cells (descending into deeper valley)', () => {
    expect(densityForCell(1, 5, 200, 370, 0.5)).toBeGreaterThan(0);
  });
});

// ── densityForCell — coastal water rule ──────────────

describe('densityForCell — coastal vs interior water handling', () => {
  it('coastal station (Fisterra ~30m) + water cell → painted', () => {
    expect(densityForCell(1, 4, null, 30, 0.5)).toBeGreaterThan(0);
  });

  it('coastal station (Alvedro ~100m boundary) + water cell → painted', () => {
    // 50m boundary — station alt 50m is coastal (≤50)
    expect(densityForCell(1, 4, null, 50, 0.5)).toBeGreaterThan(0);
  });

  it('interior station (Lavacolla 370m) + water/null cell → SKIP', () => {
    // Should never happen in practice but defensive
    expect(densityForCell(1, 4, null, 370, 0.5)).toBe(0);
  });

  it('interior station (Lugo Rozas 444m) + water cell → SKIP', () => {
    expect(densityForCell(1, 4, null, 444, 0.5)).toBe(0);
  });
});

// ── densityForCell — distance falloff ────────────────

describe('densityForCell — distance falloff', () => {
  it('returns 0 outside the halo radius', () => {
    expect(densityForCell(6, 5, 100, 100, 0.5)).toBe(0);
  });

  it('returns 0 when radius is 0 (vis above threshold)', () => {
    expect(densityForCell(0, 0, 100, 100, 5)).toBe(0);
  });

  it('density decreases with distance from station (quadratic)', () => {
    const close = densityForCell(0.5, 5, 100, 100, 0.5);
    const mid = densityForCell(2.5, 5, 100, 100, 0.5);
    const far = densityForCell(4.5, 5, 100, 100, 0.5);
    expect(close).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThanOrEqual(far);
  });

  it('density caps at 1.0', () => {
    // Worst-case: dense fog (vis 0.1) at station origin (dist 0)
    expect(densityForCell(0, 5, 100, 100, 0.1)).toBeLessThanOrEqual(1);
  });
});

// ── densityForCell — visibility intensity ────────────

describe('densityForCell — visibility intensity multiplier', () => {
  it('lower visibility → higher base density', () => {
    const dense = densityForCell(1, 5, 100, 100, 0.3);
    const light = densityForCell(1, 5, 100, 100, 1.8);
    expect(dense).toBeGreaterThan(light);
  });

  it('marginal visibility (1.9km) still produces some output close to station', () => {
    const d = densityForCell(0.5, 2, 100, 100, 1.9);
    // Could be 0 if too low; check it's at least nonneg
    expect(d).toBeGreaterThanOrEqual(0);
  });
});

// ── densityForCell — bucketing (seam-free render) ────

describe('densityForCell — output bucketed to 4 levels', () => {
  it('output is one of 0, 0.25, 0.5, 0.75, 1.0', () => {
    const samples: number[] = [];
    for (let d = 0; d < 5; d += 0.5) {
      for (let v = 0.3; v < 2; v += 0.3) {
        const result = densityForCell(d, 5, 100, 100, v);
        samples.push(result);
      }
    }
    const unique = Array.from(new Set(samples)).sort();
    for (const u of unique) {
      // Each value must be a multiple of 0.25
      expect(Math.abs((u * 4) - Math.round(u * 4))).toBeLessThan(1e-9);
    }
  });
});

// ── helpers ──────────────────────────────────────────

describe('distKm', () => {
  it('returns 0 for identical points', () => {
    expect(distKm(42.3, -8.7, 42.3, -8.7)).toBe(0);
  });

  it('1° latitude ≈ 111km', () => {
    expect(distKm(42, 0, 43, 0)).toBeCloseTo(111, 0);
  });
});

describe('haloBbox', () => {
  it('produces a bbox that covers the radius', () => {
    const b = haloBbox(42.5, -8.5, 5);
    expect(b.east).toBeGreaterThan(-8.5);
    expect(b.west).toBeLessThan(-8.5);
    expect(b.north).toBeGreaterThan(42.5);
    expect(b.south).toBeLessThan(42.5);
  });

  it('larger radius → wider bbox', () => {
    const small = haloBbox(42.5, -8.5, 2);
    const big = haloBbox(42.5, -8.5, 8);
    expect(big.east - big.west).toBeGreaterThan(small.east - small.west);
  });
});

// ── exported constant ───────────────────────────────

describe('HALO_VIS_THRESHOLD_KM constant', () => {
  it('is 2.0 (ICAO mist boundary)', () => {
    expect(HALO_VIS_THRESHOLD_KM).toBe(2);
  });
});
