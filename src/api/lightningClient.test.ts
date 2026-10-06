/**
 * The strikes url is asked for by every open tab, every minute or two, and it
 * is the one feed a delay could matter in. What these tests pin is the thing
 * that decides whether a crowd costs one request or one each: two people
 * asking at the same moment must ask for the SAME url, or no cache — ours or
 * the edge's — can ever answer either of them.
 */
import { describe, it, expect } from 'vitest';
import { buildStrikesUrl, apiWindowMinutes, mergeStrikes, type RecentStrikeRow } from './lightningClient';
import type { LightningStrike } from '../types/lightning';

const at = (iso: string) => buildStrikesUrl(Date.parse(iso));
const param = (url: string, name: string) =>
  new URLSearchParams(url.slice(url.indexOf('?') + 1)).get(name)!;

describe('buildStrikesUrl', () => {
  it('gives the same url to everyone asking within the same half minute', () => {
    const a = at('2026-09-23T10:15:07.412Z');
    const b = at('2026-09-23T10:15:29.998Z');
    expect(a).toBe(b);
  });

  it('moves on to the next url once the half minute is over', () => {
    expect(at('2026-09-23T10:15:29.998Z')).not.toBe(at('2026-09-23T10:15:30.001Z'));
  });

  it('never carries milliseconds, which is what made every url unique', () => {
    const url = at('2026-09-23T10:15:07.412Z');
    expect(param(url, 'fechaInicio')).toBe('2026-09-23T10:15:00.000Z');
    expect(url).not.toContain('07.412');
  });

  it('still asks for the last twenty four hours, newest first', () => {
    // MeteoGalicia reads fechaInicio as the newer end of the range.
    const url = at('2026-09-23T10:15:07.412Z');
    const newer = Date.parse(param(url, 'fechaInicio'));
    const older = Date.parse(param(url, 'fechaFin'));
    expect(newer - older).toBe(24 * 60 * 60 * 1000);
  });

  it('rounds down, never forward into a future that has no strikes yet', () => {
    const now = Date.parse('2026-09-23T10:15:59.999Z');
    expect(Date.parse(param(buildStrikesUrl(now), 'fechaInicio'))).toBeLessThanOrEqual(now);
  });
});

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
