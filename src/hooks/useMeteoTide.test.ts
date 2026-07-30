/**
 * Tests for the wiring between the REDMAR gauge and the IHM prediction.
 *
 * The failure this guards against is silent: pair a spot with the wrong port
 * and the residual stops being a storm surge and becomes the difference
 * between two tide tables, which looks perfectly plausible on screen.
 */

import { describe, it, expect } from 'vitest';
import type { TidePoint } from '../api/tideClient';
import type { BuoyReading } from '../api/buoyClient';
import { toExtremes } from '../services/meteoTideService';
import {
  selectGaugeForTideStation,
  meteoTideFromGauge,
  gaugeLevelFromReading,
  SEA_LEVEL_GAUGES,
} from './useMeteoTide';

// Real IHM Vigo (station 29) predictions, same fixtures as meteoTideService
const JUL19: TidePoint[] = [
  { time: '00:11', height: 0.623, type: 'low' },
  { time: '06:22', height: 3.195, type: 'high' },
  { time: '12:18', height: 0.827, type: 'low' },
  { time: '18:39', height: 3.382, type: 'high' },
];

const day19 = new Date('2026-07-19T12:00:00');
const observedAt = new Date('2026-07-19T15:00:00');
const now = new Date('2026-07-19T15:05:00');

function vigoSeries() {
  return toExtremes(JUL19, day19);
}

/** Real BuoyReading shape — every field, so a rename breaks the test loudly. */
function makeGaugeReading(seaLevelCm: number | null, at: Date = observedAt): BuoyReading {
  return {
    stationId: 3221,
    stationName: 'Vigo (marea)',
    timestamp: at.toISOString(),
    waveHeight: null,
    waveHeightMax: null,
    wavePeriod: null,
    wavePeriodMean: null,
    waveDir: null,
    windSpeed: null,
    windDir: null,
    windGust: null,
    waterTemp: null,
    airTemp: null,
    airPressure: null,
    currentSpeed: null,
    currentDir: null,
    salinity: null,
    seaLevel: seaLevelCm,
    humidity: null,
    dewPoint: null,
    source: 'portus',
  };
}

describe('selectGaugeForTideStation — falls back when a gauge goes silent', () => {
  // The real incident: the Vigo gauge stopped reporting and, being the closest
  // one to nearly every Rías spot, took the surge line down with it while the
  // rest of the app looked perfectly healthy.
  const vigoIsDead = (g: { buoyStationId: number }) => g.buoyStationId !== 3221;
  const allDead = () => false;
  const allLive = () => true;

  it('still prefers the nearest gauge while it reports', () => {
    expect(selectGaugeForTideStation('29', allLive)).toMatchObject({ buoyStationId: 3221 });
  });

  it('skips the silent Vigo gauge and reaches for Marín', () => {
    const g = selectGaugeForTideStation('29', vigoIsDead);
    expect(g).toMatchObject({ buoyStationId: 3223, ihmStationId: '28' });
  });

  it('the substitute brings its OWN astronomical prediction', () => {
    // Subtracting Marín's level from Vigo's table is not a surge, it is the
    // difference between two tide tables. The pairing must travel together.
    const g = selectGaugeForTideStation('29', vigoIsDead);
    expect(g!.ihmStationId).toBe('28');
    expect(g!.ihmStationId).not.toBe('29');
  });

  it('with every gauge silent it still returns the pairing, and the staleness gate stays quiet', () => {
    // Returning null here would be indistinguishable from "unknown port".
    expect(selectGaugeForTideStation('29', allDead)).toMatchObject({ buoyStationId: 3221 });
  });

  it('never substitutes a gauge beyond the distance cap', () => {
    // Baiona pairs with Vigo; with Vigo silent the substitute must still be
    // inside MAX_GAUGE_DISTANCE_KM or the residual stops describing this water.
    const g = selectGaugeForTideStation('30', vigoIsDead);
    if (g) expect(g.buoyStationId).not.toBe(3221);
  });

  it('behaves exactly as before when no liveness check is supplied', () => {
    expect(selectGaugeForTideStation('29')).toMatchObject({ buoyStationId: 3221 });
  });
});

describe('selectGaugeForTideStation', () => {
  it('pairs each gauge port with its own IHM prediction', () => {
    expect(selectGaugeForTideStation('29')).toMatchObject({ buoyStationId: 3221, ihmStationId: '29' });
    expect(selectGaugeForTideStation('28')).toMatchObject({ buoyStationId: 3223, ihmStationId: '28' });
    expect(selectGaugeForTideStation('26')).toMatchObject({ buoyStationId: 3220, ihmStationId: '26' });
  });

  it('sends a port without a gauge to the nearest one, prediction included', () => {
    // Baiona and Sanxenxo have a tide table but no gauge. The prediction must
    // follow the gauge, not the spot, or the residual mixes two ports.
    const baiona = selectGaugeForTideStation('30');
    expect(baiona).toMatchObject({ buoyStationId: 3221, ihmStationId: '29' }); // Vigo
    const sanxenxo = selectGaugeForTideStation('27');
    expect(sanxenxo).toMatchObject({ buoyStationId: 3223, ihmStationId: '28' }); // Marín
  });

  it('returns null for a port it does not know, instead of guessing a ría', () => {
    expect(selectGaugeForTideStation('1')).toBeNull();
    expect(selectGaugeForTideStation('')).toBeNull();
  });

  it('only claims the three stations that actually publish sea level', () => {
    expect(SEA_LEVEL_GAUGES.map((g) => g.buoyStationId).sort()).toEqual([3220, 3221, 3223]);
  });
});

describe('gaugeLevelFromReading', () => {
  it('reads the centimetres and the stamp off a real store reading', () => {
    const level = gaugeLevelFromReading(makeGaugeReading(231));
    expect(level).not.toBeNull();
    expect(level!.cm).toBe(231);
    expect(level!.at.getTime()).toBe(observedAt.getTime());
  });

  it('stays silent when the gauge reports no level', () => {
    expect(gaugeLevelFromReading(makeGaugeReading(null))).toBeNull();
    expect(gaugeLevelFromReading(null)).toBeNull();
  });

  it('refuses an unparseable timestamp rather than computing from NaN', () => {
    expect(gaugeLevelFromReading({ ...makeGaugeReading(231), timestamp: 'not-a-date' })).toBeNull();
  });
});

describe('meteoTideFromGauge', () => {
  it('converts the gauge centimetres to metres before subtracting', () => {
    // Astronomical at 15:00 sits near 1.81m; 231cm is roughly half a metre over.
    const t = meteoTideFromGauge({ cm: 231, at: observedAt }, vigoSeries(), now);
    expect(t).not.toBeNull();
    expect(t!.residualM).toBeGreaterThan(0.4);
    expect(t!.residualM).toBeLessThan(0.6);
    expect(t!.level).toBe('high');
  });

  it('stays silent with nothing observed', () => {
    expect(meteoTideFromGauge(null, vigoSeries(), now)).toBeNull();
  });

  it('stays silent with no predictions to subtract', () => {
    expect(meteoTideFromGauge({ cm: 231, at: observedAt }, [], now)).toBeNull();
  });

  it('reports the water sitting where the table says as level none', () => {
    const t = meteoTideFromGauge({ cm: 181, at: observedAt }, vigoSeries(), now);
    expect(t).not.toBeNull();
    expect(t!.level).toBe('none');
  });
});
