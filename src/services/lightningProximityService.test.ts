/**
 * Tests for lightningProximityService — LOCAL per-spot lightning safety.
 *
 * Geometry helper: near Galicia (~42°N), 0.09° of latitude ≈ 10km.
 * All strike positions are built from a spot center plus a latitude offset
 * so distances are predictable within a few hundred metres.
 */

import { describe, it, expect } from 'vitest';
import {
  assessSpotLightningRisk,
  formatRiskLine,
  LIGHTNING_WINDOW_MIN,
  type ProximitySpot,
  type ProximityStrike,
} from './lightningProximityService';

const NOW = new Date('2026-07-18T15:00:00Z');

const CESANTES: ProximitySpot = {
  id: 'cesantes', name: 'Cesantes', lat: 42.3, lon: -8.63, sector: 'rias',
};
const CASTRELO: ProximitySpot = {
  id: 'castrelo', name: 'Castrelo', lat: 42.29, lon: -8.09, sector: 'embalse',
};

/** ~1km ≈ 0.009° latitude */
const KM = 0.009;

function strike(spot: ProximitySpot, kmNorth: number, ageMin: number): ProximityStrike {
  return {
    lat: spot.lat + kmNorth * KM,
    lon: spot.lon,
    time: new Date(NOW.getTime() - ageMin * 60_000),
  };
}

