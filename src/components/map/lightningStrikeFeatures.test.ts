import { describe, it, expect } from 'vitest';
import type { LightningStrike } from '../../types/lightning';
import {
  ageBucket,
  isLiveStrike,
  isHistoricalStrike,
  buildStrikeFeatures,
  LIVE_MAX_AGE_MIN,
  HIST_MIN_AGE_MIN,
} from './lightningStrikeFeatures';

function strike(ageMinutes: number, over: Partial<LightningStrike> = {}): LightningStrike {
  return {
    id: 1,
    lat: 42.2,
    lon: -8.7,
    timestamp: 0,
    peakCurrent: -12.5,
    cloudToCloud: false,
    multiplicity: 1,
    ageMinutes,
    ...over,
  };
}

describe('ageBucket', () => {
  it('maps age to the 4 paint buckets at the documented boundaries', () => {
    expect(ageBucket(0)).toBe(0);
    expect(ageBucket(14.9)).toBe(0);
    expect(ageBucket(15)).toBe(1);
    expect(ageBucket(59.9)).toBe(1);
    expect(ageBucket(60)).toBe(2);
    expect(ageBucket(359.9)).toBe(2);
    expect(ageBucket(360)).toBe(3);
    expect(ageBucket(1440)).toBe(3);
  });
});

describe('live / historical partition', () => {
  it('live = strictly below LIVE_MAX_AGE_MIN', () => {
    expect(isLiveStrike(strike(0))).toBe(true);
    expect(isLiveStrike(strike(LIVE_MAX_AGE_MIN - 0.1))).toBe(true);
    expect(isLiveStrike(strike(LIVE_MAX_AGE_MIN))).toBe(false);
    expect(isLiveStrike(strike(120))).toBe(false);
  });

  it('historical = at/above HIST_MIN_AGE_MIN', () => {
    expect(isHistoricalStrike(strike(HIST_MIN_AGE_MIN - 0.1))).toBe(false);
    expect(isHistoricalStrike(strike(HIST_MIN_AGE_MIN))).toBe(true);
    expect(isHistoricalStrike(strike(1000))).toBe(true);
  });

  it('the 60-70 min overlap band is in BOTH sources (no gap on crossing 60min)', () => {
    // This is the invariant the overlay relies on: a strike crossing 60min stays
    // rendered by the always-fresh live source until the throttled historical
    // rebuild picks it up. If LIVE_MAX_AGE_MIN ever drops to HIST_MIN_AGE_MIN the
    // band closes and strikes can flicker — this test guards that.
    expect(LIVE_MAX_AGE_MIN).toBeGreaterThan(HIST_MIN_AGE_MIN);
    const s = strike(65);
    expect(isLiveStrike(s)).toBe(true);
    expect(isHistoricalStrike(s)).toBe(true);
  });

  it('a fresh strike is live-only, an old strike is historical-only', () => {
    const fresh = strike(30);
    expect(isLiveStrike(fresh)).toBe(true);
    expect(isHistoricalStrike(fresh)).toBe(false);
    const old = strike(200);
    expect(isLiveStrike(old)).toBe(false);
    expect(isHistoricalStrike(old)).toBe(true);
  });
});

describe('buildStrikeFeatures', () => {
  it('maps each strike to a Point feature with the paint props', () => {
    const fc = buildStrikeFeatures([
      strike(5, { id: 7, lat: 42.3, lon: -8.8, peakCurrent: -30, cloudToCloud: true, multiplicity: 3 }),
    ]);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0];
    expect(f.geometry).toEqual({ type: 'Point', coordinates: [-8.8, 42.3] });
    expect(f.properties).toMatchObject({
      id: 7,
      ageMinutes: 5,
      peakCurrent: 30, // Math.abs of -30
      cloudToCloud: 1, // intra-cloud → 1
      multiplicity: 3,
      ageBucket: 0, // 5min → fresh
    });
  });

  it('returns an empty collection for no strikes', () => {
    expect(buildStrikeFeatures([]).features).toHaveLength(0);
  });
});
