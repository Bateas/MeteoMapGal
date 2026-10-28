import { describe, it, expect } from 'vitest';
import { clientIpOf, clampInt, hitBucket, isAllowedPushEndpoint, isValidPushSpotList, parseTimeRange, pruneCache, memoAsync } from './requestGuards';

describe('clientIpOf — the bucket key must not be something the client wrote', () => {
  it('prefers the tunnel header, which the client cannot forge', () => {
    expect(clientIpOf({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '192.0.2.1, 203.0.113.9' }, '127.0.0.1'))
      .toBe('203.0.113.9');
  });

  it('ignores a spoofed first X-Forwarded-For hop and takes the one the proxy appended', () => {
    // A first hop the client wrote is never the key.
    expect(clientIpOf({ 'x-forwarded-for': '192.0.2.77, 198.51.100.4' }, '127.0.0.1')).toBe('198.51.100.4');
  });

  it('falls back to X-Real-IP before X-Forwarded-For', () => {
    expect(clientIpOf({ 'x-real-ip': '198.51.100.5', 'x-forwarded-for': '192.0.2.8' }, undefined)).toBe('198.51.100.5');
  });

  it('uses the socket on the dev server, where no proxy sets anything', () => {
    expect(clientIpOf({}, '::1')).toBe('::1');
    expect(clientIpOf({}, undefined)).toBe('unknown');
  });

  it('treats an empty header as absent', () => {
    expect(clientIpOf({ 'cf-connecting-ip': '  ' }, '192.0.2.1')).toBe('192.0.2.1');
  });
});

describe('clampInt', () => {
  it('bounds what the client asked for', () => {
    expect(clampInt('100000', 1, 30, 7)).toBe(30);
    expect(clampInt('-5', 1, 30, 7)).toBe(1);
    expect(clampInt('12', 1, 30, 7)).toBe(12);
  });

  it('uses the fallback for garbage or nothing', () => {
    expect(clampInt('abc', 1, 30, 7)).toBe(7);
    expect(clampInt(undefined, 1, 30, 7)).toBe(7);
    expect(clampInt('', 1, 30, 7)).toBe(7);
  });
});

describe('isValidPushSpotList — a subscription must opt into a curated spot', () => {
  const VALID = new Set(['cesantes', 'lourido']);
  it('accepts one or more curated ids', () => {
    expect(isValidPushSpotList(['cesantes'], VALID)).toBe(true);
    expect(isValidPushSpotList(['cesantes', 'lourido'], VALID)).toBe(true);
  });
  it('rejects an empty list: the dispatcher would never contact or prune that row', () => {
    expect(isValidPushSpotList([], VALID)).toBe(false);
  });
  it('rejects unknown ids, non-strings, non-arrays and more than 20 entries', () => {
    expect(isValidPushSpotList(['inventado'], VALID)).toBe(false);
    expect(isValidPushSpotList([1], VALID)).toBe(false);
    expect(isValidPushSpotList('cesantes', VALID)).toBe(false);
    expect(isValidPushSpotList(Array(21).fill('cesantes'), VALID)).toBe(false);
  });
});

