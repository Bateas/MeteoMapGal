import { describe, it, expect } from 'vitest';
import { fireEventAgeDays, EVENT_MAX_DAYS } from './FireOverlay';

const NOW = new Date('2026-11-04T12:00:00Z').getTime();
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000);

describe('fireEventAgeDays', () => {
  it('counts from the start of the fire', () => {
    expect(fireEventAgeDays({ fireDate: daysAgo(2), lastUpdate: daysAgo(1) }, NOW)).toBeCloseTo(2);
  });

  it('without a start date it counts from the last revision', () => {
    expect(fireEventAgeDays({ fireDate: null, lastUpdate: daysAgo(1) }, NOW)).toBeCloseTo(1);
  });

  it('with no date at all nothing says how old it is', () => {
    expect(fireEventAgeDays({ fireDate: null, lastUpdate: null }, NOW)).toBeNull();
  });

  it('never negative: a date a little ahead of the clock is today', () => {
    expect(fireEventAgeDays({ fireDate: daysAgo(-0.1), lastUpdate: null }, NOW)).toBe(0);
  });

  it('the map keeps the events of the last 3 days, not of the week', () => {
    expect(EVENT_MAX_DAYS).toBe(3);
  });
});
