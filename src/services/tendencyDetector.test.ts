/**
 * Tests for tendencyDetector — thermal-wind onset early warning.
 *
 * `now` is injectable, so we freeze it to a thermal-window instant
 * (July, afternoon) and build reading histories relative to it.
 * Focus: window gating, the 5 scored precursors, level thresholds,
 * and onset estimation — not exact internal point values.
 */
import { describe, it, expect } from 'vitest';
import { detectTendency } from './tendencyDetector';
import type { NormalizedReading } from '../types/station';
import type { DailyContext, MicroZoneId } from '../types/thermal';

const ZONE: MicroZoneId = 'embalse';
// July 15, 14:00 local → month 7, hour 14 → inside thermal window.
const NOW = new Date('2026-07-15T14:00:00');

function reading(over: Partial<NormalizedReading> = {}, ageMin = 0): NormalizedReading {
  return {
    stationId: 's',
    timestamp: new Date(NOW.getTime() - ageMin * 60_000),
    windSpeed: 3, windGust: null, windDirection: 270,
    temperature: 30, humidity: 50, precipitation: 0,
    solarRadiation: 800, pressure: 1015, dewPoint: 12,
    ...over,
  };
}

/** A station history (now, -1h, -2h) with rising temp + falling humidity. */
function thermalHistory(): NormalizedReading[] {
  return [
    reading({ temperature: 20, humidity: 70 }, 120),
    reading({ temperature: 23, humidity: 60 }, 60),
    reading({ temperature: 25, humidity: 50 }, 0),
  ];
}

const ctx = (deltaT: number | null): DailyContext => ({ tempMax: null, tempMin: null, deltaT });

describe('detectTendency — window gating', () => {
  it('returns empty signal before 8h', () => {
    const t = new Date('2026-07-15T06:00:00');
    const s = detectTendency(ZONE, [reading()], [thermalHistory()], ctx(20), t);
    expect(s.level).toBe('none');
    expect(s.score).toBe(0);
    expect(s.summary).toMatch(/Fuera de ventana/);
  });

  it('returns empty signal outside thermal months (e.g. January)', () => {
    const t = new Date('2026-01-15T14:00:00');
    const s = detectTendency(ZONE, [reading()], [thermalHistory()], ctx(20), t);
    expect(s.level).toBe('none');
    expect(s.summary).toMatch(/Fuera de ventana/);
  });

  it('returns empty signal when current temperature is missing', () => {
    const s = detectTendency(ZONE, [reading({ temperature: null })], [thermalHistory()], ctx(20), NOW);
    expect(s.level).toBe('none');
    expect(s.score).toBe(0);
  });

  it('returns empty signal when current wind direction is missing', () => {
    const s = detectTendency(ZONE, [reading({ windDirection: null })], [thermalHistory()], ctx(20), NOW);
    expect(s.level).toBe('none');
  });
});

describe('detectTendency — active thermal (all signals firing)', () => {
  const s = detectTendency(
    ZONE,
    [reading({ temperature: 30, humidity: 50, windDirection: 270 })],
    [thermalHistory(), thermalHistory()],
    ctx(22),
    NOW,
  );

  it('scores high and reports active level', () => {
    expect(s.score).toBeGreaterThanOrEqual(70);
    expect(s.level).toBe('active');
  });

  it('flags wind in the thermal sector with full direction score', () => {
    expect(s.precursors.windInSector).toBe(true);
    expect(s.precursors.windDirScore).toBe(25);
  });

  it('detects a positive temperature rise rate', () => {
    expect(s.precursors.tempRiseRate).not.toBeNull();
    expect(s.precursors.tempRiseRate!).toBeGreaterThan(0);
    expect(s.precursors.tempRiseScore).toBeGreaterThan(0);
  });

  it('awards full ΔT score when ΔT ≥ 20°C', () => {
    expect(s.precursors.deltaTScore).toBe(15);
  });

  it('awards full temperature score when T ≥ 28°C', () => {
    expect(s.precursors.tempScore).toBe(15);
    expect(s.precursors.tempAboveThreshold).toBe(true);
  });

  it('does not estimate onset when already active', () => {
    expect(s.estimatedOnsetMin).toBeNull();
  });
});

describe('detectTendency — precursor isolation', () => {
  it('wind outside thermal sector (E) → not in sector', () => {
    const s = detectTendency(ZONE, [reading({ windDirection: 90 })], [], ctx(null), NOW);
    expect(s.precursors.windInSector).toBe(false);
    expect(s.precursors.windDirScore).toBeLessThan(25);
  });

  it('ΔT below 8°C contributes zero ΔT score', () => {
    const s = detectTendency(ZONE, [reading()], [], ctx(5), NOW);
    expect(s.precursors.deltaTScore).toBe(0);
  });

  it('temperature below 24°C contributes zero temperature score', () => {
    const s = detectTendency(ZONE, [reading({ temperature: 22 })], [], ctx(null), NOW);
    expect(s.precursors.tempScore).toBe(0);
    expect(s.precursors.tempAboveThreshold).toBe(false);
  });

  it('null daily context → ΔT score zero (no crash)', () => {
    const s = detectTendency(ZONE, [reading()], [], null, NOW);
    expect(s.precursors.deltaTScore).toBe(0);
  });
});

describe('detectTendency — building level + onset estimate', () => {
  // Morning (12h), wind already W (25) + warm-ish temp, no history trend,
  // no ΔT → lands in the building band (30-49) which triggers onset estimate.
  const morning = new Date('2026-07-15T12:00:00');
  const s = detectTendency(
    ZONE,
    [reading({ temperature: 26, humidity: 80, windDirection: 270 })],
    [],
    ctx(null),
    morning,
  );

  it('lands in the building band', () => {
    expect(s.score).toBeGreaterThanOrEqual(30);
    expect(s.score).toBeLessThan(70);
    expect(['building', 'likely']).toContain(s.level);
  });

  it('estimates a positive onset time when building before the peak hour', () => {
    expect(s.estimatedOnsetMin).not.toBeNull();
    expect(s.estimatedOnsetMin!).toBeGreaterThan(0);
  });

  it('stamps computedAt with the injected clock', () => {
    expect(s.computedAt.getTime()).toBe(morning.getTime());
  });
});
