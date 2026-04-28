/**
 * Tests for stormIntensityService — type + hail-risk classifier.
 *
 * Pure logic. Bug here = wrong storm type label / missed hail warning,
 * which is exactly what the user wants this code to STOP happening
 * (vemos rayos pero ni idea si va a caer poco o mucho).
 */

import { describe, it, expect } from 'vitest';
import {
  classifyStormIntensity,
  classifyHailRisk,
  computeRainRate,
  strikeRatePer15Min,
  type ConvectionState,
  type NearbyPrecipReading,
} from './stormIntensityService';
import type { StormCluster } from './stormTracker';

// ── Fixtures ─────────────────────────────────────────

function makeCluster(overrides: Partial<StormCluster> = {}): StormCluster {
  return {
    id: 'storm-test',
    lat: 42.4,
    lon: -8.2,
    strikeCount: 12,
    radiusKm: 5,
    maxPeakCurrent: 35,
    avgAgeMin: 8,
    newestAgeMin: 1,
    distanceToReservoir: 30,
    velocity: { speedKmh: 30, bearingDeg: 220 },
    etaMinutes: 18,
    approaching: true,
    strikePositions: [],
    ...overrides,
  };
}

function makeReading(precipMm: number, lat = 42.4, lon = -8.2, ageSec = 600): NearbyPrecipReading {
  return { lat, lon, precipMm, ageSeconds: ageSec };
}

// ── computeRainRate ──────────────────────────────────

describe('computeRainRate', () => {
  it('returns null with no readings', () => {
    expect(computeRainRate(42.4, -8.2, [])).toBeNull();
  });

  it('returns null when all readings are too old (>30min)', () => {
    const old = [makeReading(5, 42.4, -8.2, 2000)];
    expect(computeRainRate(42.4, -8.2, old)).toBeNull();
  });

  it('returns null when all readings are too far (>15km)', () => {
    const far = [makeReading(5, 43.5, -8.2)]; // ~122km away
    expect(computeRainRate(42.4, -8.2, far)).toBeNull();
  });

  it('skips readings with null/negative precip', () => {
    const r = [
      makeReading(5),
      { ...makeReading(0), precipMm: null },
      { ...makeReading(0), precipMm: -1 },
    ];
    // Mean of [5] doubled = 10
    expect(computeRainRate(42.4, -8.2, r)).toBe(10);
  });

  it('averages valid nearby readings and converts to mm/h (×2 for 30min window)', () => {
    const r = [makeReading(5), makeReading(7), makeReading(9)];
    // mean = 7, ×2 = 14
    expect(computeRainRate(42.4, -8.2, r)).toBe(14);
  });

  it('zero precip everywhere → 0 mm/h (not null)', () => {
    const r = [makeReading(0), makeReading(0)];
    expect(computeRainRate(42.4, -8.2, r)).toBe(0);
  });
});

// ── strikeRatePer15Min ───────────────────────────────

describe('strikeRatePer15Min', () => {
  it('returns 0 when cluster is dying (newestAgeMin >15min)', () => {
    expect(strikeRatePer15Min(makeCluster({ newestAgeMin: 20 }))).toBe(0);
  });

  it('returns total strikeCount for young clusters (<15min avg age)', () => {
    const c = makeCluster({ strikeCount: 30, avgAgeMin: 5, newestAgeMin: 1 });
    expect(strikeRatePer15Min(c)).toBe(30);
  });

  it('extrapolates rate for older clusters (avgAgeMin/15 ratio)', () => {
    // 30 strikes over 30min → 15 strikes/15min
    const c = makeCluster({ strikeCount: 30, avgAgeMin: 30, newestAgeMin: 5 });
    expect(strikeRatePer15Min(c)).toBeCloseTo(15, 0);
  });
});

// ── classifyHailRisk ─────────────────────────────────

describe('classifyHailRisk', () => {
  it('returns none for null convection state', () => {
    expect(classifyHailRisk(null)).toBe('none');
  });

  it('returns probable when CAPE≥1500 + LI≤-3 + T_500≤-15°C (full criterion)', () => {
    const c: ConvectionState = { cape: 1800, liftedIndex: -4, temperature500hPa: -18 };
    expect(classifyHailRisk(c)).toBe('probable');
  });

  it('returns posible when CAPE≥1000 + LI≤-2 (moderate criterion)', () => {
    const c: ConvectionState = { cape: 1200, liftedIndex: -2.5, temperature500hPa: -10 };
    expect(classifyHailRisk(c)).toBe('posible');
  });

  it('returns none for low CAPE even with cold tops', () => {
    const c: ConvectionState = { cape: 400, liftedIndex: -1, temperature500hPa: -20 };
    expect(classifyHailRisk(c)).toBe('none');
  });

  it('warm 500hPa caps at posible (not probable) even with high CAPE+LI', () => {
    // CAPE=2000, LI=-5, but T500=-12 (warm) → only posible
    const c: ConvectionState = { cape: 2000, liftedIndex: -5, temperature500hPa: -12 };
    expect(classifyHailRisk(c)).toBe('posible');
  });

  it('handles null individual fields gracefully (treats as benign)', () => {
    expect(classifyHailRisk({ cape: null, liftedIndex: null, temperature500hPa: null })).toBe('none');
    // CAPE present but no LI → no probable/posible (LI defaults benign)
    expect(classifyHailRisk({ cape: 2000, liftedIndex: null, temperature500hPa: -20 })).toBe('none');
  });
});

