/**
 * Tests for ingestor/fireWatchLogic — pure dry-lightning classification.
 *
 * The DB query + dispatch paths (fireWatch.ts) are integration-only, same
 * pattern as the other ingestor cycles. Here we lock the rigor rules:
 * land filter, accumulated-delta dryness (the day-accumulator gotcha),
 * conservative "no station = not dry", clustering and watch thresholds.
 */

import { describe, it, expect } from 'vitest';
import {
  isLikelyLand,
  groupRainReadings,
  classifyStrikeDryness,
  clusterDryStrikes,
  computeFireWatch,
  zoneKey,
  RAIN_DELTA_MM,
  HIGH_CURRENT_KA,
  type FireWatchStrike,
  type RainReading,
} from './fireWatchLogic';

// ── Builders (real interfaces, no ad-hoc shapes) ─────

const T0 = new Date('2026-08-05T14:00:00Z');

function minutes(m: number): Date {
  return new Date(T0.getTime() + m * 60_000);
}

function mkStrike(overrides: Partial<FireWatchStrike> = {}): FireWatchStrike {
  return {
    time: T0,
    lat: 42.34,   // Ourense interior — solidly land
    lon: -7.86,
    peakCurrent: -12,
    ...overrides,
  };
}

function mkRain(
  stationId: string,
  minsFromT0: number,
  precip: number,
  coords: { lat?: number; lon?: number } = {},
): RainReading {
  return {
    stationId,
    lat: coords.lat ?? 42.34,
    lon: coords.lon ?? -7.86,
    time: minutes(minsFromT0),
    precip,
  };
}

// ── isLikelyLand ─────────────────────────────────────

describe('isLikelyLand', () => {
  it('accepts interior Galicia (Ourense, Lugo)', () => {
    expect(isLikelyLand(42.34, -7.86)).toBe(true);  // Ourense
    expect(isLikelyLand(43.0, -7.55)).toBe(true);   // Lugo interior
    expect(isLikelyLand(42.88, -8.54)).toBe(true);  // Santiago
  });

  it('rejects open Atlantic west of the coast', () => {
    expect(isLikelyLand(42.2, -9.0)).toBe(false);   // off Vigo
    expect(isLikelyLand(42.9, -9.5)).toBe(false);   // off Fisterra
  });

  it('rejects the Cantabrico north of the coast cap', () => {
    expect(isLikelyLand(43.7, -7.5)).toBe(false);   // sea off A Marina
    expect(isLikelyLand(43.9, -8.0)).toBe(false);   // north of Estaca
  });

  it('rejects out-of-scope east and south', () => {
    expect(isLikelyLand(42.5, -6.2)).toBe(false);   // Leon/Zamora — land but out of scope
    expect(isLikelyLand(41.5, -8.0)).toBe(false);   // Portugal interior
  });

  it('is conservative on the coastal fringe (drops real coast rather than watch sea)', () => {
    // Cies islands (~42.22, -8.90) are real land but excluded by design.
    expect(isLikelyLand(42.22, -8.9)).toBe(false);
  });
});

// ── classifyStrikeDryness ────────────────────────────

describe('classifyStrikeDryness', () => {
  it('flat day-accumulated counter = DRY (rained at dawn, not around the strike)', () => {
    // The gotcha this feature exists for: precip 8.0 all afternoon means the
    // 8mm fell hours ago. Raw-value logic would call this "wet"; delta says dry.
    const series = groupRainReadings([
      mkRain('mg_1', -60, 8.0),
      mkRain('mg_1', 30, 8.0),
      mkRain('mg_1', 90, 8.0),
    ]);
    expect(classifyStrikeDryness(mkStrike(), series)).toBe('dry');
  });

  it('accumulated delta above threshold around the strike = WET', () => {
    const series = groupRainReadings([
      mkRain('mg_1', -30, 3.0),
      mkRain('mg_1', 30, 4.2),
      mkRain('mg_1', 90, 5.1),  // delta 2.1mm > 0.5mm
    ]);
    expect(classifyStrikeDryness(mkStrike(), series)).toBe('wet');
  });

  it('drizzle below the relevance threshold still counts as DRY', () => {
    const series = groupRainReadings([
      mkRain('mg_1', -30, 3.0),
      mkRain('mg_1', 60, 3.0 + RAIN_DELTA_MM - 0.2),  // +0.3mm — irrelevant
    ]);
    expect(classifyStrikeDryness(mkStrike(), series)).toBe('dry');
  });

  it('no station within 15km = UNKNOWN (conservative, never dry)', () => {
    // Station ~22km north of the strike — outside MAX_STATION_KM.
    const series = groupRainReadings([
      mkRain('mg_far', -30, 0.0, { lat: 42.54 }),
      mkRain('mg_far', 60, 0.0, { lat: 42.54 }),
    ]);
    expect(classifyStrikeDryness(mkStrike(), series)).toBe('unknown');
  });

  it('station with no reading AFTER the strike = UNKNOWN', () => {
    const series = groupRainReadings([
      mkRain('mg_1', -120, 1.0),
      mkRain('mg_1', -30, 1.0),
    ]);
    expect(classifyStrikeDryness(mkStrike(), series)).toBe('unknown');
  });

  it('negative delta (midnight counter reset) = UNKNOWN, never dry', () => {
    const series = groupRainReadings([
      mkRain('mg_1', -30, 12.0),
      mkRain('mg_1', 30, 0.2),  // counter reset — window untrustworthy
    ]);
    expect(classifyStrikeDryness(mkStrike(), series)).toBe('unknown');
  });

  it('uses the NEAREST classifiable station when several are in range', () => {
    const series = groupRainReadings([
      // ~5.5km away, says WET
      mkRain('mg_near', -30, 0.0, { lat: 42.39 }),
      mkRain('mg_near', 30, 2.0, { lat: 42.39 }),
      // ~11km away, says dry — must lose to the nearer one
      mkRain('mg_far', -30, 0.0, { lat: 42.44 }),
      mkRain('mg_far', 30, 0.0, { lat: 42.44 }),
    ]);
    expect(classifyStrikeDryness(mkStrike(), series)).toBe('wet');
  });
});

