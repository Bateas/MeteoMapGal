/**
 * Tests for downburstRiskService — dry-microburst pure function detector.
 */
import { describe, it, expect } from 'vitest';
import { evaluateDownburstRisk } from './downburstRiskService';

// ── Fixtures ──────────────────────────────────────────

function makeStation(stationId: string, windSpeed: number, windGust: number) {
  return { stationId, windSpeed, windGust };
}

const FULL_DOWNBURST = {
  stations: [makeStation('test-1', 4, 9)], // ratio 2.25
  atmosphere: {
    temperature500hPa: -18, // cold
    cape: 1500,             // unstable
    liftedIndex: -4,        // very unstable
    cloudCover: 85,         // high cloud
    precipMmH: 0.2,         // dry
  },
};

describe('evaluateDownburstRisk — full alignment', () => {
  it('reports high severity when all 4 signals align', () => {
    const result = evaluateDownburstRisk(FULL_DOWNBURST);
    expect(result.severity).toBe('high');
    expect(result.alignedCount).toBe(4);
    expect(result.confidence).toBeGreaterThanOrEqual(85);
    expect(result.summary).toContain('Riesgo ALTO');
    expect(result.summary).toContain('downburst seco');
  });

  it('exposes signal breakdown for transparency', () => {
    const result = evaluateDownburstRisk(FULL_DOWNBURST);
    expect(result.signals.maxGustRatio).toBeCloseTo(2.25, 1);
    expect(result.signals.gustSourceStation).toBe('test-1');
    expect(result.signals.temperature500hPa).toBe(-18);
    expect(result.signals.cape).toBe(1500);
    expect(result.signals.liftedIndex).toBe(-4);
    expect(result.signals.cloudCover).toBe(85);
    expect(result.signals.precipMmH).toBe(0.2);
  });
});

describe('evaluateDownburstRisk — partial alignment', () => {
  it('moderate severity at 3/4 signals (missing dry profile)', () => {
    const result = evaluateDownburstRisk({
      ...FULL_DOWNBURST,
      atmosphere: { ...FULL_DOWNBURST.atmosphere, precipMmH: 2.5 }, // wet — fails dry
    });
    expect(result.severity).toBe('moderate');
    expect(result.alignedCount).toBe(3);
    expect(result.summary).toContain('Riesgo moderado');
  });

  it('null severity at 2/4 signals (only gust + cold)', () => {
    const result = evaluateDownburstRisk({
      stations: [makeStation('test-1', 4, 9)],
      atmosphere: {
        temperature500hPa: -18,
        cape: 200,           // too low
        liftedIndex: 0,       // not unstable
        cloudCover: 30,       // low cloud
        precipMmH: 0,
      },
    });
    expect(result.severity).toBeNull();
    expect(result.alignedCount).toBe(2);
  });

  it('null severity at 0/4 signals (calm clear day)', () => {
    const result = evaluateDownburstRisk({
      stations: [makeStation('test-1', 5, 6)], // ratio 1.2
      atmosphere: {
        temperature500hPa: -8,
        cape: 100,
        liftedIndex: 2,
        cloudCover: 10,
        precipMmH: 0,
      },
    });
    expect(result.severity).toBeNull();
    expect(result.alignedCount).toBe(0);
    expect(result.summary).toMatch(/Sin condiciones/i);
  });
});

describe('evaluateDownburstRisk — boundary cases', () => {
  it('gust ratio exactly 2.0 triggers signal 1', () => {
    const result = evaluateDownburstRisk({
      stations: [makeStation('test', 5, 10)], // exactly 2.0
      atmosphere: FULL_DOWNBURST.atmosphere,
    });
    expect(result.signals.maxGustRatio).toBe(2);
    expect(result.severity).toBe('high'); // all 4 still align
  });

  it('temp500 exactly -15°C triggers cold signal', () => {
    const result = evaluateDownburstRisk({
      ...FULL_DOWNBURST,
      atmosphere: { ...FULL_DOWNBURST.atmosphere, temperature500hPa: -15 },
    });
    expect(result.severity).toBe('high');
  });

  it('temp500 -14.9°C is BELOW threshold (not cold enough)', () => {
    const result = evaluateDownburstRisk({
      ...FULL_DOWNBURST,
      atmosphere: { ...FULL_DOWNBURST.atmosphere, temperature500hPa: -14.9 },
    });
    expect(result.alignedCount).toBe(3); // sig2 fails
    expect(result.severity).toBe('moderate');
  });

  it('finds worst gust ratio across multiple stations', () => {
    const result = evaluateDownburstRisk({
      stations: [
        makeStation('low', 5, 7),     // ratio 1.4
        makeStation('high', 4, 12),   // ratio 3.0 ← worst
        makeStation('mid', 6, 11),    // ratio 1.83
      ],
      atmosphere: FULL_DOWNBURST.atmosphere,
    });
    expect(result.signals.gustSourceStation).toBe('high');
    expect(result.signals.maxGustRatio).toBe(3);
  });

  it('ignores stations with wind <= 0.5 m/s (avoid divide-by-zero)', () => {
    const result = evaluateDownburstRisk({
      stations: [
        makeStation('calm', 0.1, 8), // would be 80× ratio — ignored
        makeStation('real', 4, 9),    // ratio 2.25
      ],
      atmosphere: FULL_DOWNBURST.atmosphere,
    });
    expect(result.signals.gustSourceStation).toBe('real');
  });
});

describe('evaluateDownburstRisk — missing data', () => {
  it('handles null atmosphere fields gracefully', () => {
    const result = evaluateDownburstRisk({
      stations: [makeStation('test', 4, 9)],
      atmosphere: {
        temperature500hPa: null,
        cape: null,
        liftedIndex: null,
        cloudCover: null,
        precipMmH: null,
      },
    });
    // Only signal 1 (gust ratio) fires
    expect(result.alignedCount).toBe(1);
    expect(result.severity).toBeNull();
  });

  it('handles empty stations array', () => {
    const result = evaluateDownburstRisk({
      stations: [],
      atmosphere: FULL_DOWNBURST.atmosphere,
    });
    expect(result.signals.maxGustRatio).toBeNull();
    expect(result.alignedCount).toBe(3); // sig1 fails, 2/3/4 still fire
    expect(result.severity).toBe('moderate');
  });
});
