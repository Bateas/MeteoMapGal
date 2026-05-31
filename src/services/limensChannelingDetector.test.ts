/**
 * Tests for limensChannelingDetector — N/NNW orographic boost at Liméns,
 * anchored on the Cabo Udra buoy (4273). Active only when the buoy shows
 * aligned N/NNW wind above the threshold; W/E don't channel into Liméns.
 */
import { describe, it, expect } from 'vitest';
import { predictLimensChanneling } from './limensChannelingDetector';
import type { BuoyReading } from '../api/buoyClient';

function buoy(stationId: number, windSpeedMs: number | null, windDir: number | null): BuoyReading {
  return {
    stationId, stationName: `buoy-${stationId}`, timestamp: new Date().toISOString(),
    waveHeight: null, waveHeightMax: null, wavePeriod: null, wavePeriodMean: null, waveDir: null,
    windSpeed: windSpeedMs, windDir, windGust: null,
    waterTemp: null, airTemp: null, airPressure: null,
    currentSpeed: null, currentDir: null, salinity: null, seaLevel: null,
    humidity: null, dewPoint: null,
  };
}

const UDRA = 4273;
const ms = (kt: number) => kt / 1.944;

describe('predictLimensChanneling', () => {
  it('inactive when the Cabo Udra buoy is absent', () => {
    expect(predictLimensChanneling([buoy(9999, ms(15), 340)]).active).toBe(false);
  });

  it('inactive when the buoy has no wind data', () => {
    expect(predictLimensChanneling([buoy(UDRA, null, 340)]).active).toBe(false);
    expect(predictLimensChanneling([buoy(UDRA, ms(15), null)]).active).toBe(false);
  });

  it('boosts when the buoy shows aligned N/NNW above threshold', () => {
    const r = predictLimensChanneling([buoy(UDRA, ms(12), 338)]);
    expect(r.active).toBe(true);
    expect(r.predictedKt).toBe(15); // 12 * 1.25
    expect(r.predictedDir).toBe(338);
    expect(r.boostFactor).toBeCloseTo(1.25, 2);
    expect(r.confidence).toBe(70);
  });

  it('passes the buoy direction through to the prediction', () => {
    expect(predictLimensChanneling([buoy(UDRA, ms(16), 350)]).predictedDir).toBe(350);
  });

  it('channels NW (300°) — user confirmed it runs 15+ at NW', () => {
    expect(predictLimensChanneling([buoy(UDRA, ms(12), 300)]).active).toBe(true);
    expect(predictLimensChanneling([buoy(UDRA, ms(12), 315)]).active).toBe(true);
  });

  it('does NOT channel W wind (Liméns is sheltered from W)', () => {
    expect(predictLimensChanneling([buoy(UDRA, ms(18), 270)]).active).toBe(false);
    expect(predictLimensChanneling([buoy(UDRA, ms(18), 290)]).active).toBe(false); // WNW, below NW floor
  });

  it('does NOT channel E wind', () => {
    expect(predictLimensChanneling([buoy(UDRA, ms(18), 90)]).active).toBe(false);
  });

  it('handles the sector wrap through 0° (350° and 5° active, 30° inactive)', () => {
    expect(predictLimensChanneling([buoy(UDRA, ms(14), 350)]).active).toBe(true);
    expect(predictLimensChanneling([buoy(UDRA, ms(14), 5)]).active).toBe(true);
    expect(predictLimensChanneling([buoy(UDRA, ms(14), 30)]).active).toBe(false);
  });

  it('inactive below the minimum wind (light N is no real boost)', () => {
    expect(predictLimensChanneling([buoy(UDRA, ms(5), 340)]).active).toBe(false);
  });

  it('flags high severity when the boosted wind is strong', () => {
    const r = predictLimensChanneling([buoy(UDRA, ms(20), 340)]); // 20*1.25 = 25kt
    expect(r.severity).toBe('high');
  });
});
