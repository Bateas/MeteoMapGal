/**
 * Tests for stormAlerts builders — converts lightning + storm shadow detections
 * into UnifiedAlert[].
 *
 * Critical path: feeds 24/7 Telegram alert pipeline (ingestor) AND frontend
 * StormIndicator UI. A bug in stormAlertScore() shifts danger thresholds and
 * delays/inflates real-life storm warnings.
 *
 * S123: second test file for src/services/alerts/.
 */

import { describe, it, expect } from 'vitest';
import { stormAlertScore, buildStormAlerts, buildStormShadowAlerts } from './stormAlerts';
import type { StormAlert } from '../../types/lightning';
import type { StormShadow } from '../stormShadowDetector';
import type { NormalizedReading } from '../../types/station';

// ── stormAlertScore — distance + level → 0-100 score ─────────

describe('stormAlertScore — pure score function', () => {
  it('returns 95 for danger regardless of distance', () => {
    expect(stormAlertScore('danger', 1)).toBe(95);
    expect(stormAlertScore('danger', 50)).toBe(95);
  });

  it('warning escalates score as storm gets closer', () => {
    // 60 + (25 - km) * 1.4
    expect(stormAlertScore('warning', 25)).toBe(60); // baseline
    expect(stormAlertScore('warning', 0)).toBe(95); // capped close-range
    expect(stormAlertScore('warning', 10)).toBeCloseTo(60 + 21, 1); // 81
  });

  it('warning at >25km still uses minimum 60', () => {
    // Math.max(0, ...) clamps the bonus
    expect(stormAlertScore('warning', 30)).toBe(60);
    expect(stormAlertScore('warning', 100)).toBe(60);
  });

  it('watch within 50km: 25-60 range', () => {
    // 25 + (50 - km) * 0.7
    expect(stormAlertScore('watch', 50)).toBe(25); // edge
    expect(stormAlertScore('watch', 0)).toBe(60); // closest
  });

  it('watch beyond 50km uses informational range', () => {
    // 10 + (80 - km) * 0.3
    expect(stormAlertScore('watch', 80)).toBe(10);
    expect(stormAlertScore('watch', 51)).toBeCloseTo(10 + 29 * 0.3, 1); // ~18.7
  });

  it('returns 0 for level=none (no alert)', () => {
    expect(stormAlertScore('none', 5)).toBe(0);
  });
});

// ── buildStormAlerts — UnifiedAlert from StormAlert ──────────

function stormAlert(over: Partial<StormAlert>): StormAlert {
  return {
    level: 'watch',
    nearestKm: 30,
    recentCount: 5,
    trend: 'stationary',
    etaMinutes: null,
    speedKmh: null,
    bearingDeg: null,
    clusters: [],
    updatedAt: new Date('2026-04-26T18:00:00Z'),
    ...over,
  };
}

