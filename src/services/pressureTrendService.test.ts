/**
 * Tests for pressureTrendService — 3h barometric pressure consensus alerts.
 *
 * Critical: feeds Telegram alert pipeline (storm precursor) and FieldDrawer
 * pressure tile. A bug here = missed "bomba barométrica" or false alarms.
 *
 * Uses fake timers because the service compares Date.now() to history timestamps.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { computePressureTrends, buildPressureTrendAlerts } from './pressureTrendService';
import type { NormalizedReading } from '../types/station';

const NOW = new Date('2026-04-26T12:00:00Z').getTime();

/** Builder for NormalizedReading at a given offset (ms before NOW). */
function reading(stationId: string, pressure: number | null, msAgo: number): NormalizedReading {
  return {
    stationId,
    timestamp: new Date(NOW - msAgo),
    windSpeed: null,
    windGust: null,
    windDirection: null,
    temperature: null,
    humidity: null,
    precipitation: null,
    solarRadiation: null,
    pressure,
    dewPoint: null,
  };
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── computePressureTrends — input gating ─────────────────────

describe('computePressureTrends — empty / invalid inputs', () => {
  it('returns empty result for empty inputs', () => {
    const r = computePressureTrends(new Map(), new Map());
    expect(r.trends).toEqual([]);
    expect(r.medianDelta).toBe(0);
    expect(r.droppingCount).toBe(0);
    expect(r.totalAnalyzed).toBe(0);
  });

  it('skips station without history', () => {
    const cur = new Map([['s1', reading('s1', 1015, 0)]]);
    const r = computePressureTrends(cur, new Map());
    expect(r.totalAnalyzed).toBe(0);
  });

  it('skips station whose current reading lacks pressure', () => {
    const cur = new Map([['s1', reading('s1', null, 0)]]);
    const hist = new Map([['s1', [reading('s1', 1018, 3 * HOUR)]]]);
    const r = computePressureTrends(cur, hist);
    expect(r.totalAnalyzed).toBe(0);
  });

  it('skips station with stale current reading (>30 min old)', () => {
    const cur = new Map([['s1', reading('s1', 1015, 45 * MIN)]]);
    const hist = new Map([['s1', [reading('s1', 1018, 3 * HOUR)]]]);
    const r = computePressureTrends(cur, hist);
    expect(r.totalAnalyzed).toBe(0);
  });

  it('skips station with <2 history readings in window', () => {
    const cur = new Map([['s1', reading('s1', 1015, 0)]]);
    const hist = new Map([['s1', [reading('s1', 1018, 3 * HOUR)]]]);
    const r = computePressureTrends(cur, hist);
    expect(r.totalAnalyzed).toBe(0);
  });

  it('skips station with <30min time span', () => {
    const cur = new Map([['s1', reading('s1', 1015, 0)]]);
    // Two readings but both within last 20 min → span too short
    const hist = new Map([['s1', [
      reading('s1', 1016, 10 * MIN),
      reading('s1', 1018, 20 * MIN),
    ]]]);
    const r = computePressureTrends(cur, hist);
    expect(r.totalAnalyzed).toBe(0);
  });
});

// ── computePressureTrends — happy path ───────────────────────

describe('computePressureTrends — trend detection', () => {
  it('detects rapid drop (≥3 hPa in 3h)', () => {
    const cur = new Map([['s1', reading('s1', 1010, 0)]]);
    const hist = new Map([['s1', [
      reading('s1', 1014, 2.5 * HOUR),
      reading('s1', 1012, 1 * HOUR),
    ]]]);
    const r = computePressureTrends(cur, hist);
    expect(r.totalAnalyzed).toBe(1);
    expect(r.trends[0].deltaHPa).toBeCloseTo(-4, 1);
    expect(r.droppingCount).toBe(1);
  });

  it('detects stable pressure (delta near 0)', () => {
    const cur = new Map([['s1', reading('s1', 1015, 0)]]);
    const hist = new Map([['s1', [
      reading('s1', 1015.2, 2.5 * HOUR),
      reading('s1', 1015.1, 1 * HOUR),
    ]]]);
    const r = computePressureTrends(cur, hist);
    expect(r.totalAnalyzed).toBe(1);
    expect(Math.abs(r.trends[0].deltaHPa)).toBeLessThan(1);
    expect(r.droppingCount).toBe(0);
  });

  it('detects rapid rise (positive delta)', () => {
    const cur = new Map([['s1', reading('s1', 1018, 0)]]);
    const hist = new Map([['s1', [
      reading('s1', 1014, 2.5 * HOUR),
      reading('s1', 1016, 1 * HOUR),
    ]]]);
    const r = computePressureTrends(cur, hist);
    expect(r.trends[0].deltaHPa).toBeCloseTo(4, 1);
    expect(r.droppingCount).toBe(0); // not dropping
  });

  it('uses oldest reading in 3h window as baseline', () => {
    const cur = new Map([['s1', reading('s1', 1010, 0)]]);
    const hist = new Map([['s1', [
      reading('s1', 1020, 5 * HOUR),  // outside window — ignored
      reading('s1', 1015, 2.5 * HOUR), // oldest IN window
      reading('s1', 1012, 1 * HOUR),
    ]]]);
    const r = computePressureTrends(cur, hist);
    // Delta = 1010 - 1015 = -5 (NOT 1010 - 1020 = -10)
    expect(r.trends[0].deltaHPa).toBeCloseTo(-5, 1);
  });

  it('computes median across multiple stations with varying deltas', () => {
    // Stations show drops of -4, -3, -2 hPa → sorted ascending: [-4, -3, -2]
    // medianDelta = sorted[Math.floor(3/2)] = sorted[1] = -3
    const cur = new Map([
      ['s1', reading('s1', 1010, 0)], // delta -4
      ['s2', reading('s2', 1011, 0)], // delta -3
      ['s3', reading('s3', 1012, 0)], // delta -2
    ]);
    const hist = new Map([
      ['s1', [reading('s1', 1014, 2.5 * HOUR), reading('s1', 1012, 1 * HOUR)]],
      ['s2', [reading('s2', 1014, 2.5 * HOUR), reading('s2', 1012, 1 * HOUR)]],
      ['s3', [reading('s3', 1014, 2.5 * HOUR), reading('s3', 1013, 1 * HOUR)]],
    ]);
    const r = computePressureTrends(cur, hist);
    expect(r.totalAnalyzed).toBe(3);
    expect(r.medianDelta).toBeCloseTo(-3, 1);
    expect(r.droppingCount).toBe(3); // all ≥2 hPa drop
  });
});

// ── buildPressureTrendAlerts — consensus + severity ───────────

/** Build N stations all dropping by the same amount over 3h. */
function dropping(n: number, deltaHPa: number) {
  const cur = new Map<string, NormalizedReading>();
  const hist = new Map<string, NormalizedReading[]>();
  const startPressure = 1015 - deltaHPa; // since delta=current-old, old=current-delta
  for (let i = 0; i < n; i++) {
    const id = `s${i}`;
    cur.set(id, reading(id, 1015, 0));
    hist.set(id, [
      reading(id, startPressure, 2.5 * HOUR),
      reading(id, 1015 + deltaHPa / 2, 1 * HOUR),
    ]);
  }
  return { cur, hist };
}

describe('buildPressureTrendAlerts', () => {
  it('returns [] when fewer than MIN_STATIONS analyzed', () => {
    const { cur, hist } = dropping(1, -4);
    expect(buildPressureTrendAlerts(cur, hist)).toEqual([]);
  });

  it('returns [] when fewer than 2 stations show drop', () => {
    // 3 stations analyzed but only 1 dropping ≥2 hPa
    const cur = new Map([
      ['s1', reading('s1', 1010, 0)], // delta -4 (dropping)
      ['s2', reading('s2', 1015, 0)], // delta 0 (stable)
      ['s3', reading('s3', 1015.5, 0)], // delta +0.5 (stable)
    ]);
    const hist = new Map([
      ['s1', [reading('s1', 1014, 2.5 * HOUR), reading('s1', 1012, 1 * HOUR)]],
      ['s2', [reading('s2', 1015, 2.5 * HOUR), reading('s2', 1015, 1 * HOUR)]],
      ['s3', [reading('s3', 1015, 2.5 * HOUR), reading('s3', 1015, 1 * HOUR)]],
    ]);
    expect(buildPressureTrendAlerts(cur, hist)).toEqual([]);
  });

  it('emits critical alert for ≥4 hPa median drop', () => {
    const { cur, hist } = dropping(3, -4);
    const alerts = buildPressureTrendAlerts(cur, hist);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe('pressure-trend');
    expect(alerts[0].category).toBe('pressure');
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].score).toBeGreaterThanOrEqual(75);
    expect(alerts[0].title).toBe('Caída barométrica rápida');
    expect(alerts[0].urgent).toBe(true);
  });

  it('emits high-severity alert for ≥3 hPa median drop', () => {
    const { cur, hist } = dropping(3, -3);
    const alerts = buildPressureTrendAlerts(cur, hist);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('high');
    expect(alerts[0].score).toBeGreaterThanOrEqual(50);
    expect(alerts[0].score).toBeLessThan(75);
    expect(alerts[0].title).toBe('Presión en descenso');
    expect(alerts[0].urgent).toBe(false);
  });

  it('emits info-severity alert for moderate drop with majority consensus', () => {
    const { cur, hist } = dropping(3, -2);
    const alerts = buildPressureTrendAlerts(cur, hist);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('info');
    expect(alerts[0].title).toBe('Tendencia barométrica');
    expect(alerts[0].score).toBeGreaterThanOrEqual(25);
    expect(alerts[0].score).toBeLessThan(50);
  });

  it('detail includes hPa drop and station consensus count', () => {
    const { cur, hist } = dropping(3, -4);
    const alerts = buildPressureTrendAlerts(cur, hist);
    expect(alerts[0].detail).toContain('hPa');
    expect(alerts[0].detail).toContain('3/3');
  });

  it('icon is gauge for all pressure alerts', () => {
    const { cur, hist } = dropping(3, -4);
    const alerts = buildPressureTrendAlerts(cur, hist);
    expect(alerts[0].icon).toBe('gauge');
  });

  it('returns [] for stable pressure across the network', () => {
    const { cur, hist } = dropping(3, 0);
    expect(buildPressureTrendAlerts(cur, hist)).toEqual([]);
  });
});
