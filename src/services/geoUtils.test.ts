/**
 * Tests for geoUtils — haversine distance, AEMET DMS parsing, bounds checks.
 *
 * Used by: spotScoringEngine (radius filter), ingestor analyzer (spot scoring),
 * stationDiscovery (sector filter), normalizer (AEMET coords). Critical for
 * data correctness — bug here = wrong stations included/excluded everywhere.
 */

import { describe, it, expect } from 'vitest';
import {
  haversineDistance,
  aemetDmsToDecimal,
  isWithinRadius,
  isPointInBounds,
} from './geoUtils';

// ── haversineDistance ────────────────────────────────────────

describe('haversineDistance', () => {
  it('returns 0 for identical points', () => {
    expect(haversineDistance(42.3, -8.7, 42.3, -8.7)).toBe(0);
  });

  it('symmetric: d(A,B) === d(B,A)', () => {
    const d1 = haversineDistance(42.3, -8.7, 42.5, -8.5);
    const d2 = haversineDistance(42.5, -8.5, 42.3, -8.7);
    expect(d1).toBeCloseTo(d2, 6);
  });

  it('Cíes (42.22, -8.91) to Castrelo (42.30, -8.11) ≈ 66km', () => {
    // Real-world spot distance for sanity check
    const d = haversineDistance(42.22, -8.91, 42.30, -8.11);
    expect(d).toBeGreaterThan(60);
    expect(d).toBeLessThan(72);
  });

  it('Vigo to Madrid ≈ 465km (long-distance check)', () => {
    // Vigo: 42.24, -8.72 — Madrid: 40.42, -3.70 (great-circle ~465km)
    const d = haversineDistance(42.24, -8.72, 40.42, -3.70);
    expect(d).toBeGreaterThan(450);
    expect(d).toBeLessThan(480);
  });

  it('1° latitude ≈ 111km regardless of longitude', () => {
    expect(haversineDistance(42.0, 0, 43.0, 0)).toBeCloseTo(111.19, 0);
    expect(haversineDistance(42.0, -8.7, 43.0, -8.7)).toBeCloseTo(111.19, 0);
  });

  it('returns positive distance even for opposite-sign coords (Equator + Greenwich)', () => {
    expect(haversineDistance(0, 0, 1, 1)).toBeGreaterThan(0);
  });
});

// ── aemetDmsToDecimal — AEMET coordinate parsing ─────────────

describe('aemetDmsToDecimal — AEMET DMS format', () => {
  it('parses latitude N (DDMMSS)', () => {
    // 42°17'30" N
    expect(aemetDmsToDecimal('421730N')).toBeCloseTo(42.2917, 4);
  });

  it('parses latitude S (negates)', () => {
    expect(aemetDmsToDecimal('421730S')).toBeCloseTo(-42.2917, 4);
  });

  it('parses longitude W with 2-digit degrees (DDMMSS)', () => {
    // 8°7'45" W
    expect(aemetDmsToDecimal('080745W')).toBeCloseTo(-8.1292, 3);
  });

  it('parses longitude W with 3-digit degrees (DDDMMSS)', () => {
    // 100°30'00" W (hypothetical)
    expect(aemetDmsToDecimal('1003000W')).toBeCloseTo(-100.5, 4);
  });

  it('parses longitude E (positive)', () => {
    expect(aemetDmsToDecimal('080745E')).toBeCloseTo(8.1292, 3);
  });

  it('Galicia coordinates round-trip to expected decimal', () => {
    // Real AEMET station: Vigo Peinador "421417N", "0083709W"
    const lat = aemetDmsToDecimal('421417N');
    expect(lat).toBeGreaterThan(42.2);
    expect(lat).toBeLessThan(42.3);
  });
});

// ── isWithinRadius ───────────────────────────────────────────

describe('isWithinRadius', () => {
  it('true when point is exactly at center', () => {
    expect(isWithinRadius(42.3, -8.7, 42.3, -8.7, 5)).toBe(true);
  });

  it('true when distance < radius', () => {
    // ~10km north — should be within 30km
    expect(isWithinRadius(42.3, -8.7, 42.39, -8.7, 30)).toBe(true);
  });

  it('false when distance > radius', () => {
    // ~111km north — outside 30km
    expect(isWithinRadius(42.3, -8.7, 43.3, -8.7, 30)).toBe(false);
  });

  it('boundary case: distance ≈ radius', () => {
    // Exactly at edge — should still return true (≤)
    const d = haversineDistance(42.3, -8.7, 42.39, -8.7);
    expect(isWithinRadius(42.3, -8.7, 42.39, -8.7, d)).toBe(true);
  });

  it('zero radius excludes everything except exact center', () => {
    expect(isWithinRadius(42.3, -8.7, 42.30001, -8.7, 0)).toBe(false);
    expect(isWithinRadius(42.3, -8.7, 42.3, -8.7, 0)).toBe(true);
  });
});

// ── isPointInBounds ──────────────────────────────────────────

describe('isPointInBounds', () => {
  // Galicia rough bounds: NE corner (lon, lat) = (-6.7, 43.8), SW = (-9.5, 41.8)
  const ne: [number, number] = [-6.7, 43.8];
  const sw: [number, number] = [-9.5, 41.8];

  it('true for point inside Galicia bounds', () => {
    expect(isPointInBounds(42.3, -8.7, ne, sw)).toBe(true); // Vigo area
  });

  it('false for point in Madrid (outside Galicia)', () => {
    expect(isPointInBounds(40.4, -3.7, ne, sw)).toBe(false);
  });

  it('handles bounds in any order (min/max derived internally)', () => {
    // Reversed corners — should still work
    expect(isPointInBounds(42.3, -8.7, sw, ne)).toBe(true);
  });

  it('inclusive at boundary (point exactly on edge)', () => {
    expect(isPointInBounds(43.8, -6.7, ne, sw)).toBe(true);
    expect(isPointInBounds(41.8, -9.5, ne, sw)).toBe(true);
  });

  it('false just outside boundary', () => {
    expect(isPointInBounds(43.81, -6.7, ne, sw)).toBe(false);
    expect(isPointInBounds(41.79, -9.5, ne, sw)).toBe(false);
  });
});
