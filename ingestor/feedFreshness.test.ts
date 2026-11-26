import { describe, it, expect } from 'vitest';
import { feedFreshness, FEED_STALE_MS } from './feedFreshness';

const now = Date.parse('2026-11-26T17:00:00Z');

describe('feedFreshness — the map is told when the provider stopped answering', () => {
  it('a recent good answer is fresh, with its time', () => {
    const lastOkAt = new Date(now - 4 * 60_000);
    expect(feedFreshness({ lastOkAt }, now)).toEqual({ polledAt: lastOkAt.toISOString(), fresh: true });
  });

  it('fresh up to 15 minutes, stale after', () => {
    expect(feedFreshness({ lastOkAt: new Date(now - FEED_STALE_MS) }, now).fresh).toBe(true);
    expect(feedFreshness({ lastOkAt: new Date(now - FEED_STALE_MS - 1) }, now).fresh).toBe(false);
  });

  it('a row without any good answer is stale, never fresh', () => {
    expect(feedFreshness({ lastOkAt: null }, now)).toEqual({ polledAt: null, fresh: false });
  });

  it('nothing to read (no row, no table, no grant) says nothing', () => {
    expect(feedFreshness(undefined, now)).toEqual({ polledAt: null, fresh: null });
  });
});
