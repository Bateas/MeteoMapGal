/**
 * The map asks OUR API for lightning: the whole day once, then only the window it is missing,
 * merged here. These pin the window choice and the merge; the browser never builds a
 * MeteoGalicia url any more (noMeteo2api.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { apiWindowMinutes, mergeStrikes, type RecentStrikeRow } from './lightningClient';
import type { LightningStrike } from '../types/lightning';

describe('apiWindowMinutes (own API, 6-oct)', () => {
  const now = Date.parse('2026-10-06T14:00:00Z');
  it('the whole day on the first read', () => {
    expect(apiWindowMinutes(now, null)).toBe(1440);
  });
  it('the last half hour while polling every minute or two', () => {
    expect(apiWindowMinutes(now, now - 60_000)).toBe(30);
    expect(apiWindowMinutes(now, now - 20 * 60_000)).toBe(30);
  });
  it('two hours for a tab woken after a while, the day after longer', () => {
    expect(apiWindowMinutes(now, now - 45 * 60_000)).toBe(120);
    expect(apiWindowMinutes(now, now - 3 * 60 * 60_000)).toBe(1440);
  });
});

describe('mergeStrikes', () => {
  const now = Date.parse('2026-10-06T14:00:00Z');
  const row = (minAgo: number, lat = 42.3, lon = -8.7, ka = -12): RecentStrikeRow => [now - minAgo * 60_000, lat, lon, ka, 0];

  it('adds each strike once and keeps its id across reads', () => {
    const seen = new Map<string, LightningStrike>();
    const ids = { value: 1 };
    const first = mergeStrikes(seen, [row(5), row(10, 42.4)], now, ids);
    const again = mergeStrikes(seen, [row(5), row(2, 42.5)], now + 60_000, ids);
    expect(first).toHaveLength(2);
    expect(again).toHaveLength(3);
    const idOf = (list: LightningStrike[], lat: number) => list.find((s) => s.lat === lat)!.id;
    expect(idOf(again, 42.3)).toBe(idOf(first, 42.3));
  });

  it('newest first, ages for the moment asked, nothing over a day old', () => {
    const seen = new Map<string, LightningStrike>();
    const list = mergeStrikes(seen, [row(30), row(3, 42.4), row(25 * 60, 42.5)], now, { value: 1 });
    expect(list.map((s) => s.ageMinutes)).toEqual([3, 30]);
    expect(seen.size).toBe(2);
  });

  it('keeps the polarity and the ground/cloud flag of each row', () => {
    const [s] = mergeStrikes(new Map(), [[now, 42.3, -8.7, -27, 0]], now, { value: 1 });
    expect(s.peakCurrent).toBe(-27);
    expect(s.cloudToCloud).toBe(false);
  });
});
