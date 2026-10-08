import { describe, it, expect } from 'vitest';
import { assessSynopticRegime, upperWindAt, windowRegime } from './synopticRegime';

describe('assessSynopticRegime — the afternoons with ground truth', () => {
  it.each([
    ['06-Aug breeze', 3, 310, false],
    ['25-Sep breeze (Cesantes 14 kt real)', 9, 332, false],
    ['26-Sep warm, light SW aloft', 11, 246, false],
    ['26-Aug front (app 34, real 9)', 22, 241, true],
    ['27-Sep front (false favourable window)', 19, 213, true],
    ['28-Sep front (app 15-18, real <= 10)', 19, 209, true],
  ])('%s', (_label, kt, dir, frontal) => {
    expect(assessSynopticRegime({ speedKt: kt, dirDeg: dir })?.vetoed).toBe(frontal);
  });
});

describe('assessSynopticRegime — edges', () => {
  it('strong flow from the N or E is not a front coming in', () => {
    expect(assessSynopticRegime({ speedKt: 25, dirDeg: 0 })?.vetoed).toBe(false);
    expect(assessSynopticRegime({ speedKt: 25, dirDeg: 90 })?.vetoed).toBe(false);
  });

  it('inclusive limits: 15 kt and the 150-290 sector', () => {
    expect(assessSynopticRegime({ speedKt: 15, dirDeg: 150 })?.vetoed).toBe(true);
    expect(assessSynopticRegime({ speedKt: 15, dirDeg: 290 })?.vetoed).toBe(true);
    expect(assessSynopticRegime({ speedKt: 14.9, dirDeg: 200 })?.vetoed).toBe(false);
    expect(assessSynopticRegime({ speedKt: 20, dirDeg: 291 })?.vetoed).toBe(false);
  });

  it('no data is no veto (everything behaves as before)', () => {
    expect(assessSynopticRegime(null)).toBeNull();
    expect(assessSynopticRegime({ speedKt: NaN, dirDeg: 200 })).toBeNull();
  });

  it('says why, in plain words', () => {
    expect(assessSynopticRegime({ speedKt: 19.4, dirDeg: 209 })?.reason).toMatch(/19 kt SSW/);
  });
});

describe('upperWindAt', () => {
  const now = Date.parse('2026-09-28T15:30:00Z');
  const row = (iso: string, hpa: number, ms: number | null, dir: number | null) =>
    ({ time: iso, pressureHpa: hpa, windSpeedMs: ms, windDirDeg: dir });

  it('picks the 850 hPa row nearest to now, in knots', () => {
    const w = upperWindAt([
      row('2026-09-28T14:00:00Z', 850, 8, 200),
      row('2026-09-28T15:00:00Z', 700, 30, 250),
      row('2026-09-28T16:00:00Z', 850, 10, 213),
    ], now);
    expect(w?.dirDeg).toBe(213);
    expect(w?.speedKt).toBeCloseTo(19.4, 1);
  });

  it('gives nothing when the nearest 850 hPa hour is more than 3 h away', () => {
    expect(upperWindAt([row('2026-09-28T10:00:00Z', 850, 10, 213)], now)).toBeNull();
  });

  it('skips rows without wind', () => {
    expect(upperWindAt([row('2026-09-28T15:00:00Z', 850, null, 213)], now)).toBeNull();
  });
});

describe('assessSynopticRegime — strong NNE-E aloft on the coast (opt-in)', () => {
  it('8-oct: 19 kt ENE at 1.500 m keeps the breeze out of the rías', () => {
    const r = assessSynopticRegime({ speedKt: 19, dirDeg: 70 }, { coastal: true });
    expect(r).toMatchObject({ vetoed: true, kind: 'offshore' });
    expect(r?.reason).toMatch(/NE fuerte en altura \(19 kt ENE a 1\.500 m\)/);
  });

  it('only where it was measured: without the coastal flag it is not a veto', () => {
    expect(assessSynopticRegime({ speedKt: 19, dirDeg: 70 })?.vetoed).toBe(false);
  });

  it('the N does not block the breeze, 10-15 kt from the NE is left open, 20-120 the sector', () => {
    expect(assessSynopticRegime({ speedKt: 20, dirDeg: 0 }, { coastal: true })?.vetoed).toBe(false);
    expect(assessSynopticRegime({ speedKt: 14.9, dirDeg: 60 }, { coastal: true })?.vetoed).toBe(false);
    expect(assessSynopticRegime({ speedKt: 15, dirDeg: 20 }, { coastal: true })?.vetoed).toBe(true);
    expect(assessSynopticRegime({ speedKt: 15, dirDeg: 120 }, { coastal: true })?.vetoed).toBe(false);
  });

  it('a front is still a front on the coast, and says so', () => {
    expect(assessSynopticRegime({ speedKt: 19, dirDeg: 209 }, { coastal: true })?.kind).toBe('frontal');
  });
});

describe('windowRegime', () => {
  const at = (h: number, kt: number, dir: number) => ({ time: new Date(Date.UTC(2026, 9, 9, h)), pressureHpa: 850, windSpeedMs: kt / 1.94384, windDirDeg: dir });
  const hours = [12, 13, 14, 15].map((h) => Date.UTC(2026, 9, 9, h));

  it('vetoed when at least half of the judged hours are', () => {
    const half = [at(12, 19, 60), at(13, 18, 65), at(14, 8, 300), at(15, 6, 300)];
    expect(windowRegime(half, hours, { coastal: true })).toMatchObject({ vetoed: true, kind: 'offshore' });
    const one = [at(12, 19, 60), at(13, 8, 300), at(14, 8, 300), at(15, 6, 300)];
    expect(windowRegime(one, hours, { coastal: true })?.vetoed).toBe(false);
  });

  it('no upper-air hours = no veto', () => {
    expect(windowRegime([], hours, { coastal: true })).toBeNull();
    expect(windowRegime(null, hours)).toBeNull();
  });
});