describe('buildStormAlerts', () => {
  it('returns empty array when level=none', () => {
    expect(buildStormAlerts(stormAlert({ level: 'none' }))).toEqual([]);
  });

  it('emits one storm-main alert with score from stormAlertScore', () => {
    const alerts = buildStormAlerts(stormAlert({ level: 'danger', nearestKm: 5 }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe('storm-main');
    expect(alerts[0].category).toBe('storm');
    expect(alerts[0].score).toBe(95);
    expect(alerts[0].severity).toBe('critical'); // 95 ≥ 85
  });

  it('danger level marks urgent=true', () => {
    const alerts = buildStormAlerts(stormAlert({ level: 'danger' }));
    expect(alerts[0].urgent).toBe(true);
  });

  it('warning + approaching also marks urgent=true', () => {
    const alerts = buildStormAlerts(stormAlert({ level: 'warning', trend: 'approaching' }));
    expect(alerts[0].urgent).toBe(true);
  });

  it('warning + stationary does NOT mark urgent', () => {
    const alerts = buildStormAlerts(stormAlert({ level: 'warning', trend: 'stationary' }));
    expect(alerts[0].urgent).toBe(false);
  });

  it('detail includes ETA when approaching with etaMinutes', () => {
    const alerts = buildStormAlerts(stormAlert({
      level: 'warning', trend: 'approaching', etaMinutes: 12,
    }));
    expect(alerts[0].detail).toContain('ETA ~12 min');
  });

  it('detail includes "alejándose" when receding', () => {
    const alerts = buildStormAlerts(stormAlert({ level: 'watch', trend: 'receding' }));
    expect(alerts[0].detail).toContain('alejándose');
  });
});

// ── buildStormShadowAlerts — solar drop detector to UnifiedAlert ──

function shadow(over: Partial<StormShadow>): StormShadow {
  return {
    center: [-8.1, 42.29],
    movementVector: null,
    movementSpeedKmh: null,
    movementBearing: null,
    shadowedStations: [],
    clearStations: [],
    windContext: null,
    etaMinutes: null,
    lightningNearby: 0,
    confidence: 70,
    analyzedAt: new Date(),
    ...over,
  };
}

describe('buildStormShadowAlerts — confidence + lightning gating', () => {
  it('returns empty when shadow is null', () => {
    expect(buildStormShadowAlerts(null)).toEqual([]);
  });

  it('returns empty when confidence < 40', () => {
    expect(buildStormShadowAlerts(shadow({ confidence: 30 }))).toEqual([]);
  });

  it('returns empty for clouds-only (no lightning, no wind outflow)', () => {
    // S114 rule: clouds without confirmation are NOT alerts at all
    const alerts = buildStormShadowAlerts(shadow({
      confidence: 80,
      lightningNearby: 0,
      windContext: null,
    }));
    expect(alerts).toEqual([]);
  });

  it('emits alert when lightning confirms storm', () => {
    const alerts = buildStormShadowAlerts(shadow({
      confidence: 70,
      lightningNearby: 5,
    }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe('storm-shadow');
    expect(alerts[0].icon).toBe('zap');
    expect(alerts[0].title).toContain('Tormenta');
  });

  it('emits alert when wind outflow confirms gust front (no lightning)', () => {
    const alerts = buildStormShadowAlerts(shadow({
      confidence: 50,
      lightningNearby: 0,
      windContext: {
        outflowCount: 2, gustCount: 0, anomalyCount: 0,
        avgGustKt: 0, maxGustKt: 0,
      } as StormShadow['windContext'],
    }));
    expect(alerts).toHaveLength(1);
    // No lightning, so icon/title default to "Nubes"
    expect(alerts[0].icon).toBe('cloud');
    expect(alerts[0].detail).toContain('viento de tormenta');
  });

  it('upgrades severity to high when ETA <30min', () => {
    const alerts = buildStormShadowAlerts(shadow({
      confidence: 60, lightningNearby: 3, etaMinutes: 15,
    }));
    expect(alerts[0].severity).toBe('high');
    expect(alerts[0].urgent).toBe(true); // ETA<20 is urgent
  });

  it('keeps severity moderate for distant lightning storm', () => {
    const alerts = buildStormShadowAlerts(shadow({
      confidence: 70, lightningNearby: 2, etaMinutes: 60,
    }));
    expect(alerts[0].severity).toBe('moderate');
    expect(alerts[0].urgent).toBe(false);
  });

  it('detail includes movement speed + cardinal bearing', () => {
    const alerts = buildStormShadowAlerts(shadow({
      confidence: 60, lightningNearby: 1,
      movementSpeedKmh: 25, movementBearing: 90, // east
    }));
    expect(alerts[0].detail).toContain('25 km/h');
    expect(alerts[0].detail).toContain('hacia E');
  });

  it('suppresses alert when N wind consensus dries the air (no lightning)', () => {
    // detectNorthWindConsensus check — if all stations report N wind, it's not a storm.
    // We provide readings showing N consensus (>=3 stations with dir 350-10° at 5+ m/s)
    const readings = new Map<string, NormalizedReading>([
      ['s1', mkR({ windDirection: 350, windSpeed: 6 })],
      ['s2', mkR({ windDirection: 5, windSpeed: 7 })],
      ['s3', mkR({ windDirection: 0, windSpeed: 8 })],
    ]);
    const alerts = buildStormShadowAlerts(
      shadow({ confidence: 60, lightningNearby: 0, windContext: null }),
      readings,
    );
    // Without lightning + wind outflow, this is suppressed (it's just dry N wind clouds)
    expect(alerts).toEqual([]);
  });
});

// Helper for NormalizedReading
function mkR(over: Partial<NormalizedReading>): NormalizedReading {
  return {
    stationId: 'test',
    timestamp: new Date(),
    windSpeed: null,
    windGust: null,
    windDirection: null,
    temperature: null,
    humidity: null,
    precipitation: null,
    solarRadiation: null,
    pressure: null,
    dewPoint: null,
    ...over,
  };
}