// ── clusterDryStrikes / watch thresholds ─────────────

describe('clusterDryStrikes', () => {
  it('groups strikes within 10km into one zone, splits distant groups', () => {
    const strikes = [
      mkStrike({ lat: 42.30, lon: -7.90 }),
      mkStrike({ lat: 42.30, lon: -7.82 }),  // ~6.6km from seed
      mkStrike({ lat: 42.30, lon: -7.40 }),  // ~41km — its own zone
    ];
    const zones = clusterDryStrikes(strikes);
    expect(zones).toHaveLength(2);
    expect(zones[0].strikeCount).toBe(2);
    expect(zones[1].strikeCount).toBe(1);
  });

  it('2+ dry strikes put a zone in watch even at low current', () => {
    const zones = clusterDryStrikes([
      mkStrike({ peakCurrent: -8 }),
      mkStrike({ lat: 42.35, peakCurrent: 10 }),
    ]);
    expect(zones).toHaveLength(1);
    expect(zones[0].inWatch).toBe(true);
  });

  it('a single low-current strike does NOT trigger watch', () => {
    const zones = clusterDryStrikes([mkStrike({ peakCurrent: -12 })]);
    expect(zones[0].inWatch).toBe(false);
  });

  it('a single high-current strike (>=30kA, either polarity) triggers watch', () => {
    const positive = clusterDryStrikes([mkStrike({ peakCurrent: HIGH_CURRENT_KA + 5 })]);
    expect(positive[0].inWatch).toBe(true);

    const negative = clusterDryStrikes([mkStrike({ peakCurrent: -(HIGH_CURRENT_KA + 2) })]);
    expect(negative[0].inWatch).toBe(true);
    expect(negative[0].maxAbsKa).toBe(HIGH_CURRENT_KA + 2);
  });

  it('null peakCurrent is treated as 0 (no watch from a single strike)', () => {
    const zones = clusterDryStrikes([mkStrike({ peakCurrent: null })]);
    expect(zones[0].maxAbsKa).toBe(0);
    expect(zones[0].inWatch).toBe(false);
  });
});

// ── zoneKey ──────────────────────────────────────────

describe('zoneKey', () => {
  it('is stable under small centroid drift (0.1 degree snap)', () => {
    expect(zoneKey({ lat: 42.31, lon: -7.88 })).toBe(zoneKey({ lat: 42.33, lon: -7.92 }));
    expect(zoneKey({ lat: 42.31, lon: -7.88 })).not.toBe(zoneKey({ lat: 42.71, lon: -7.88 }));
  });
});

// ── computeFireWatch (end-to-end pure pipeline) ──────

describe('computeFireWatch', () => {
  it('sea strikes are excluded, wet strikes filtered, dry strikes clustered into watch', () => {
    const strikes = [
      mkStrike({ lat: 42.2, lon: -9.0 }),                    // sea — excluded
      mkStrike({ lat: 42.34, lon: -7.86 }),                  // land, dry
      mkStrike({ lat: 42.36, lon: -7.84 }),                  // land, dry, same zone
      mkStrike({ lat: 42.88, lon: -8.54, peakCurrent: 20 }), // land, wet (Santiago)
    ];
    const rain = [
      // Ourense station: flat accumulator → dry
      mkRain('mg_our', -60, 5.0),
      mkRain('mg_our', 60, 5.0),
      // Santiago station: fresh rain → wet
      mkRain('mg_sdc', -60, 0.0, { lat: 42.88, lon: -8.54 }),
      mkRain('mg_sdc', 60, 3.0, { lat: 42.88, lon: -8.54 }),
    ];

    const result = computeFireWatch(strikes, rain);
    expect(result.totalStrikes).toBe(4);
    expect(result.landStrikes).toBe(3);
    expect(result.dryStrikes).toBe(2);
    expect(result.wetStrikes).toBe(1);
    expect(result.unknownStrikes).toBe(0);
    expect(result.zones).toHaveLength(1);
    expect(result.watchZones).toHaveLength(1);
    expect(result.watchZones[0].strikeCount).toBe(2);
  });

  it('land strikes without rain data nearby stay out of watch (unknown, not dry)', () => {
    const result = computeFireWatch(
      [mkStrike(), mkStrike({ lat: 42.35 })],
      [],  // no rain context at all
    );
    expect(result.landStrikes).toBe(2);
    expect(result.dryStrikes).toBe(0);
    expect(result.unknownStrikes).toBe(2);
    expect(result.watchZones).toHaveLength(0);
  });
});
