import { describe, it, expect } from 'vitest';
import { firstRunDelayMs } from './startupSchedule';

const MIN = 60_000;
const NOW = Date.parse('2026-09-29T21:34:00Z');

describe('firstRunDelayMs — a restart does not ask Open-Meteo again before its turn', () => {
  it('last grid 50 min ago, every 120 min: the first run waits the 70 min left', () => {
    expect(firstRunDelayMs(NOW - 50 * MIN, 120 * MIN, 4.5 * MIN, NOW)).toBe(70 * MIN);
  });

  it('overdue, or nothing stored: the usual short delay after start', () => {
    expect(firstRunDelayMs(NOW - 5 * 60 * MIN, 120 * MIN, 4.5 * MIN, NOW)).toBe(4.5 * MIN);
    expect(firstRunDelayMs(null, 120 * MIN, 4.5 * MIN, NOW)).toBe(4.5 * MIN);
    expect(firstRunDelayMs(Number.NaN, 120 * MIN, 4.5 * MIN, NOW)).toBe(4.5 * MIN);
  });

  it('never earlier than the short delay, even when the turn is almost up', () => {
    expect(firstRunDelayMs(NOW - 118 * MIN, 120 * MIN, 4.5 * MIN, NOW)).toBe(4.5 * MIN);
  });
});
