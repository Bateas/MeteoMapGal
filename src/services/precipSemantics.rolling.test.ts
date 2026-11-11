import { describe, it, expect } from 'vitest';
import { rollingWindowTotalMm } from './precipSemantics';

const NOW = Date.UTC(2026, 10, 11, 14, 0);
const MIN = 60_000;
/** A station that says «the last 60 minutes» every `everyMin`, raining `rate` mm/h all the time. */
const steady = (rate: number, everyMin: number, hours: number) =>
  Array.from({ length: (hours * 60) / everyMin + 1 }, (_, i) => ({ t: NOW - i * everyMin * MIN, mm: rate }));

describe('rollingWindowTotalMm', () => {
  it('steady rain of 1 mm/h is 24 mm in a day, whatever the cadence of the readings', () => {
    expect(rollingWindowTotalMm(steady(1, 30, 25), NOW, 1440).mm).toBeCloseTo(24, 1);
    expect(rollingWindowTotalMm(steady(1, 60, 25), NOW, 1440).mm).toBeCloseTo(24, 1);
    expect(rollingWindowTotalMm(steady(1, 10, 25), NOW, 1440).mm).toBeCloseTo(24, 1);
  });

  it('adding the overlapping readings up would double it: it does not', () => {
    const s = steady(2, 30, 25);
    expect(s.filter((x) => x.t > NOW - 1440 * MIN).reduce((a, x) => a + x.mm, 0)).toBe(96);
    expect(rollingWindowTotalMm(s, NOW, 1440).mm).toBeCloseTo(48, 1);
  });

  it('a hole counts an hour at most and shows in the coverage', () => {
    const s = steady(1, 30, 25).filter((x) => x.t > NOW - 6 * 60 * MIN || x.t < NOW - 12 * 60 * MIN);
    const out = rollingWindowTotalMm(s, NOW, 1440);
    expect(out.coveredMin).toBeLessThan(1440 * 0.9);
    expect(out.mm).toBeLessThan(24);
  });

  it('nothing to say with one reading or none', () => {
    expect(rollingWindowTotalMm([], NOW, 1440)).toEqual({ mm: 0, coveredMin: 0, lastAt: null });
    expect(rollingWindowTotalMm([{ t: NOW, mm: 3 }], NOW, 1440).coveredMin).toBe(0);
  });
});