// ── classifyStormIntensity — type detection ──────────

describe('classifyStormIntensity — type detection', () => {
  const noConvection = null;

  it('eléctrica seca: many strikes + 0 rain', () => {
    const cluster = makeCluster({ strikeCount: 25, avgAgeMin: 10 });
    const r = classifyStormIntensity(cluster, [makeReading(0)], noConvection);
    expect(r.type).toBe('eléctrica seca');
    expect(r.visualStyle).toBe('dry-rings');
    expect(r.label).toContain('Eléctrica seca');
  });

  it('lluvia intensa: rain >15mm/h triggers regardless of strikes', () => {
    const cluster = makeCluster({ strikeCount: 5 });
    // 10mm × 2 = 20mm/h
    const r = classifyStormIntensity(cluster, [makeReading(10)], noConvection);
    expect(r.type).toBe('lluvia intensa');
    expect(r.visualStyle).toBe('wet-fill');
  });

  it('lluvia con rayos: rain 5-15 + strikes ≥5', () => {
    const cluster = makeCluster({ strikeCount: 10, avgAgeMin: 8 });
    // 4mm × 2 = 8mm/h
    const r = classifyStormIntensity(cluster, [makeReading(4)], noConvection);
    expect(r.type).toBe('lluvia con rayos');
    expect(r.visualStyle).toBe('mixed');
  });

  it('estratiforme leve: light rain + few strikes', () => {
    const cluster = makeCluster({ strikeCount: 2, avgAgeMin: 8 });
    // 1mm × 2 = 2mm/h
    const r = classifyStormIntensity(cluster, [makeReading(1)], noConvection);
    expect(r.type).toBe('estratiforme leve');
    expect(r.visualStyle).toBe('stratiform');
  });

  it('sin datos: no readings + dying cluster', () => {
    const cluster = makeCluster({ newestAgeMin: 25, strikeCount: 0 });
    const r = classifyStormIntensity(cluster, [], noConvection);
    expect(r.type).toBe('sin datos');
  });

  it('mixta: defaults when no clear signal', () => {
    const cluster = makeCluster({ strikeCount: 3, avgAgeMin: 10 });
    const r = classifyStormIntensity(cluster, [], noConvection);
    // 3 strikes, no rain data, no clear classification → mixta
    expect(r.type).toBe('mixta');
  });
});

// ── classifyStormIntensity — hail risk integration ──

describe('classifyStormIntensity — hail in label', () => {
  it('appends ⚠ Granizo probable to label when hail risk probable', () => {
    const cluster = makeCluster({ strikeCount: 12 });
    const conv: ConvectionState = { cape: 2000, liftedIndex: -4, temperature500hPa: -18 };
    const r = classifyStormIntensity(cluster, [makeReading(8)], conv);
    expect(r.hailRisk).toBe('probable');
    expect(r.label).toContain('Granizo probable');
  });

  it('appends Granizo posible when moderate criterion met', () => {
    const cluster = makeCluster({ strikeCount: 8 });
    const conv: ConvectionState = { cape: 1200, liftedIndex: -2.5, temperature500hPa: -10 };
    const r = classifyStormIntensity(cluster, [makeReading(6)], conv);
    expect(r.hailRisk).toBe('posible');
    expect(r.label).toContain('Granizo posible');
  });

  it('no Granizo tag when risk is none', () => {
    const cluster = makeCluster({ strikeCount: 5 });
    const conv: ConvectionState = { cape: 300, liftedIndex: 0, temperature500hPa: -5 };
    const r = classifyStormIntensity(cluster, [makeReading(2)], conv);
    expect(r.hailRisk).toBe('none');
    expect(r.label).not.toContain('Granizo');
  });
});

// ── Output shape ─────────────────────────────────────

describe('classifyStormIntensity — output shape', () => {
  it('always returns required fields', () => {
    const r = classifyStormIntensity(makeCluster(), [], null);
    expect(r).toHaveProperty('type');
    expect(r).toHaveProperty('rainRateMmH');
    expect(r).toHaveProperty('strikeRate15min');
    expect(r).toHaveProperty('hailRisk');
    expect(r).toHaveProperty('label');
    expect(r).toHaveProperty('visualStyle');
  });

  it('label is plain text (no emojis — S126+1 protomaps font 404 fix)', () => {
    const r = classifyStormIntensity(makeCluster({ strikeCount: 25 }), [makeReading(0)], null);
    expect(r.label.length).toBeGreaterThan(2);
    // Only ASCII + Latin-1 + safe punctuation. No characters in U+1F300-1F37F
    // (Misc Symbols and Pictographs) which protomaps Noto Sans doesn't cover.
    for (const ch of r.label) {
      const code = ch.codePointAt(0) ?? 0;
      expect(code < 0x1F000 || code > 0x1FAFF).toBe(true);
    }
  });
});
