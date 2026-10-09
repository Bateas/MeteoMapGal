import { describe, it, expect } from 'vitest';
import { firstRunDelayMs, msToNextSlot, msToSlotAfterRun } from './startupSchedule';

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

describe('lightning slots: never two requests to MeteoGalicia in less than 5 minutes', () => {
  const SLOT = 5 * MIN, OFF = 30_000;
  const slot0 = Date.parse('2026-10-09T13:00:30Z'); // a slot: 30 s past a multiple of 5 min

  it('the first poll after a start waits for the next slot, whatever the start time', () => {
    expect(msToNextSlot(slot0 + 10_000, SLOT, OFF)).toBe(SLOT - 10_000);
    expect(msToNextSlot(slot0 - 10_000, SLOT, OFF)).toBe(10_000);
    expect(msToNextSlot(slot0, SLOT, OFF)).toBe(SLOT); // exactly on a slot: the next one
  });

  it('a crash loop (start every 30 s) asks at most once per slot', () => {
    const asked = new Set<number>();
    for (let start = slot0 + 1_000; start < slot0 + 30 * MIN; start += 30_000) asked.add(start + msToNextSlot(start, SLOT, OFF));
    const times = [...asked].sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(SLOT);
  });

  it('after a run, the next is the slot at least half a slot away (a timer firing early does not ask twice)', () => {
    expect(msToSlotAfterRun(slot0 + 3_000, SLOT, OFF)).toBe(SLOT - 3_000);
    expect(slot0 - 1 + msToSlotAfterRun(slot0 - 1, SLOT, OFF)).toBe(slot0 + SLOT);
    expect(slot0 + 4 * MIN + msToSlotAfterRun(slot0 + 4 * MIN, SLOT, OFF)).toBe(slot0 + 2 * SLOT);
  });
});
