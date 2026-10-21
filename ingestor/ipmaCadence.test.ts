import { describe, it, expect, vi } from 'vitest';
import { createIpmaFeed, IPMA_DISCOVERY_REUSE_MS } from './ipmaCadence';

const FEATURE = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-8.6, 41.7] as [number, number] },
  properties: { idEstacao: 1240675, localEstacao: 'Viana do Castelo', time: '2026-10-21T08:00:00' },
};

function setup(answer: () => Response | Promise<Response>) {
  let now = Date.parse('2026-10-21T09:06:00Z');
  const fetchFn = vi.fn(async () => answer());
  const feed = createIpmaFeed(fetchFn as unknown as typeof fetch, () => now);
  return { feed, fetchFn, advance: (ms: number) => { now += ms; } };
}

const ok = () => new Response(JSON.stringify({ type: 'FeatureCollection', features: [FEATURE] }), { status: 200 });

describe('IPMA feed', () => {
  it('asks once per 30-min slot and hands back the last file in between', async () => {
    const { feed, fetchFn, advance } = setup(ok);
    expect((await feed.forPoll()).reused).toBe(false);
    for (let k = 0; k < 5; k++) {
      advance(5 * 60_000); // 09:11 ... 09:31, same slot [09:05, 09:35)
      const a = await feed.forPoll();
      expect(a.reused).toBe(true);
      expect(a.features).toHaveLength(1);
    }
    advance(5 * 60_000); // 09:36: next slot
    expect((await feed.forPoll()).reused).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('discovery takes the poll file while it is recent, and asks when it is not', async () => {
    const { feed, fetchFn, advance } = setup(ok);
    await feed.forPoll();
    expect((await feed.forDiscovery()).reused).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    advance(IPMA_DISCOVERY_REUSE_MS);
    expect((await feed.forDiscovery()).reused).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('discovery and poll arriving together share one request', async () => {
    const { feed, fetchFn } = setup(ok);
    await Promise.all([feed.forPoll(), feed.forDiscovery()]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('a failure does not use up the slot: the next cycle asks again, and says why it failed', async () => {
    let status = 503;
    const { feed, fetchFn, advance } = setup(() =>
      status === 200 ? ok() : new Response('down', { status }));
    await expect(feed.forPoll()).rejects.toThrow('HTTP 503');
    advance(5 * 60_000);
    status = 200;
    expect((await feed.forPoll()).reused).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('an empty file is not kept as the last good one', async () => {
    let empty = true;
    const { feed, fetchFn, advance } = setup(() =>
      empty ? new Response(JSON.stringify({ features: [] }), { status: 200 }) : ok());
    expect((await feed.forPoll()).features).toEqual([]);
    advance(60_000);
    empty = false;
    expect((await feed.forPoll()).reused).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