describe('assessSpotLightningRisk', () => {
  it('returns empty for no strikes or no spots', () => {
    expect(assessSpotLightningRisk([CESANTES], [], NOW)).toEqual([]);
    expect(assessSpotLightningRisk([], [strike(CESANTES, 5, 2)], NOW)).toEqual([]);
  });

  it('ignores strikes older than the window', () => {
    const stale = [
      strike(CESANTES, 5, LIGHTNING_WINDOW_MIN + 5),
      strike(CESANTES, 6, LIGHTNING_WINDOW_MIN + 10),
    ];
    expect(assessSpotLightningRisk([CESANTES], stale, NOW)).toEqual([]);
  });

  it('two strikes within 10km fire peligro', () => {
    const strikes = [strike(CESANTES, 6, 3), strike(CESANTES, 8, 7)];
    const risks = assessSpotLightningRisk([CESANTES], strikes, NOW);
    expect(risks).toHaveLength(1);
    expect(risks[0].level).toBe('peligro');
    expect(risks[0].countNear).toBe(2);
    expect(risks[0].nearestKm).toBeGreaterThan(4);
    expect(risks[0].nearestKm).toBeLessThan(8);
  });

  it('a single close strike with no storm context stays silent (rigor)', () => {
    const risks = assessSpotLightningRisk([CESANTES], [strike(CESANTES, 6, 3)], NOW);
    expect(risks).toEqual([]);
  });

  it('one close strike escalates to peligro when the 25km context corroborates', () => {
    const strikes = [
      strike(CESANTES, 7, 2),   // within 10km
      strike(CESANTES, 18, 5),  // context
      strike(CESANTES, 20, 9),  // context
    ];
    const risks = assessSpotLightningRisk([CESANTES], strikes, NOW);
    expect(risks).toHaveLength(1);
    expect(risks[0].level).toBe('peligro');
  });

  it('three strikes at ~20km fire aviso, two stay silent', () => {
    const three = [strike(CESANTES, 18, 2), strike(CESANTES, 20, 6), strike(CESANTES, 22, 9)];
    const risks = assessSpotLightningRisk([CESANTES], three, NOW);
    expect(risks).toHaveLength(1);
    expect(risks[0].level).toBe('aviso');
    expect(risks[0].countNear).toBe(0);

    const two = three.slice(0, 2);
    expect(assessSpotLightningRisk([CESANTES], two, NOW)).toEqual([]);
  });

  it('detects an approaching storm and estimates ETA', () => {
    // Older half-window (10-20min ago) at ~40km, recent (0-10min) at ~20km:
    // mean shrank 20km in 10min → 2km/min → ETA ≈ 18km / 2 ≈ 9 → rounds to 10
    const strikes = [
      strike(CESANTES, 40, 15), strike(CESANTES, 41, 18),
      strike(CESANTES, 20, 2), strike(CESANTES, 21, 5),
      strike(CESANTES, 18, 3), // brings count25 to 3 → aviso
    ];
    const risks = assessSpotLightningRisk([CESANTES], strikes, NOW);
    expect(risks).toHaveLength(1);
    expect(risks[0].level).toBe('aviso');
    expect(risks[0].approaching).toBe(true);
    expect(risks[0].etaMin).toBe(10);
  });

  it('a receding storm is not flagged as approaching', () => {
    const strikes = [
      strike(CESANTES, 15, 15), strike(CESANTES, 16, 18), // older, closer
      strike(CESANTES, 24, 2), strike(CESANTES, 23, 5),   // recent, further
      strike(CESANTES, 22, 4),
    ];
    const risks = assessSpotLightningRisk([CESANTES], strikes, NOW);
    expect(risks).toHaveLength(1);
    expect(risks[0].approaching).toBe(false);
    expect(risks[0].etaMin).toBeNull();
  });

  it('no approach trend with fewer than 2 strikes per half-window', () => {
    const strikes = [
      strike(CESANTES, 40, 15),                        // only 1 older
      strike(CESANTES, 18, 2), strike(CESANTES, 20, 4), strike(CESANTES, 22, 6),
    ];
    const risks = assessSpotLightningRisk([CESANTES], strikes, NOW);
    expect(risks).toHaveLength(1);
    expect(risks[0].approaching).toBe(false);
  });

  it('scores spots independently and sorts peligro first', () => {
    const strikes = [
      // Peligro at Castrelo (Embalse)
      strike(CASTRELO, 5, 2), strike(CASTRELO, 7, 6),
      // Aviso at Cesantes (Rías) — ~55km from Castrelo, outside its bands
      strike(CESANTES, 18, 3), strike(CESANTES, 20, 5), strike(CESANTES, 22, 8),
    ];
    const risks = assessSpotLightningRisk([CESANTES, CASTRELO], strikes, NOW);
    expect(risks).toHaveLength(2);
    expect(risks[0].spotId).toBe('castrelo');
    expect(risks[0].level).toBe('peligro');
    expect(risks[1].spotId).toBe('cesantes');
    expect(risks[1].level).toBe('aviso');
  });

  it('tolerates clock skew (strike stamped slightly in the future)', () => {
    const future: ProximityStrike = {
      lat: CESANTES.lat + 6 * KM, lon: CESANTES.lon,
      time: new Date(NOW.getTime() + 30_000),
    };
    const strikes = [future, strike(CESANTES, 7, 4)];
    const risks = assessSpotLightningRisk([CESANTES], strikes, NOW);
    expect(risks).toHaveLength(1);
    expect(risks[0].level).toBe('peligro');
    expect(risks[0].freshestAgeMin).toBe(0);
  });
});

describe('formatRiskLine', () => {
  it('formats distance, count and approach', () => {
    const line = formatRiskLine({
      spotId: 'cesantes', spotName: 'Cesantes', sector: 'rias', level: 'peligro',
      nearestKm: 6.2, countNear: 2, count25: 5,
      approaching: true, etaMin: 15, freshestAgeMin: 2,
    });
    expect(line).toBe('Cesantes: rayo a 6km (5 en 20min, acercandose ~15min)');
  });

  it('handles sub-km strikes and no approach', () => {
    const line = formatRiskLine({
      spotId: 'vao', spotName: 'O Vao', sector: 'rias', level: 'peligro',
      nearestKm: 0.8, countNear: 3, count25: 4,
      approaching: false, etaMin: null, freshestAgeMin: 1,
    });
    expect(line).toBe('O Vao: rayo a <1km (4 en 20min)');
  });
});
