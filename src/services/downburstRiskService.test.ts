/**
 * Tests for downburstRiskService — dry-microburst pure function detector.
 */
import { describe, it, expect } from 'vitest';
import { evaluateDownburstRisk, GUST_MIN_KT } from './downburstRiskService';

// ── Fixtures ──────────────────────────────────────────

function makeStation(stationId: string, windSpeed: number, windGust: number) {
  return { stationId, windSpeed, windGust };
}

const ATMOSPHERE = {
  temperature500hPa: -18, // cold
  cape: 1500,             // unstable
  liftedIndex: -4,        // very unstable
  cloudCover: 85,         // high cloud
  precipMmH: 0.2,         // dry
};

// Two stations measuring a real gust: ratio >= 2 and >= 20 kt (10.3 m/s).
const FULL_DOWNBURST = {
  stations: [makeStation('test-1', 5, 11), makeStation('test-2', 5.5, 12)], // x2.2 (21 kt), x2.18 (23 kt)
  atmosphere: ATMOSPHERE,
};

describe('evaluateDownburstRisk — full alignment', () => {
  it('reports high severity when all 4 signals align and two stations measure the gust', () => {
    const result = evaluateDownburstRisk(FULL_DOWNBURST);
    expect(result.severity).toBe('high');
    expect(result.alignedCount).toBe(4);
    expect(result.gustStations).toBe(2);
    expect(result.confidence).toBeGreaterThanOrEqual(85);
    expect(result.summary).toContain('Riesgo ALTO');
    expect(result.summary).toContain('downburst seco');
    expect(result.summary).toContain('medidas en 2 estaciones');
  });

  it('exposes signal breakdown for transparency', () => {
    const result = evaluateDownburstRisk(FULL_DOWNBURST);
    expect(result.signals.maxGustRatio).toBeCloseTo(2.2, 1);
    expect(result.signals.gustSourceStation).toBe('test-1');
    expect(result.signals.temperature500hPa).toBe(-18);
    expect(result.signals.cape).toBe(1500);
    expect(result.signals.liftedIndex).toBe(-4);
    expect(result.signals.cloudCover).toBe(85);
    expect(result.signals.precipMmH).toBe(0.2);
  });
});

describe('evaluateDownburstRisk — a warning needs a measured gust (28-sep)', () => {
  it('the forecast setup alone never warns: no station, 3/4 from the model -> null', () => {
    const result = evaluateDownburstRisk({ stations: [], atmosphere: ATMOSPHERE });
    expect(result.alignedCount).toBe(3);
    expect(result.severity).toBeNull();
    expect(result.summary).toMatch(/sin rachas medidas/);
  });

  it('one anemometer alone never raises the top level', () => {
    const result = evaluateDownburstRisk({ stations: [makeStation('solo', 5, 11)], atmosphere: ATMOSPHERE });
    expect(result.alignedCount).toBe(4);
    expect(result.gustStations).toBe(1);
    expect(result.severity).toBe('moderate');
  });

  it(`a light-breeze ratio is not a gust: 3 m/s over 1.2 m/s (x2.5, 6 kt) does not count (floor ${GUST_MIN_KT} kt)`, () => {
    const result = evaluateDownburstRisk({ stations: [makeStation('flojo', 1.2, 3)], atmosphere: ATMOSPHERE });
    expect(result.signals.maxGustRatio).toBeCloseTo(2.5, 1);
    expect(result.gustStations).toBe(0);
    expect(result.severity).toBeNull();
  });
});

describe('evaluateDownburstRisk — partial alignment', () => {
  it('moderate severity at 3/4 signals (missing dry profile) with measured gusts', () => {
    const result = evaluateDownburstRisk({
      ...FULL_DOWNBURST,
      atmosphere: { ...ATMOSPHERE, precipMmH: 2.5 }, // wet — fails dry
    });
    expect(result.severity).toBe('moderate');
    expect(result.alignedCount).toBe(3);
    expect(result.summary).toContain('Riesgo moderado');
  });

  it('null severity at 2/4 signals (only gust + cold)', () => {
    const result = evaluateDownburstRisk({
      stations: FULL_DOWNBURST.stations,
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
  it('gust ratio exactly 2.0 (and above the floor) triggers signal 1', () => {
    const result = evaluateDownburstRisk({
      stations: [makeStation('a', 5.5, 11), makeStation('b', 6, 12)], // exactly 2.0, 21-23 kt
      atmosphere: ATMOSPHERE,
    });
    expect(result.signals.maxGustRatio).toBe(2);
    expect(result.severity).toBe('high');
  });

  it('temp500 exactly -15°C triggers cold signal', () => {
    const result = evaluateDownburstRisk({
      ...FULL_DOWNBURST,
      atmosphere: { ...ATMOSPHERE, temperature500hPa: -15 },
    });
    expect(result.severity).toBe('high');
  });

  it('temp500 -14.9°C is BELOW threshold (not cold enough)', () => {
    const result = evaluateDownburstRisk({
      ...FULL_DOWNBURST,
      atmosphere: { ...ATMOSPHERE, temperature500hPa: -14.9 },
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
      atmosphere: ATMOSPHERE,
    });
    expect(result.signals.gustSourceStation).toBe('high');
    expect(result.signals.maxGustRatio).toBe(3);
  });

  it('ignores stations with wind <= 0.5 m/s (avoid divide-by-zero)', () => {
    const result = evaluateDownburstRisk({
      stations: [
        makeStation('calm', 0.1, 8), // would be 80× ratio — ignored
        makeStation('real', 5, 11),   // ratio 2.2
      ],
      atmosphere: ATMOSPHERE,
    });
    expect(result.signals.gustSourceStation).toBe('real');
  });
});

describe('evaluateDownburstRisk — missing data', () => {
  it('handles null atmosphere fields gracefully', () => {
    const result = evaluateDownburstRisk({
      stations: FULL_DOWNBURST.stations,
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
});
