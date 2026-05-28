/**
 * Tests for stormShadowDetector — infers storm-cell presence/movement from
 * solar-radiation drops, wind anomalies (gust front / outflow) and lightning.
 *
 * All functions are pure. We assert the documented contract: snapshot/anomaly
 * construction, the night filter, the "general overcast vs localized shadow"
 * discrimination, confidence boosts, and the solar-index/cloud-cover helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSolarSnapshots,
  buildWindAnomalies,
  detectStormShadow,
  computeSolarIndex,
  estimateCloudCover,
  type SolarSnapshot,
  type WindAnomaly,
  type LightningContext,
} from './stormShadowDetector';
import type { NormalizedStation, NormalizedReading } from '../types/station';

const TARGET: [number, number] = [-8.0, 42.3]; // [lon, lat] Castrelo-ish

// ── Fixtures ─────────────────────────────────────────────

function station(id: string, lat: number, lon: number): NormalizedStation {
  return { id, name: id, lat, lon, altitude: 10, source: 'meteogalicia', tempOnly: false };
}

function reading(opts: Partial<NormalizedReading> = {}): NormalizedReading {
  return {
    stationId: 'x',
    timestamp: new Date('2026-07-15T14:00:00'),
    windSpeed: null, windGust: null, windDirection: null,
    temperature: 20, humidity: null, precipitation: null,
    solarRadiation: null, pressure: null, dewPoint: null,
    ...opts,
  };
}

// ── buildSolarSnapshots ──────────────────────────────────

describe('buildSolarSnapshots', () => {
  it('skips stations without solar data', () => {
    const stations = [station('a', 42.3, -8.0), station('b', 42.3, -8.1)];
    const cur = new Map([
      ['a', reading({ solarRadiation: 500 })],
      ['b', reading({ solarRadiation: null })], // no pyranometer
    ]);
    const snaps = buildSolarSnapshots(stations, cur, new Map());
    expect(snaps).toHaveLength(1);
    expect(snaps[0].stationId).toBe('a');
  });

  it('computes drop rate vs previous reading', () => {
    const stations = [station('a', 42.3, -8.0)];
    const cur = new Map([['a', reading({ solarRadiation: 300 })]]);
    const prev = new Map([['a', reading({ solarRadiation: 700 })]]);
    const [snap] = buildSolarSnapshots(stations, cur, prev);
    expect(snap.dropRate).toBe(-400);
    expect(snap.previousRadiation).toBe(700);
  });

  it('drop rate is 0 when no previous reading', () => {
    const stations = [station('a', 42.3, -8.0)];
    const cur = new Map([['a', reading({ solarRadiation: 300 })]]);
    const [snap] = buildSolarSnapshots(stations, cur, new Map());
    expect(snap.dropRate).toBe(0);
    expect(snap.previousRadiation).toBeNull();
  });

  it('flags shadowed when radiation drops below threshold from clear', () => {
    const stations = [station('a', 42.3, -8.0)];
    const cur = new Map([['a', reading({ solarRadiation: 100 })]]);
    const prev = new Map([['a', reading({ solarRadiation: 700 })]]);
    const [snap] = buildSolarSnapshots(stations, cur, prev);
    expect(snap.isShadowed).toBe(true);
    expect(snap.shadowOnsetTime).not.toBeNull();
  });

  it('clear station (high radiation) is not shadowed', () => {
    const stations = [station('a', 42.3, -8.0)];
    const cur = new Map([['a', reading({ solarRadiation: 700 })]]);
    const [snap] = buildSolarSnapshots(stations, cur, new Map());
    expect(snap.isShadowed).toBe(false);
    expect(snap.shadowOnsetTime).toBeNull();
  });
});

// ── buildWindAnomalies ───────────────────────────────────

describe('buildWindAnomalies', () => {
  it('skips stations with no wind speed', () => {
    const stations = [station('a', 42.3, -8.0)];
    const cur = new Map([['a', reading({ windSpeed: null })]]);
    expect(buildWindAnomalies(stations, cur, new Map())).toHaveLength(0);
  });

  it('does not record steady, calm wind', () => {
    const stations = [station('a', 42.3, -8.0)];
    const cur = new Map([['a', reading({ windSpeed: 3, windDirection: 200 })]]);
    const prev = new Map([['a', reading({ windSpeed: 2.5, windDirection: 205 })]]);
    expect(buildWindAnomalies(stations, cur, prev)).toHaveLength(0);
  });

  it('detects a gust front (speed jump >= threshold)', () => {
    const stations = [station('a', 42.3, -8.0)];
    const cur = new Map([['a', reading({ windSpeed: 8, windDirection: 200 })]]);
    const prev = new Map([['a', reading({ windSpeed: 2, windDirection: 200 })]]);
    const [wa] = buildWindAnomalies(stations, cur, prev);
    expect(wa.gustDetected).toBe(true);
    expect(wa.speedChange).toBeCloseTo(6, 1);
  });

  it('detects an outflow signature (gust + direction reversal)', () => {
    const stations = [station('a', 42.3, -8.0)];
    const cur = new Map([['a', reading({ windSpeed: 9, windDirection: 270 })]]);
    const prev = new Map([['a', reading({ windSpeed: 2, windDirection: 90 })]]);
    const [wa] = buildWindAnomalies(stations, cur, prev);
    expect(wa.gustDetected).toBe(true);
    expect(wa.outflowSignature).toBe(true);
    expect(wa.directionShift).toBeCloseTo(180, 0);
  });

  it('handles 360° wrap-around in direction shift (350→10 = 20°, not 340°)', () => {
    const stations = [station('a', 42.3, -8.0)];
    // small speed change, tiny effective shift → no anomaly recorded
    const cur = new Map([['a', reading({ windSpeed: 3, windDirection: 10 })]]);
    const prev = new Map([['a', reading({ windSpeed: 3, windDirection: 350 })]]);
    expect(buildWindAnomalies(stations, cur, prev)).toHaveLength(0);
  });
});

// ── detectStormShadow ────────────────────────────────────

describe('detectStormShadow', () => {
  it('returns null with fewer than 2 snapshots', () => {
    const snaps: SolarSnapshot[] = [
      { stationId: 'a', lat: 42.3, lon: -8.5, radiation: 100, previousRadiation: 700, dropRate: -600, isShadowed: true, shadowOnsetTime: new Date() },
    ];
    expect(detectStormShadow(snaps, TARGET)).toBeNull();
  });

  it('returns null when all stations are dark (general overcast, no clear reference)', () => {
    const snaps: SolarSnapshot[] = [
      { stationId: 'a', lat: 42.3, lon: -8.5, radiation: 100, previousRadiation: 700, dropRate: -600, isShadowed: true, shadowOnsetTime: new Date() },
      { stationId: 'b', lat: 42.4, lon: -8.4, radiation: 80, previousRadiation: 700, dropRate: -620, isShadowed: true, shadowOnsetTime: new Date() },
    ];
    expect(detectStormShadow(snaps, TARGET)).toBeNull();
  });

  it('returns null when nothing is shadowed', () => {
    const snaps: SolarSnapshot[] = [
      { stationId: 'a', lat: 42.3, lon: -8.5, radiation: 700, previousRadiation: 700, dropRate: 0, isShadowed: false, shadowOnsetTime: null },
      { stationId: 'b', lat: 42.4, lon: -8.4, radiation: 720, previousRadiation: 710, dropRate: 10, isShadowed: false, shadowOnsetTime: null },
    ];
    expect(detectStormShadow(snaps, TARGET)).toBeNull();
  });

  it('detects a localized shadow with clear reference stations', () => {
    const snaps: SolarSnapshot[] = [
      // shadowed pair (leading-edge drops)
      { stationId: 'sh1', lat: 42.30, lon: -8.50, radiation: 100, previousRadiation: 700, dropRate: -600, isShadowed: true, shadowOnsetTime: new Date() },
      { stationId: 'sh2', lat: 42.35, lon: -8.45, radiation: 120, previousRadiation: 700, dropRate: -580, isShadowed: true, shadowOnsetTime: new Date() },
      // clear references
      { stationId: 'cl1', lat: 42.20, lon: -8.70, radiation: 750, previousRadiation: 740, dropRate: 10, isShadowed: false, shadowOnsetTime: null },
      { stationId: 'cl2', lat: 42.25, lon: -8.60, radiation: 700, previousRadiation: 690, dropRate: 10, isShadowed: false, shadowOnsetTime: null },
    ];
    const r = detectStormShadow(snaps, TARGET);
    expect(r).not.toBeNull();
    expect(r!.shadowedStations).toHaveLength(2);
    expect(r!.clearStations).toHaveLength(2);
    expect(r!.confidence).toBeGreaterThanOrEqual(40);
    // centroid sits between the two shadowed stations
    expect(r!.center[0]).toBeCloseTo(-8.475, 2);
    // two dramatic drops → a movement vector is estimated
    expect(r!.movementBearing).not.toBeNull();
  });

  it('lightning nearby raises confidence', () => {
    const snaps: SolarSnapshot[] = [
      { stationId: 'sh1', lat: 42.30, lon: -8.50, radiation: 100, previousRadiation: 700, dropRate: -600, isShadowed: true, shadowOnsetTime: new Date() },
      { stationId: 'sh2', lat: 42.35, lon: -8.45, radiation: 120, previousRadiation: 700, dropRate: -580, isShadowed: true, shadowOnsetTime: new Date() },
      { stationId: 'cl1', lat: 42.20, lon: -8.70, radiation: 750, previousRadiation: 740, dropRate: 10, isShadowed: false, shadowOnsetTime: null },
      { stationId: 'cl2', lat: 42.25, lon: -8.60, radiation: 700, previousRadiation: 690, dropRate: 10, isShadowed: false, shadowOnsetTime: null },
    ];
    const lightning: LightningContext = { strikesNearShadow: 5, avgDistanceKm: 8, strikeBearing: 270 };
    const withLightning = detectStormShadow(snaps, TARGET, lightning);
    const without = detectStormShadow(snaps, TARGET);
    expect(withLightning!.lightningNearby).toBe(5);
    expect(withLightning!.confidence).toBeGreaterThan(without!.confidence);
  });

  it('night filter: solar-dark with no lightning/wind → null', () => {
    const snaps: SolarSnapshot[] = [
      { stationId: 'a', lat: 42.3, lon: -8.5, radiation: 0, previousRadiation: 0, dropRate: 0, isShadowed: true, shadowOnsetTime: null },
      { stationId: 'b', lat: 42.4, lon: -8.4, radiation: 5, previousRadiation: 5, dropRate: 0, isShadowed: true, shadowOnsetTime: null },
    ];
    expect(detectStormShadow(snaps, TARGET)).toBeNull();
  });

  it('night filter: solar-dark + lightning + wind anomalies → builds storm from wind', () => {
    const snaps: SolarSnapshot[] = [
      { stationId: 'a', lat: 42.3, lon: -8.5, radiation: 0, previousRadiation: 0, dropRate: 0, isShadowed: true, shadowOnsetTime: null },
      { stationId: 'b', lat: 42.4, lon: -8.4, radiation: 5, previousRadiation: 5, dropRate: 0, isShadowed: true, shadowOnsetTime: null },
    ];
    const lightning: LightningContext = { strikesNearShadow: 3, avgDistanceKm: 10, strikeBearing: 180 };
    const winds: WindAnomaly[] = [
      { stationId: 'w1', lat: 42.31, lon: -8.49, currentSpeed: 10, previousSpeed: 3, speedChange: 7, currentDirection: 270, previousDirection: 90, directionShift: 180, gustDetected: true, outflowSignature: true },
    ];
    const r = detectStormShadow(snaps, TARGET, lightning, winds);
    expect(r).not.toBeNull();
    expect(r!.shadowedStations).toHaveLength(0); // no solar at night
    expect(r!.windContext!.outflowCount).toBe(1);
    expect(r!.lightningNearby).toBe(3);
    expect(r!.center[0]).toBeCloseTo(-8.49, 2); // centroid from wind anomaly
  });
});

// ── computeSolarIndex / estimateCloudCover ───────────────

describe('computeSolarIndex', () => {
  it('returns -1 for no data', () => {
    expect(computeSolarIndex([])).toBe(-1);
  });

  it('returns ~100 for full clear sky', () => {
    const snaps: SolarSnapshot[] = [
      { stationId: 'a', lat: 42, lon: -8, radiation: 900, previousRadiation: null, dropRate: 0, isShadowed: false, shadowOnsetTime: null },
    ];
    expect(computeSolarIndex(snaps)).toBe(100);
  });

  it('returns ~50 for half radiation', () => {
    const snaps: SolarSnapshot[] = [
      { stationId: 'a', lat: 42, lon: -8, radiation: 450, previousRadiation: null, dropRate: 0, isShadowed: false, shadowOnsetTime: null },
    ];
    expect(computeSolarIndex(snaps)).toBe(50);
  });
});

describe('estimateCloudCover', () => {
  it('full overcast when no radiation', () => {
    expect(estimateCloudCover(0)).toBe(100);
  });

  it('clear when radiation at expected max', () => {
    expect(estimateCloudCover(900)).toBe(0);
  });

  it('half cover at half radiation', () => {
    expect(estimateCloudCover(450)).toBe(50);
  });
});
