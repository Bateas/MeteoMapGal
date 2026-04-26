/**
 * Tests for crossSeaService — cross-sea risk from wave-wind angular divergence.
 *
 * Critical: feeds Telegram alerts (Rías marine pipeline) and FieldDrawer marine UI.
 * Bug here = false danger or missed dangerous cross-sea conditions for sailors.
 */

import { describe, it, expect } from 'vitest';
import { assessCrossSeaRisk, buildCrossSeaAlerts } from './crossSeaService';
import type { BuoyReading } from '../api/buoyClient';

/** Builder helper — minimal BuoyReading with sane defaults for cross-sea tests. */
function buoy(over: Partial<BuoyReading> = {}): BuoyReading {
  return {
    stationId: 1234,
    stationName: 'Test Buoy',
    timestamp: '2026-04-26T12:00:00Z',
    waveHeight: 1.0,
    waveHeightMax: null,
    wavePeriod: 6,
    wavePeriodMean: null,
    waveDir: 270, // W
    windSpeed: 8,  // m/s — well above MIN_WIND_SPEED
    windDir: 180,  // S → 90° offset from wave (cross sea)
    windGust: null,
    waterTemp: null,
    airTemp: null,
    airPressure: null,
    currentSpeed: null,
    currentDir: null,
    salinity: null,
    seaLevel: null,
    ...over,
  };
}

// ── assessCrossSeaRisk — input gating ─────────────────────────

describe('assessCrossSeaRisk — empty / null inputs', () => {
  it('returns level=none for empty array', () => {
    const r = assessCrossSeaRisk([]);
    expect(r.level).toBe('none');
    expect(r.sourceBuoy).toBeNull();
    expect(r.hypothesis).toBe('Sin datos de boyas');
  });

  it('skips buoys without waveDir', () => {
    const r = assessCrossSeaRisk([buoy({ waveDir: null })]);
    expect(r.level).toBe('none');
    // No buoys assessed → falls through to default no-data hypothesis
    expect(r.sourceBuoy).toBeNull();
  });

  it('skips when waveHeight below MIN_WAVE_HEIGHT (0.5m)', () => {
    // 0.3m wave + 90° divergence — should NOT trigger
    const r = assessCrossSeaRisk([buoy({ waveHeight: 0.3 })]);
    expect(r.level).toBe('none');
    expect(r.hypothesis).toContain('insignificante');
  });

  it('skips when windSpeed below MIN_WIND_SPEED (3 m/s)', () => {
    const r = assessCrossSeaRisk([buoy({ windSpeed: 2 })]);
    expect(r.level).toBe('none');
    expect(r.hypothesis).toContain('Viento insuficiente');
  });

  it('returns level=none when wave-wind aligned (<45° delta)', () => {
    // wave 270, wind 260 → delta 10° → aligned
    const r = assessCrossSeaRisk([buoy({ waveDir: 270, windDir: 260 })]);
    expect(r.level).toBe('none');
    expect(r.hypothesis).toContain('alineado');
  });
});

// ── assessCrossSeaRisk — angle-based severity ─────────────────

describe('assessCrossSeaRisk — severity by angle delta', () => {
  it('triggers riesgo at 45-69° divergence', () => {
    // wave 270, wind 210 → 60° delta
    const r = assessCrossSeaRisk([
      buoy({ waveDir: 270, windDir: 210, waveHeight: 1.0, wavePeriod: 6 }),
    ]);
    expect(r.level).toBe('riesgo');
    expect(r.angleDelta).toBeCloseTo(60, 0);
  });

  it('triggers alto at 70-89° divergence', () => {
    // wave 270, wind 190 → 80° delta
    const r = assessCrossSeaRisk([
      buoy({ waveDir: 270, windDir: 190, waveHeight: 1.0, wavePeriod: 6 }),
    ]);
    expect(r.level).toBe('alto');
  });

  it('triggers critico at 90°+ divergence', () => {
    // wave 270, wind 180 → 90° delta
    const r = assessCrossSeaRisk([
      buoy({ waveDir: 270, windDir: 180, waveHeight: 1.0, wavePeriod: 6 }),
    ]);
    expect(r.level).toBe('critico');
    expect(r.angleDelta).toBeCloseTo(90, 0);
  });
});

// ── assessCrossSeaRisk — wave height amplification ────────────

describe('assessCrossSeaRisk — wave height amplification', () => {
  it('amplifies riesgo → alto when waveHeight ≥ 2.0m', () => {
    // 60° delta + 2.5m waves → riesgo upgraded to alto
    const r = assessCrossSeaRisk([
      buoy({ waveDir: 270, windDir: 210, waveHeight: 2.5, wavePeriod: 6 }),
    ]);
    expect(r.level).toBe('alto');
    expect(r.hypothesis).toContain('amplifica');
  });

  it('keeps moderate severity when waveHeight < 2.0m', () => {
    const r = assessCrossSeaRisk([
      buoy({ waveDir: 270, windDir: 210, waveHeight: 1.0, wavePeriod: 6 }),
    ]);
    expect(r.level).toBe('riesgo');
  });
});

// ── assessCrossSeaRisk — wave period (Tp) modifiers ───────────

