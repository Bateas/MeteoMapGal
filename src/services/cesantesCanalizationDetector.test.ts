/**
 * Tests for cesantesCanalizationDetector — predicts local SW wind boost
 * in sheltered Cesantes valley (where preferred MG stations subvaloran).
 *
 * One mode: the afternoon thermal breeze. The synoptic mode fed by the mouth buoys
 * was deleted (it never decided a field-truth instant correctly). Rain at the nearby
 * stations vetoes the breeze. The engine applies the prediction when it is ≥4kt
 * over the measured wind.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { predictCesantesCanalization } from './cesantesCanalizationDetector';
import type { RainVeto } from './rainVeto';

// ── Thermal breeze (Apr-Oct, 12-20h, ΔT≥2°C, air≥16°C) ──

describe('predictCesantesCanalization — thermal breeze', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires in thermal window with required conditions', () => {
    vi.setSystemTime(new Date('2026-04-26T15:00:00Z')); // 15h, in window
    const r = predictCesantesCanalization(
      18, // airTempLocal warm enough
      14, // waterTemp → ΔT = 4°C
      6,  // localStationKt baseline
    );
    expect(r.active).toBe(true);
    expect(r.predictedDir).toBe(230);
    expect(r.confidence).toBe(70);
    expect(r.signals.some((s) => s.includes('Brisa térmica'))).toBe(true);
  });

  it('does NOT fire when measured wind is meaningful and OUTSIDE the SW arc (N/NW)', () => {
    vi.setSystemTime(new Date('2026-04-26T15:00:00Z')); // thermal hour
    // Conditions met, but the real wind is NW 320° at 8kt → SW thermal not
    // establishing (islands block N/NW from reaching Cesantes) → no boost.
    const r = predictCesantesCanalization(18, 14, 8, 320);
    expect(r.active).toBe(false);
  });

  it('still fires when measured wind IS within the SW arc (230°)', () => {
    vi.setSystemTime(new Date('2026-04-26T15:00:00Z'));
    const r = predictCesantesCanalization(18, 14, 8, 230);
    expect(r.active).toBe(true);
  });

  it('suppresses when nearby stations are calm (<5kt) — thermal breeze not established', () => {
    vi.setSystemTime(new Date('2026-04-26T15:00:00Z'));
    // Regression (user-reported): 3kt measured + a huge ΔT (air 28 / water 16.6)
    // must NOT yield a phantom ~11kt while the ría webcam is mirror-flat. A large
    // ΔT is only the setup; with no measured breeze there is nothing to canalize.
    const r = predictCesantesCanalization(28, 16.6, 3, 230);
    expect(r.active).toBe(false);
  });

  it('does NOT fire outside thermal window (early morning)', () => {
    vi.setSystemTime(new Date('2026-04-26T07:00:00Z')); // 07h
    const r = predictCesantesCanalization(18, 14, 6);
    expect(r.active).toBe(false);
  });

  it('does NOT fire after thermal window (night)', () => {
    vi.setSystemTime(new Date('2026-04-26T22:00:00Z')); // 22h
    const r = predictCesantesCanalization(18, 14, 6);
    expect(r.active).toBe(false);
  });

  it('requires ΔT ≥2°C', () => {
    vi.setSystemTime(new Date('2026-04-26T15:00:00Z'));
    const r = predictCesantesCanalization(18, 17, 6); // ΔT=1
    expect(r.active).toBe(false);
  });

  it('requires airTemp ≥16°C', () => {
    vi.setSystemTime(new Date('2026-04-26T15:00:00Z'));
    const r = predictCesantesCanalization(14, 10, 6); // air<16
    expect(r.active).toBe(false);
  });

  it('suppresses when no nearby station wind is available — cannot confirm the breeze', () => {
    vi.setSystemTime(new Date('2026-04-26T15:00:00Z'));
    // No localStationKt = no measured wind to confirm the breeze is blowing, so a
    // big ΔT alone must not conjure a prediction.
    const r = predictCesantesCanalization(18, 14);
    expect(r.active).toBe(false);
  });

  it('fires when a real breeze (>=5kt) is present with favourable ΔT', () => {
    vi.setSystemTime(new Date('2026-04-26T15:00:00Z'));
    // 6kt measured + ΔT 4°C → boost applies (breeze established, something to canalize).
    const r = predictCesantesCanalization(18, 14, 6);
    expect(r.active).toBe(true);
    expect(r.predictedKt).toBeGreaterThanOrEqual(10);
  });

  it('marks severity=high when predictedKt ≥15', () => {
    vi.setSystemTime(new Date('2026-04-26T15:00:00Z'));
    // baseKt 8 + ΔT 5°C × 2 = +8 (capped), breeze established (12kt gust) → 16kt
    const r = predictCesantesCanalization(20, 15, 8, 230, null, 12);
    expect(r.severity).toBe('high');
  });

  it('fires when mean is ~4kt but ΔT is strong (≥4°C)', () => {
    vi.setSystemTime(new Date('2026-04-26T15:00:00Z'));
    // 4kt measured + ΔT 6°C (air 24, water 18), no gust known → three quarters of the boost
    const r = predictCesantesCanalization(24, 18, 4.2, 230);
    expect(r.active).toBe(true);
    expect(r.predictedKt).toBe(10);
  });

  it('fires when sheltered mean is <5kt BUT gust is active (≥10kt) with strong ΔT (today scenario)', () => {
    vi.setSystemTime(new Date('2026-09-21T15:00:00Z'));
    // Real-world late September case: air 31°C, water 20°C (ΔT=11°C), mean 4.8kt, gust 12kt
    const r = predictCesantesCanalization(31, 20, 4.8, 234, null, 12);
    expect(r.active).toBe(true);
    expect(r.predictedKt).toBe(13); // 5 base + 8 capped boost = 13kt
    expect(r.predictedDir).toBe(230);
  });

  it('strictly caps the thermal breeze at 17kt max to avoid over-boosting on normal days', () => {
    vi.setSystemTime(new Date('2026-04-26T15:00:00Z'));
    // 10kt base + ΔT 8°C (*2 = +16) -> must cap at 17kt, never 26kt
    const r = predictCesantesCanalization(28, 20, 10, 230, null, 14);
    expect(r.active).toBe(true);
    expect(r.predictedKt).toBe(17);
  });

  // ── The low-mean branches need a known SW direction ──────────
  //
  // The out-of-arc guard only rejects a wind of 5kt or more, which is exactly
  // NOT the case the two low-mean branches (strong ΔT, gust) exist for.
  // Reproduced 21-sep: a 3kt NORTH wind with an 11kt gust on a hot afternoon
  // came back as a 13kt SW canalization at 70% confidence. With N/NW the spot
  // is sheltered and does not follow the entry pattern of the mouth. With a
  // low mean, the direction is what tells a breeze filling in from a stray
  // puff, so it has to be known and inside the arc.
  describe('low-mean branches need a known SW direction', () => {
    beforeEach(() => vi.setSystemTime(new Date('2026-09-21T15:00:00Z')));

    it('does NOT fire on a north wind carried by the gust branch', () => {
      const r = predictCesantesCanalization(31, 20, 3, 350, null, 11);
      expect(r.active).toBe(false);
      expect(r.predictedKt).toBeNull();
    });

    it('does NOT fire on a north wind carried by the strong-ΔT branch', () => {
      const r = predictCesantesCanalization(24, 18, 4.5, 0);
      expect(r.active).toBe(false);
    });

    it('does NOT fire with an unknown direction and a gust', () => {
      const r = predictCesantesCanalization(31, 20, 3, null, null, 11);
      expect(r.active).toBe(false);
    });

    it('does NOT fire with an unknown direction and a strong ΔT', () => {
      const r = predictCesantesCanalization(24, 18, 4.5, null);
      expect(r.active).toBe(false);
    });

    it('does NOT fire on a gust alone when there is no measured mean', () => {
      // The gust branch rescues a LOW mean; with no mean at all there is
      // nothing it is rescuing, only one reading and a temperature.
      const r = predictCesantesCanalization(31, 20, null, 230, null, 11);
      expect(r.active).toBe(false);
    });

    it('accepts both edges of the arc exactly', () => {
      for (const dir of [160, 315]) {
        expect(predictCesantesCanalization(31, 20, 3, dir, null, 11).active).toBe(true);
        expect(predictCesantesCanalization(24, 18, 4.5, dir).active).toBe(true);
      }
    });

    it('rejects a direction just outside either edge', () => {
      for (const dir of [159, 316]) {
        expect(predictCesantesCanalization(31, 20, 3, dir, null, 11).active).toBe(false);
        expect(predictCesantesCanalization(24, 18, 4.5, dir).active).toBe(false);
      }
    });

    it('still fires on the real 21-sep afternoon (SW 234, mean 4.8, gust 12)', () => {
      const r = predictCesantesCanalization(31, 20, 4.8, 234, null, 12);
      expect(r.active).toBe(true);
      expect(r.predictedKt).toBe(13);
      expect(r.predictedDir).toBe(230);
    });
  });

  // ── The signal text says what the stations measured ──────────
  //
  // It used to print the synthetic 5kt floor the boost is built on, so a 3kt
  // reading was reported to the user as "leen 5kt".
  describe('signal text reports what the stations measured', () => {
    beforeEach(() => vi.setSystemTime(new Date('2026-09-21T15:00:00Z')));

    it('states the measured mean and the gust that confirmed the breeze', () => {
      const r = predictCesantesCanalization(31, 20, 4.8, 234, null, 12);
      const line = r.signals.find((s) => s.startsWith('Estaciones cercanas'))!;
      expect(line).toContain('4.8kt de media');
      expect(line).toContain('racha de 12kt');
      expect(line).not.toContain('leen 5kt');
    });

    it('states a gust-confirmed mean even when it is far below the floor', () => {
      const r = predictCesantesCanalization(31, 20, 3, 230, null, 11);
      const line = r.signals.find((s) => s.startsWith('Estaciones cercanas'))!;
      expect(line).toContain('3.0kt de media');
      expect(line).toContain('racha de 11kt');
    });

    it('states the measured low mean when a strong ΔT confirmed it, without a gust', () => {
      const r = predictCesantesCanalization(24, 18, 4.2, 230);
      const line = r.signals.find((s) => s.startsWith('Estaciones cercanas'))!;
      expect(line).toContain('4.2kt de media');
      expect(line).not.toContain('racha');
    });

    it('states the measured mean on an ordinary breeze', () => {
      const r = predictCesantesCanalization(18, 14, 6);
      const line = r.signals.find((s) => s.startsWith('Estaciones cercanas'))!;
      expect(line).toContain('leen 6kt de media');
      expect(line).not.toContain('racha');
    });
  });
});

// ── Output shape ──────────────────────────────────────────────

describe('predictCesantesCanalization — output shape', () => {
  afterEach(() => vi.useRealTimers());

  it('returns the full CesantesPrediction shape on an active thermal breeze', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 26, 15, 0)); // local 15h
    const r = predictCesantesCanalization(18, 14, 6);
    expect(r.active).toBe(true);
    expect(r).toHaveProperty('active');
    expect(r).toHaveProperty('confidence');
    expect(r).toHaveProperty('predictedKt');
    expect(r).toHaveProperty('predictedDir');
    expect(r).toHaveProperty('boostFactor');
    expect(r).toHaveProperty('signals');
    expect(r).toHaveProperty('severity');
    expect(Array.isArray(r.signals)).toBe(true);
    expect(['info', 'moderate', 'high']).toContain(r.severity);
  });

  it('returns the same shape, inactive, with no inputs at all', () => {
    const r = predictCesantesCanalization();
    expect(r).toEqual({
      active: false, confidence: 0, predictedKt: null, predictedDir: null,
      boostFactor: 1, signals: [], severity: 'info',
    });
  });
});

// ── Ground truth: 25-sep afternoon at Cesantes ──────────────────
//
// A sailor watched the tmkites webcam all afternoon and reported the wind on the water
// (moored boats, wings and kites). Inputs are what the spot's stations read at that moment
// (mean, nearest gust, consensus direction, air temperature; water 16.5). The rule: the figure
// the app shows must sit within 3kt of what was on the water, on the way up and on the way
// down. The old rule said calm until 16:47 with 10-12kt out there, then 15kt with 12.5.
describe('Cesantes 25-sep: what the app shows vs what was on the water', () => {
  afterEach(() => vi.useRealTimers());
  const cases: { at: [number, number]; kt: number; gust: number | null; dir: number; air: number; water: number; sun?: number }[] = [
    { at: [12, 53], kt: 2, gust: 5, dir: 320, air: 19.6, water: 2 },
    { at: [13, 32], kt: 3, gust: 8, dir: 310, air: 20.9, water: 5 },
    { at: [14, 8], kt: 4, gust: 8, dir: 290, air: 21.8, water: 7.5 },
    { at: [15, 16], kt: 4, gust: 10, dir: 314, air: 23.5, water: 11 },
    { at: [17, 22], kt: 4, gust: 11, dir: 255, air: 24.2, water: 14 },
    { at: [18, 4], kt: 6, gust: 15, dir: 238, air: 23.8, water: 12.5 },
    { at: [18, 11], kt: 4, gust: null, dir: 241, air: 23.8, water: 12.5 },
    // Dusk: the breeze had left the inner ria (5.5kt at 20:19) and the interior was dark.
    { at: [20, 28], kt: 4, gust: 11, dir: 308, air: 21, water: 5.5, sun: 0 },
  ];
  for (const c of cases) {
    it(`${c.at[0]}:${String(c.at[1]).padStart(2, '0')} — water ${c.water}kt`, () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 8, 25, c.at[0], c.at[1])); // local clock: the rule reads local hours
      const r = predictCesantesCanalization(c.air, 16.5, c.kt, c.dir, c.sun ?? 700, c.gust);
      const shown = r.active && r.predictedKt != null ? r.predictedKt : c.kt;
      expect(Math.abs(shown - c.water)).toBeLessThanOrEqual(3);
    });
  }
});

// ── The thermal breeze stops when the interior sun is gone (25-sep dusk) ─────
//
// After sunset the air cools slowly, so ΔT stays at 4-5°C, and hour 20 counts until 20:59.
// A 4kt residual flow at the edge of the arc was handed the full +8kt: BUENO 13kt at 20:28
// with 5.5kt on the water (webcam) and interior radiation at 0 W/m².
describe('predictCesantesCanalization — needs the interior sun', () => {
  afterEach(() => vi.useRealTimers());
  const at = (h: number, m: number) => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 25, h, m)); };

  it('25-sep 20:28: 4kt at 308°, 11kt gust, ΔT 4.1, interior 0 W/m² gives no boost', () => {
    at(20, 28);
    expect(predictCesantesCanalization(21, 16.9, 4.0, 308, 0, 11.1).active).toBe(false);
  });

  it('the same inputs with the interior still sunny keep the boost: the veto is the sun, not the hour', () => {
    at(20, 28);
    const r = predictCesantesCanalization(21, 16.9, 4.0, 308, 400, 11.1);
    expect(r.active).toBe(true);
    expect(r.predictedKt).toBe(13);
  });

  it('switches at the threshold: 150 W/m² keeps it, 149 does not', () => {
    at(19, 20);
    expect(predictCesantesCanalization(23, 16.2, 5.0, 246, 150, 13).active).toBe(true);
    expect(predictCesantesCanalization(23, 16.2, 5.0, 246, 149, 13).active).toBe(false);
  });

  it('unknown interior sun does not veto: a silent radiometer must not kill the 15h breeze', () => {
    at(15, 16);
    const r = predictCesantesCanalization(26, 16.9, 3.8, 301, null, 11.1);
    expect(r.active).toBe(true);
    expect(r.predictedKt).toBe(13);
  });

  it('keeps the 18:04 breeze (12.5kt on the water, interior 410 W/m²)', () => {
    at(18, 4);
    const r = predictCesantesCanalization(25, 16.2, 5.2, 245, 410, 15);
    expect(r.active).toBe(true);
    expect(Math.abs((r.predictedKt ?? 0) - 12.5)).toBeLessThanOrEqual(3);
  });
});

// ── Real instants, and the rain veto ─────────────────────────────
//
// Inputs are what the engine handed the detector at those instants (air, water, mean,
// direction, interior sun, nearby gust). 4-ago 12:38 is the instant the deleted synoptic
// mode got most wrong: 17kt announced with 2kt on the water.
describe('predictCesantesCanalization — real instants and the rain veto', () => {
  afterEach(() => vi.useRealTimers());
  const at = (y: number, m: number, d: number, h: number, min: number) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(y, m, d, h, min)); // local clock
  };
  const rain: RainVeto = {
    vetoed: true,
    reason: 'Lluvia en 2 estaciones cercanas en las 2 últimas horas: sin brisa canalizada',
    wetStations: [{ id: 'wu_IREDON36', mm: 0.51 }, { id: 'mg_10154', mm: 0.3 }],
  };
  const dry: RainVeto = { vetoed: false, reason: null, wetStations: [] };

  it('26-ago 17:20: the thermal breeze alone says ~14kt', () => {
    at(2026, 7, 26, 17, 20);
    const r = predictCesantesCanalization(21, 18.31, 9, 204, 791, 17.1);
    expect(r.active).toBe(true);
    expect(r.predictedKt).toBe(14);
  });

  it('26-ago 17:20 with rain at two nearby stations: inactive, and the signal says why', () => {
    at(2026, 7, 26, 17, 20);
    const r = predictCesantesCanalization(21, 18.31, 9, 204, 791, 17.1, rain);
    expect(r.active).toBe(false);
    expect(r.predictedKt).toBeNull();
    expect(r.signals).toHaveLength(1);
    expect(r.signals[0]).toContain('Lluvia');
  });

  it('25-sep 17:04: 13kt, and a veto that did not trip changes nothing', () => {
    at(2026, 8, 25, 17, 4);
    expect(predictCesantesCanalization(26, 16.572, 4, 261, 670, 11.08).predictedKt).toBe(13);
    const r = predictCesantesCanalization(26, 16.572, 4, 261, 670, 11.08, dry);
    expect(r.active).toBe(true);
    expect(r.predictedKt).toBe(13);
  });

  it('25-jun 16:03: 15kt', () => {
    at(2026, 5, 25, 16, 3);
    const r = predictCesantesCanalization(23, 18.05, 7, 221, 1012.7, 19.05);
    expect(r.active).toBe(true);
    expect(r.predictedKt).toBe(15);
  });

  it('4-ago 12:38: inactive (4kt mean, weak ΔT, no gust to confirm a breeze)', () => {
    at(2026, 7, 4, 12, 38);
    const r = predictCesantesCanalization(23, 20.187, 4, 239, 473, null);
    expect(r.active).toBe(false);
  });
});
