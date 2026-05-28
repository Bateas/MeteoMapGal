/**
 * Tests for upwellingService — Galician coastal upwelling detector.
 *
 * Audit S136+3+5: this 306-line detector was UNTESTED despite now being
 * user-facing (surfaced in the ticker v2.81.74). Tests cover the public
 * API: assessUpwellingRisk (SST-drop + Ekman wind logic) and
 * buildUpwellingAlerts (UnifiedAlert shape).
 *
 * Physics recap: sustained N/NW wind (≥12kt, ≥6h) pushes surface water
 * offshore via Ekman transport → cold deep water rises → SST drops.
 * Levels: drop ≥1.5°C riesgo, ≥2.5°C alto, ≥4.0°C critico.
 */
import { describe, it, expect } from 'vitest';
import { assessUpwellingRisk, buildUpwellingAlerts } from './upwellingService';
import type { BuoyReading } from '../api/buoyClient';
import type { SSTSnapshot } from '../store/buoyStore';

const HOUR = 3600_000;

function buoy(stationId: number, waterTemp: number | null): BuoyReading {
  return {
    stationId,
    stationName: `buoy-${stationId}`,
    waterTemp,
    windSpeed: null,
    windDir: null,
    waveHeight: null,
    wavePeriod: null,
    waveDir: null,
    timestamp: new Date().toISOString(),
  } as unknown as BuoyReading;
}

/**
 * Build an SST history that spans `spanHours`, cooling linearly from
 * `startTemp` to `endTemp`. Wind applied uniformly to every snapshot.
 */
function history(opts: {
  spanHours: number;
  startTemp: number;
  endTemp: number;
  windDir?: number | null;
  windKt?: number | null;
  points?: number;
}): SSTSnapshot[] {
  const { spanHours, startTemp, endTemp, windDir = null, windKt = null, points = spanHours + 1 } = opts;
  const now = Date.now();
  const snaps: SSTSnapshot[] = [];
  for (let i = 0; i < points; i++) {
    const frac = points === 1 ? 0 : i / (points - 1);
    snaps.push({
      time: now - (spanHours * HOUR) + frac * spanHours * HOUR,
      waterTemp: startTemp + (endTemp - startTemp) * frac,
      windSpeed: windKt != null ? windKt / 1.94384 : null, // kt → m/s
      windDir,
    });
  }
  return snaps;
}

