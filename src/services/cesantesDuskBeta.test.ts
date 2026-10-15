import { describe, it, expect } from 'vitest';
import { assessCesantesDusk, noteAfternoonSun, madridHour, type DuskBetaInput } from './cesantesDuskBeta';

// 15-oct 19:40 local (17:40 UTC): app 4.1, Porto de Vigo 7.6 kt from 217°, the user saw 8-10.
const at = (iso: string) => Date.parse(iso);
const base: DuskBetaInput = {
  nowMs: at('2026-10-15T17:40:00Z'),
  appKt: 4.1,
  pv: { kt: 7.6, dirDeg: 217 },
  interiorSolar: 40,
  afternoonSunRatio: 0.8,
  upper850: { dirDeg: 200, speedKt: 8 },
};

describe('BETA Cesantes al anochecer', () => {
  it('a sunny SW afternoon after the sun cut: Cesantes goes with Porto de Vigo', () => {
    expect(madridHour(base.nowMs)).toBeCloseTo(19.67, 1);
    expect(assessCesantesDusk(base)).toEqual({ active: true, estimateKt: 7.6, gainKt: 3.5 });
  });

  it('never lowers the app: with the app above Porto de Vigo it keeps the app (no gain)', () => {
    expect(assessCesantesDusk({ ...base, appKt: 9 })).toEqual({ active: true, estimateKt: 9, gainKt: 0 });
  });

  it('the 25-sep counterexample: north wind aloft stops it', () => {
    expect(assessCesantesDusk({ ...base, upper850: { dirDeg: 335, speedKt: 13 } })).toEqual({ active: false, reason: 'norte en altura' });
    expect(assessCesantesDusk({ ...base, upper850: { dirDeg: 335, speedKt: 6 } }).active).toBe(true);
  });

  it('the 4-oct counterexample: land wind from the NE at Porto de Vigo is not this pattern', () => {
    expect(assessCesantesDusk({ ...base, pv: { kt: 6, dirDeg: 60 } })).toEqual({ active: false, reason: 'Porto de Vigo no es W-SW' });
  });

  it('outside the evening, in full sun or after a cloudy afternoon it says nothing', () => {
    expect(assessCesantesDusk({ ...base, nowMs: at('2026-10-15T12:00:00Z') }).active).toBe(false);
    expect(assessCesantesDusk({ ...base, interiorSolar: 520 })).toEqual({ active: false, reason: 'aún hay sol' });
    expect(assessCesantesDusk({ ...base, afternoonSunRatio: 0.35 })).toEqual({ active: false, reason: 'tarde nublada' });
  });

  it('any missing input means no BETA: it never guesses', () => {
    for (const k of ['pv', 'interiorSolar', 'afternoonSunRatio', 'upper850'] as const) {
      expect(assessCesantesDusk({ ...base, [k]: null }).active).toBe(false);
    }
  });
});

describe('sunny-afternoon memory', () => {
  it('keeps the best share of clear sky between 12 and 16 h and starts again the next day', () => {
    let s = noteAfternoonSun({ date: '', max: null }, at('2026-10-15T09:00:00Z'), 300);   // 11 h local: not counted
    expect(s.max).toBeNull();
    s = noteAfternoonSun(s, at('2026-10-15T12:00:00Z'), 600);                             // 14 h local
    const first = s.max!;
    expect(first).toBeGreaterThan(0.6);
    s = noteAfternoonSun(s, at('2026-10-15T13:00:00Z'), 100);                             // a passing cloud
    expect(s.max).toBe(first);
    s = noteAfternoonSun(s, at('2026-10-16T08:00:00Z'), null);                            // next day
    expect(s).toEqual({ date: '2026-10-16', max: null });
  });
});