describe('assessCrossSeaRisk — Tp swell vs wind-sea', () => {
  it('Tp ≥ 8s (swell) escalates riesgo → alto', () => {
    // 60° delta + 1m wave + 10s swell → riesgo → alto
    const r = assessCrossSeaRisk([
      buoy({ waveDir: 270, windDir: 210, waveHeight: 1.0, wavePeriod: 10 }),
    ]);
    expect(r.level).toBe('alto');
    expect(r.hypothesis).toContain('swell');
  });

  it('Tp ≥ 8s (swell) escalates alto → critico', () => {
    // 80° delta + 1m + 10s swell → alto → critico
    const r = assessCrossSeaRisk([
      buoy({ waveDir: 270, windDir: 190, waveHeight: 1.0, wavePeriod: 10 }),
    ]);
    expect(r.level).toBe('critico');
  });

  it('Tp < 4s (wind-sea) downgrades riesgo → none', () => {
    // 60° delta + 1m + 3s wind-sea → riesgo downgraded to none
    const r = assessCrossSeaRisk([
      buoy({ waveDir: 270, windDir: 210, waveHeight: 1.0, wavePeriod: 3 }),
    ]);
    expect(r.level).toBe('none');
    expect(r.hypothesis).toContain('mar de viento');
  });

  it('Tp < 4s (wind-sea) downgrades alto → riesgo', () => {
    // 80° delta + 1m + 3s wind-sea → alto downgraded to riesgo
    const r = assessCrossSeaRisk([
      buoy({ waveDir: 270, windDir: 190, waveHeight: 1.0, wavePeriod: 3 }),
    ]);
    expect(r.level).toBe('riesgo');
  });
});

// ── assessCrossSeaRisk — multiple buoys → worst case ──────────

describe('assessCrossSeaRisk — worst case across buoys', () => {
  it('returns the highest severity buoy', () => {
    const r = assessCrossSeaRisk([
      buoy({ stationName: 'Calm', waveDir: 270, windDir: 260, waveHeight: 0.6 }),
      buoy({ stationName: 'Cross', waveDir: 270, windDir: 180, waveHeight: 1.5, wavePeriod: 6 }),
    ]);
    expect(r.level).toBe('critico');
    expect(r.sourceBuoy).toBe('Cross');
  });
});

// ── buildCrossSeaAlerts — UnifiedAlert construction ───────────

describe('buildCrossSeaAlerts', () => {
  it('returns [] when level=none', () => {
    expect(buildCrossSeaAlerts([])).toEqual([]);
    expect(buildCrossSeaAlerts([buoy({ waveHeight: 0.2 })])).toEqual([]);
  });

  it('emits UnifiedAlert with category=marine', () => {
    const alerts = buildCrossSeaAlerts([
      buoy({ stationName: 'Vigo', waveDir: 270, windDir: 180, waveHeight: 1.5, wavePeriod: 6 }),
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe('cross-sea');
    expect(alerts[0].category).toBe('marine');
    expect(alerts[0].icon).toBe('waves');
  });

  it('score scales with severity (critico ≥ 80)', () => {
    const alerts = buildCrossSeaAlerts([
      buoy({ stationName: 'Vigo', waveDir: 270, windDir: 180, waveHeight: 1.5, wavePeriod: 6 }),
    ]);
    expect(alerts[0].score).toBeGreaterThanOrEqual(80);
    expect(alerts[0].severity).toBe('critical');
  });

  it('marks urgent=true for critico level', () => {
    const alerts = buildCrossSeaAlerts([
      buoy({ stationName: 'Vigo', waveDir: 270, windDir: 180, waveHeight: 1.5, wavePeriod: 6 }),
    ]);
    expect(alerts[0].urgent).toBe(true);
    expect(alerts[0].title).toBe('MAR CRUZADA PELIGROSA');
  });

  it('marks urgent=false for non-critico levels', () => {
    // 60° delta, 1m, 6s Tp → riesgo
    const alerts = buildCrossSeaAlerts([
      buoy({ stationName: 'Vigo', waveDir: 270, windDir: 210, waveHeight: 1.0, wavePeriod: 6 }),
    ]);
    expect(alerts[0].urgent).toBe(false);
    expect(alerts[0].title).toBe('Mar cruzada moderada');
  });

  it('detail includes angle, buoy name, wave height', () => {
    const alerts = buildCrossSeaAlerts([
      buoy({ stationName: 'Cabo Vigo', waveDir: 270, windDir: 180, waveHeight: 1.5, wavePeriod: 6 }),
    ]);
    expect(alerts[0].detail).toContain('90°');
    expect(alerts[0].detail).toContain('Cabo Vigo');
    expect(alerts[0].detail).toContain('1.5m');
  });

  it('downgrades 2 levels for ocean buoys (Cabo Silleiro)', () => {
    // Cabo Silleiro at 'critico' downgrades to 'riesgo' (2 levels)
    const alerts = buildCrossSeaAlerts([
      buoy({ stationName: 'Cabo Silleiro', waveDir: 270, windDir: 180, waveHeight: 1.5, wavePeriod: 6 }),
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].score).toBe(30); // riesgo score
    expect(alerts[0].title).toBe('Mar cruzada moderada');
  });

  it('suppresses ocean buoy alerts at alto level (downgrade → none)', () => {
    // Cabo Silleiro at 'alto' downgrades to 'none' → empty array
    const alerts = buildCrossSeaAlerts([
      buoy({ stationName: 'Ons', waveDir: 270, windDir: 190, waveHeight: 1.0, wavePeriod: 6 }),
    ]);
    expect(alerts).toEqual([]);
  });
});