describe('assessUpwellingRisk', () => {
  it('returns none when no buoys have SST history', () => {
    const risk = assessUpwellingRisk([buoy(3221, 16)], new Map());
    expect(risk.level).toBe('none');
  });

  it('returns none when history has <2 points', () => {
    const h = new Map([[3221, history({ spanHours: 0, startTemp: 16, endTemp: 16, points: 1 })]]);
    const risk = assessUpwellingRisk([buoy(3221, 16)], h);
    expect(risk.level).toBe('none');
  });

  it('returns none when window span is below the 3h minimum', () => {
    const h = new Map([[3221, history({ spanHours: 2, startTemp: 18, endTemp: 14 })]]); // big drop but <3h
    const risk = assessUpwellingRisk([buoy(3221, 14)], h);
    expect(risk.level).toBe('none');
  });

  it('flags riesgo for a 1.5-2.5°C drop over 6h', () => {
    const h = new Map([[3221, history({ spanHours: 8, startTemp: 18, endTemp: 16.3 })]]); // -1.7°C
    const risk = assessUpwellingRisk([buoy(3221, 16.3)], h);
    expect(risk.level).toBe('riesgo');
    expect(risk.sstDelta).toBeCloseTo(-1.7, 1);
  });

  it('flags alto for a 2.5-4.0°C drop', () => {
    const h = new Map([[3221, history({ spanHours: 10, startTemp: 18, endTemp: 15 })]]); // -3°C
    const risk = assessUpwellingRisk([buoy(3221, 15)], h);
    expect(risk.level).toBe('alto');
  });

  it('flags critico for a ≥4°C drop', () => {
    const h = new Map([[3221, history({ spanHours: 12, startTemp: 19, endTemp: 14 })]]); // -5°C
    const risk = assessUpwellingRisk([buoy(3221, 14)], h);
    expect(risk.level).toBe('critico');
    expect(risk.confidence).toBeGreaterThan(50);
  });

  it('returns none when SST is stable / warming', () => {
    const h = new Map([[3221, history({ spanHours: 8, startTemp: 16, endTemp: 17 })]]); // +1°C
    const risk = assessUpwellingRisk([buoy(3221, 17)], h);
    expect(risk.level).toBe('none');
  });

  it('escalates riesgo→alto when N/NW wind ≥12kt sustained ≥6h confirms', () => {
    // -1.7°C drop (riesgo on its own) + 8h of NW 15kt wind → escalates to alto
    const h = new Map([[3221, history({
      spanHours: 8, startTemp: 18, endTemp: 16.3, windDir: 320, windKt: 15,
    })]]);
    const risk = assessUpwellingRisk([buoy(3221, 16.3)], h);
    expect(risk.level).toBe('alto');
    expect(risk.windHours).toBeGreaterThanOrEqual(6);
  });

  it('does NOT count S/SE wind as upwelling-favorable', () => {
    // Same drop but wind from the south → no wind confirmation, stays riesgo
    const h = new Map([[3221, history({
      spanHours: 8, startTemp: 18, endTemp: 16.3, windDir: 180, windKt: 15,
    })]]);
    const risk = assessUpwellingRisk([buoy(3221, 16.3)], h);
    expect(risk.level).toBe('riesgo');
    expect(risk.windHours).toBe(0);
  });

  it('picks the worst-case risk across multiple buoys', () => {
    const h = new Map([
      [3221, history({ spanHours: 8, startTemp: 17, endTemp: 16.5 })],   // -0.5 → none
      [2248, history({ spanHours: 12, startTemp: 19, endTemp: 14 })],    // -5 → critico
    ]);
    const risk = assessUpwellingRisk([buoy(3221, 16.5), buoy(2248, 14)], h);
    expect(risk.level).toBe('critico');
    expect(risk.sourceBuoy).toBe('buoy-2248');
  });

  it('skips buoys with null waterTemp', () => {
    const h = new Map([[3221, history({ spanHours: 12, startTemp: 19, endTemp: 14 })]]);
    const risk = assessUpwellingRisk([buoy(3221, null)], h);
    expect(risk.level).toBe('none');
  });
});

describe('buildUpwellingAlerts', () => {
  it('returns [] when level is none', () => {
    const h = new Map([[3221, history({ spanHours: 8, startTemp: 16, endTemp: 16.2 })]]);
    expect(buildUpwellingAlerts([buoy(3221, 16.2)], h)).toEqual([]);
  });

  it('returns a single upwelling alert when active', () => {
    const h = new Map([[3221, history({ spanHours: 12, startTemp: 19, endTemp: 14 })]]);
    const alerts = buildUpwellingAlerts([buoy(3221, 14)], h);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].category).toBe('upwelling');
    expect(alerts[0].icon).toBe('thermometer');
    expect(alerts[0].title).toContain('UPWELLING');
    expect(alerts[0].score).toBeGreaterThan(0);
  });

  it('marks critico alerts as urgent', () => {
    const h = new Map([[3221, history({ spanHours: 12, startTemp: 19, endTemp: 14 })]]);
    const alerts = buildUpwellingAlerts([buoy(3221, 14)], h);
    expect(alerts[0].urgent).toBe(true);
  });

  it('detail mentions the SST delta', () => {
    const h = new Map([[3221, history({ spanHours: 10, startTemp: 18, endTemp: 15 })]]);
    const alerts = buildUpwellingAlerts([buoy(3221, 15)], h);
    expect(alerts[0].detail).toMatch(/SST/);
  });
});
