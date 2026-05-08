/**
 * Tests for the tiny concurrency limiter used to throttle the per-station
 * fetch fan-out (so we don't blow up the LXC DNS resolver).
 */
import { describe, it, expect } from 'vitest';
import { allSettledLimit } from './concurrency';

describe('allSettledLimit', () => {
  it('returns results in the original order', async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await allSettledLimit(items, async (x) => x * 10, 2);
    expect(results.map((r) => r.status === 'fulfilled' ? r.value : null)).toEqual(
      [10, 20, 30, 40, 50],
    );
  });

  it('caps the in-flight count at the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await allSettledLimit(items, async () => {
      inFlight++;
      if (inFlight > peak) peak = inFlight;
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
    }, 4);

    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(0);
  });

  it('captures rejections without crashing the batch', async () => {
    const results = await allSettledLimit([1, 2, 3], async (x) => {
      if (x === 2) throw new Error('boom');
      return x;
    }, 2);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(results[2].status).toBe('fulfilled');
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
  });

  it('handles concurrency > items.length gracefully', async () => {
    const results = await allSettledLimit([1, 2], async (x) => x, 100);
    expect(results.length).toBe(2);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });

  it('handles empty input', async () => {
    const results = await allSettledLimit([], async (x: number) => x, 4);
    expect(results).toEqual([]);
  });

  it('rejects concurrency < 1', async () => {
    await expect(allSettledLimit([1], async (x) => x, 0)).rejects.toThrow();
  });

  it('passes the index argument to the worker', async () => {
    const indices: number[] = [];
    await allSettledLimit(['a', 'b', 'c'], async (_item, i) => {
      indices.push(i);
    }, 1);
    expect(indices).toEqual([0, 1, 2]);
  });
});