describe('isAllowedPushEndpoint — only real browser push services', () => {
  it('accepts the four services browsers use', () => {
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abc:def')).toBe(true);
    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/xyz')).toBe(true);
    expect(isAllowedPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/QWERTY')).toBe(true);
  });

  it('rejects an arbitrary https host — only the known push services', () => {
    expect(isAllowedPushEndpoint('https://evil.example.com/collect')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.example/x')).toBe(false);
  });

  it('rejects plain http, credentials in the URL, and a bare suffix', () => {
    expect(isAllowedPushEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false);
    expect(isAllowedPushEndpoint('https://user:pw@fcm.googleapis.com/fcm/send/abc')).toBe(false);
    expect(isAllowedPushEndpoint('https://notify.windows.com/x')).toBe(false);
  });

  it('rejects non-strings, junk and oversize', () => {
    expect(isAllowedPushEndpoint(42)).toBe(false);
    expect(isAllowedPushEndpoint('not a url')).toBe(false);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/' + 'a'.repeat(1000))).toBe(false);
  });
});

describe('pruneCache — expired first, then a hard cap', () => {
  it('drops expired entries even when under the cap', () => {
    const c = new Map([['old', { ts: 0 }], ['new', { ts: 900 }]]);
    pruneCache(c, 500, 10, 1000);
    expect([...c.keys()]).toEqual(['new']);
  });

  it('never keeps more than max, evicting the oldest inserted', () => {
    // The bypass: thousands of distinct unexpired keys inside one TTL.
    const c = new Map<string, { ts: number }>();
    for (let i = 0; i < 500; i++) c.set(`k${i}`, { ts: 1000 });
    pruneCache(c, 60_000, 100, 1000);
    expect(c.size).toBe(100);
    expect(c.has('k0')).toBe(false);
    expect(c.has('k499')).toBe(true);
  });
});

describe('memoAsync — at most one query per TTL, whatever the request rate', () => {
  it('shares a single in-flight call among concurrent callers', async () => {
    let calls = 0;
    let t = 0;
    const get = memoAsync(60_000, async () => { calls++; return calls; }, () => t);
    const results = await Promise.all([get(), get(), get()]);
    expect(results).toEqual([1, 1, 1]);
    expect(calls).toBe(1);
  });

  it('serves the stored value inside the TTL and refreshes after it', async () => {
    let calls = 0;
    let t = 0;
    const get = memoAsync(1000, async () => { calls++; return calls; }, () => t);
    expect(await get()).toBe(1);
    t = 999;
    expect(await get()).toBe(1);
    t = 1001;
    expect(await get()).toBe(2);
    expect(calls).toBe(2);
  });

  it('does not cache a failure, so the next caller retries', async () => {
    let calls = 0;
    const get = memoAsync(1000, async () => { calls++; if (calls === 1) throw new Error('db down'); return 'ok'; }, () => 0);
    await expect(get()).rejects.toThrow('db down');
    expect(await get()).toBe('ok');
  });
});

describe('hitBucket — a fixed window per key that cannot grow without bound', () => {
  it('counts up to max inside the window, then refuses until it resets', () => {
    const m = new Map<string, { count: number; resetAt: number }>();
    expect(hitBucket(m, 'a', 0, 2, 1000)).toBe(true);
    expect(hitBucket(m, 'a', 10, 2, 1000)).toBe(true);
    expect(hitBucket(m, 'a', 20, 2, 1000)).toBe(false);
    expect(hitBucket(m, 'a', 1001, 2, 1000)).toBe(true);
  });
  it('keeps at most cap keys, dropping the oldest windows first', () => {
    const m = new Map<string, { count: number; resetAt: number }>();
    for (let i = 0; i < 10; i++) hitBucket(m, 'k' + i, i, 5, 1000, 4);
    expect(m.size).toBe(4);
    expect([...m.keys()]).toEqual(['k6', 'k7', 'k8', 'k9']);
  });
});

describe('parseTimeRange — bounded from/to for the historical routes', () => {
  const NOW = Date.parse('2026-10-28T12:00:00Z');
  it('defaults to the last 24 h', () => {
    expect(parseTimeRange(undefined, undefined, 365, NOW)).toEqual({ from: '2026-10-27T12:00:00.000Z', to: '2026-10-28T12:00:00.000Z' });
  });
  it('passes a valid range through unchanged', () => {
    expect(parseTimeRange('2026-10-01', '2026-10-28T10:00:00Z', 365, NOW)).toEqual({ from: '2026-10-01', to: '2026-10-28T10:00:00Z' });
  });
  it('rejects garbage, a reversed range and a span wider than the cap', () => {
    expect(parseTimeRange('ayer', undefined, 365, NOW)).toHaveProperty('error');
    expect(parseTimeRange('2026-10-28', '2026-10-01', 365, NOW)).toHaveProperty('error');
    expect(parseTimeRange('1970-01-01', undefined, 365, NOW)).toHaveProperty('error');
  });
});
