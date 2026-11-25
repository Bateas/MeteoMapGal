import { describe, it, expect } from 'vitest';
import { countVisitDay } from './visitDays';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}

describe('the install card counts visits by day (18-nov)', () => {
  it('reloading on the first day is still the first visit', () => {
    const s = memory();
    const d1 = new Date(2026, 10, 18, 10);
    expect(countVisitDay(s, d1)).toBe(1);
    expect(countVisitDay(s, new Date(2026, 10, 18, 10, 5))).toBe(1);
    expect(countVisitDay(s, new Date(2026, 10, 18, 22))).toBe(1);
  });

  it('another day is the second visit', () => {
    const s = memory();
    countVisitDay(s, new Date(2026, 10, 18, 10));
    expect(countVisitDay(s, new Date(2026, 10, 19, 9))).toBe(2);
  });

  it('a count kept from before (by loads) is respected', () => {
    const s = memory();
    s.setItem('pwa-visit-count', '5');
    expect(countVisitDay(s, new Date(2026, 10, 18))).toBe(6);
  });
});
