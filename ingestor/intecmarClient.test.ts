import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The client keeps its session, pace, breaker and daily count in module state: a fresh module per test.
// Fake timers run the 1.5 s pause and the 5 s retry wait instantly.
async function freshClient() {
  vi.resetModules();
  return import('./intecmarClient');
}

const jwt = () => `x.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3 * 3600 })).toString('base64url')}.y`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const isLogin = (u: unknown) => String(u).includes('/auth/');

/** Runs a promise while advancing the fake clock, and returns how it settled. */
async function settle<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  const out = p.then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));
  await vi.runAllTimersAsync();
  return out;
}

describe('intecmarClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T10:00:00Z'));
    process.env.INTECMAR_USER = 'test-user';
    process.env.INTECMAR_PASSWORD = 'test-password';
    delete process.env.INTECMAR_MAX_REQUESTS_PER_DAY;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.INTECMAR_USER;
    delete process.env.INTECMAR_PASSWORD;
    delete process.env.INTECMAR_MAX_REQUESTS_PER_DAY;
  });

  it('a rejected login stops every later request without asking again (no insisting on the account)', async () => {
    const fetchMock = vi.fn(async () => json({ detail: 'bad' }, 401));
    vi.stubGlobal('fetch', fetchMock);
    const c = await freshClient();
    const a = await settle(c.intecmarGet('/moorings/station/active', {}, c.newPass('vivo')));
    const b = await settle(c.intecmarGet('/moorings/station/active', {}, c.newPass('noche')));
    expect(a.ok || a.error).toBeInstanceOf(c.IntecmarAuthError);
    expect(b.ok || b.error).toBeInstanceOf(c.IntecmarAuthError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(c.intecmarStopped()).toMatch(/HTTP 401/);
  });

  it('one login serves both callers, and every request (login included) is counted by caller', async () => {
    const fetchMock = vi.fn(async (url: unknown) => (isLogin(url) ? json({ access_token: jwt() }) : json([])));
    vi.stubGlobal('fetch', fetchMock);
    const c = await freshClient();
    await settle(Promise.all([
      c.intecmarGet('/moorings/station/active', {}, c.newPass('vivo')),
      c.intecmarGet('/ctd/cast/lasts', { top: 1 }, c.newPass('noche')),
    ]));
    expect(fetchMock.mock.calls.filter(([u]) => isLogin(u))).toHaveLength(1);
    const { current } = c.intecmarLedger().ledger;
    expect(current.total).toBe(3);
    expect((current.byTag.vivo ?? 0) + (current.byTag.noche ?? 0)).toBe(3);
  });

  it('expired token: ONE new login per pass; refused again, the pass is aborted (no login per request)', async () => {
    const fetchMock = vi.fn(async (url: unknown) => (isLogin(url) ? json({ access_token: jwt() }) : json({ detail: 'expired' }, 401)));
    vi.stubGlobal('fetch', fetchMock);
    const c = await freshClient();
    const pass = c.newPass('vivo');
    const first = await settle(c.intecmarGet('/moorings/data/15001/81/10minute', {}, pass));
    expect(first.ok || first.error).toBeInstanceOf(c.IntecmarSessionError);
    // login, data 401, the pass's one new login, data 401 again: abort.
    expect(fetchMock.mock.calls.map(([u]) => (isLogin(u) ? 'login' : 'data'))).toEqual(['login', 'data', 'login', 'data']);
    // The same pass gets no second new login: the next request is refused on its first 401.
    const second = await settle(c.intecmarGet('/moorings/data/15001/82/10minute', {}, pass));
    expect(second.ok || second.error).toBeInstanceOf(c.IntecmarSessionError);
    expect(fetchMock.mock.calls.filter(([u]) => isLogin(u))).toHaveLength(2);
    expect(c.intecmarStopped()).toBeNull(); // not a wrong password: the next pass may try again
  });

  it('errors in a row: at most one retry per request, and the breaker stops the source after 5 failures', async () => {
    const fetchMock = vi.fn(async (url: unknown) => (isLogin(url) ? json({ access_token: jwt() }) : json({}, 503)));
    vi.stubGlobal('fetch', fetchMock);
    const c = await freshClient();
    const pass = c.newPass('vivo');
    for (let i = 0; i < 5; i++) {
      const r = await settle(c.intecmarGet('/moorings/data/15001/81/10minute', {}, pass));
      expect(r.ok || r.error).toBeInstanceOf(c.IntecmarHttpError);
    }
    // 1 login + 5 requests x 2 attempts (the first try and its one retry).
    expect(fetchMock).toHaveBeenCalledTimes(11);
    expect(c.intecmarBreakerOpen()).toBe(true);
    const refused = await settle(c.intecmarGet('/moorings/data/15001/81/10minute', {}, c.newPass('noche')));
    expect(refused.ok || refused.error).toBeInstanceOf(c.IntecmarBreakerError);
    expect(fetchMock).toHaveBeenCalledTimes(11);
    // An hour later it lets requests through again.
    vi.setSystemTime(new Date('2026-10-21T11:30:00Z'));
    expect(c.intecmarBreakerOpen()).toBe(false);
  });

  it('a success between failures closes the count again', async () => {
    let n = 0;
    const fetchMock = vi.fn(async (url: unknown) => {
      if (isLogin(url)) return json({ access_token: jwt() });
      n++;
      return n % 6 === 0 ? json([]) : json({}, 500); // 2 failed requests (4 tries), then a success on the retry...
    });
    vi.stubGlobal('fetch', fetchMock);
    const c = await freshClient();
    for (let i = 0; i < 8; i++) await settle(c.intecmarGet('/x', {}, c.newPass('vivo')));
    expect(c.intecmarBreakerOpen()).toBe(false);
  });

  it('the daily cap refuses the request instead of sending it', async () => {
    process.env.INTECMAR_MAX_REQUESTS_PER_DAY = '1';
    const fetchMock = vi.fn(async (url: unknown) => (isLogin(url) ? json({ access_token: jwt() }) : json([])));
    vi.stubGlobal('fetch', fetchMock);
    const c = await freshClient();
    const r = await settle(c.intecmarGet('/moorings/station/active', {}, c.newPass('vivo')));
    expect(r.ok || r.error).toBeInstanceOf(c.IntecmarBudgetError);
    expect(fetchMock).toHaveBeenCalledTimes(1); // the login took the only request of the day
    expect(c.intecmarRequestsLeft()).toBe(0);
  });
});
