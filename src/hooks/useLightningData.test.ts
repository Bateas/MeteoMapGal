import { describe, it, expect } from 'vitest';
import { computeStormAlert } from './useLightningData';
import type { LightningStrike, StormAlert } from '../types/lightning';

// Rías Baixas centre; strikes placed due north at a given distance and age.
const LAT = 42.3;
const LON = -8.68;
const NONE: StormAlert = {
  level: 'none', nearestKm: Infinity, recentCount: 0, trend: 'none',
  etaMinutes: null, speedKmh: null, bearingDeg: null, clusters: [], updatedAt: new Date(),
};
let nextId = 1;
function strike(km: number, ageMin: number, cloudToCloud = false): LightningStrike {
  return {
    id: nextId++, lat: LAT + km / 111.2, lon: LON, timestamp: Date.now() - ageMin * 60_000,
    peakCurrent: -12, cloudToCloud, multiplicity: 1, ageMinutes: ageMin,
  };
}
const alertFor = (strikes: LightningStrike[]) => computeStormAlert(strikes, [], NONE, LAT, LON);

describe('computeStormAlert: same levels as the lightning safety', () => {
  it('6-oct: one lone strike at 11 km (next at 28) is information, not a warning', () => {
    const a = alertFor([strike(11, 5), strike(28, 6), strike(34, 8)]);
    expect(a.level).toBe('watch');
    expect(a.nearestKm).toBeCloseTo(11, 0);
  });

  it('three ground strikes within 25 km -> warning', () => {
    expect(alertFor([strike(12, 3), strike(18, 6), strike(22, 9)]).level).toBe('warning');
  });

  it('two within 10 km -> danger, with no arrival time', () => {
    const a = alertFor([strike(4, 2), strike(8, 4)]);
    expect(a.level).toBe('danger');
    expect(a.etaMinutes).toBeNull();
  });

  it('intra-cloud flashes do not raise the level', () => {
    expect(alertFor([strike(12, 3, true), strike(18, 6, true), strike(22, 9, true)]).level).toBe('watch');
  });

  it('strikes older than the 20-min safety window only inform', () => {
    expect(alertFor([strike(12, 24), strike(18, 25), strike(22, 26)]).level).toBe('watch');
  });

  it('nothing in the last 30 min -> none', () => {
    expect(alertFor([strike(12, 40)]).level).toBe('none');
  });
});
