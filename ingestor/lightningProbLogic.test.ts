import { describe, it, expect } from 'vitest';
import { lightningProb, lightningProbInputs, describeLightningProb, NO_STRIKE_KM } from './lightningProbLogic.js';

const NOW = Date.UTC(2026, 5, 14, 15, 0, 0);
const EMBALSE = { lat: 42.29, lon: -8.1 };
/** A point `km` north of the sector point (1 degree of latitude = 111.2 km). */
const north = (km: number, minAgo: number) => ({ lat: EMBALSE.lat + km / 111.2, lon: EMBALSE.lon, time: new Date(NOW - minAgo * 60_000) });

describe('lightningProbInputs', () => {
  it('counts by ring and keeps the nearest', () => {
    const i = lightningProbInputs([north(5, 2), north(20, 10), north(60, 29), north(120, 5)], EMBALSE.lat, EMBALSE.lon, NOW);
    expect(i.n25).toBe(2);
    expect(i.n80).toBe(3);
    expect(i.dmin).toBeCloseTo(5, 0);
  });

  it('ignores strikes older than 30 min or stamped in the future', () => {
    const i = lightningProbInputs([north(5, 31), north(5, -2)], EMBALSE.lat, EMBALSE.lon, NOW);
    expect(i).toEqual({ n25: 0, n80: 0, dmin: NO_STRIKE_KM });
  });

  it('caps a far strike at the no-strike distance', () => {
    const i = lightningProbInputs([north(300, 5)], EMBALSE.lat, EMBALSE.lon, NOW);
    expect(i).toEqual({ n25: 0, n80: 0, dmin: NO_STRIKE_KM });
  });
});

describe('lightningProb — frozen coefficients (seal rayos3-20261110)', () => {
  // The four worked examples written in the seal next to the coefficients. If one moves, a
  // coefficient was touched and the sealed exam no longer describes what the server stores.
  it('no strikes: close to zero, and still a number to store', () => {
    const p = lightningProb({ n25: 0, n80: 0, dmin: 150 });
    expect(p.p1h).toBeCloseTo(0.0008, 4);
    expect(p.p3h).toBeCloseTo(0.0042, 4);
  });

  it('one strike at 60 km', () => {
    const p = lightningProb({ n25: 0, n80: 1, dmin: 60 });
    expect(p.p1h).toBeCloseTo(0.0322, 4);
    expect(p.p3h).toBeCloseTo(0.1301, 4);
  });

  it('a storm next door', () => {
    const p = lightningProb({ n25: 2, n80: 5, dmin: 15 });
    expect(p.p1h).toBeCloseTo(0.2877, 4);
    expect(p.p3h).toBeCloseTo(0.5452, 4);
  });

  it('a storm overhead', () => {
    const p = lightningProb({ n25: 20, n80: 40, dmin: 3 });
    expect(p.p1h).toBeCloseTo(0.6978, 4);
    expect(p.p3h).toBeCloseTo(0.7748, 4);
  });

  it('more strikes or a closer one never lowers it', () => {
    const base = lightningProb({ n25: 1, n80: 3, dmin: 20 });
    expect(lightningProb({ n25: 4, n80: 3, dmin: 20 }).p1h).toBeGreaterThan(base.p1h);
    expect(lightningProb({ n25: 1, n80: 9, dmin: 20 }).p3h).toBeGreaterThan(base.p3h);
    expect(lightningProb({ n25: 1, n80: 3, dmin: 6 }).p1h).toBeGreaterThan(base.p1h);
  });
});

describe('describeLightningProb', () => {
  it('says «ninguno» instead of a made-up distance', () => {
    expect(describeLightningProb('rias', lightningProb({ n25: 0, n80: 0, dmin: 150 }))).toBe('rias p1h 0.1 % p3h 0.4 % (25 km: 0, 80 km: 0, mas cercano: ninguno)');
  });
});
