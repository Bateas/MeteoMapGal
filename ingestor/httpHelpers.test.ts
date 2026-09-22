/**
 * What every answer tells the caches in front of us. Anything cacheable is
 * served by Cloudflare and by our own proxy to EVERY visitor for that long,
 * so a failure answered as cacheable would be handed out for a minute.
 */
import { describe, it, expect } from 'vitest';
import type http from 'node:http';
import { json, error } from './httpHelpers';

/** The two things these helpers do to a response: status and headers. */
function fakeRes() {
  const set: Record<string, string> = {};
  const seen: { status?: number; headers?: Record<string, string>; body?: string } = {};
  const res = {
    setHeader(name: string, value: string) { set[name] = value; },
    getHeader(name: string) { return set[name]; },
    writeHead(status: number, headers: Record<string, string>) {
      seen.status = status;
      seen.headers = headers;
    },
    end(body: string) { seen.body = body; },
  } as unknown as http.ServerResponse;
  return { res, seen };
}

const cacheOf = (seen: { headers?: Record<string, string> }) => seen.headers?.['Cache-Control'];

describe('json / error cache headers', () => {
  it('a plain answer is fresh for a minute', () => {
    const { res, seen } = fakeRes();
    json(res, { ok: true });
    expect(seen.status).toBe(200);
    expect(cacheOf(seen)).toBe('public, max-age=60');
    expect(seen.body).toBe('{"ok":true}');
  });

  it('respects what the route asked for instead of overriding it', () => {
    const { res, seen } = fakeRes();
    res.setHeader('Cache-Control', 'public, max-age=3600');
    json(res, { ok: true });
    expect(cacheOf(seen)).toBe('public, max-age=3600');
  });

  it('an explicit value wins over both', () => {
    const { res, seen } = fakeRes();
    res.setHeader('Cache-Control', 'public, max-age=3600');
    json(res, { ok: true }, 200, undefined, 'no-store');
    expect(cacheOf(seen)).toBe('no-store');
  });

  it('a failure is never cacheable, whatever the route had set', () => {
    for (const status of [400, 404, 500, 503]) {
      const { res, seen } = fakeRes();
      res.setHeader('Cache-Control', 'public, max-age=300');
      error(res, 'nope', status);
      expect(seen.status).toBe(status);
      expect(cacheOf(seen)).toBe('no-store');
      expect(seen.body).toBe('{"error":"nope"}');
    }
  });
});
