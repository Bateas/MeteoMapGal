import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The live pass with the client and the table mocked: what it asks, what it keeps, when it stays quiet.
const get = vi.fn();
const left = vi.fn(() => 3000);
const capNote = vi.fn();
const breakerOpen = vi.fn(() => false);
const insert = vi.fn(async (rows: unknown[]) => rows.length);

vi.mock('./intecmarClient.js', () => {
  class IntecmarAuthError extends Error {}
  class IntecmarBudgetError extends Error {}
  class IntecmarSessionError extends Error {}
  class IntecmarBreakerError extends Error {}
  return {
    IntecmarAuthError,
    IntecmarBudgetError,
    IntecmarSessionError,
    IntecmarBreakerError,
    newPass: (tag: string) => ({ tag, relogged: false }),
    intecmarBreakerOpen: () => breakerOpen(),
    intecmarCredentials: () => (process.env.INTECMAR_USER ? { user: 'u', password: 'p' } : null),
    intecmarGet: (...a: unknown[]) => get(...a),
    intecmarLedger: () => ({ ledger: { current: { day: '2026-10-19', total: 0, byTag: {} }, previous: null }, startedAt: 0 }),
    intecmarRequestsLeft: () => left(),
    intecmarDailyCap: () => 3000,
    intecmarStopped: () => null,
    noteCapReached: () => capNote(),
  };
});
vi.mock('./intecmarArchive.js', () => ({ insertPlatform: (rows: unknown[]) => insert(rows) }));

const NOW = Date.parse('2026-10-19T16:20:00Z');

/** A one-sample answer for whatever series is asked, Cortegada with valid values at 16:10. */
function answer(path: string, params: { function: string }) {
  const [, , , station, parameterId] = path.split('/');
  const value = Number(parameterId) === 81 ? (params.function === 'RACHA' ? 8.9 : 6.29) : 15;
  const depth = Number(parameterId) >= 20000 ? 1.5 : -5;
  return [{ StationCode: Number(station), ParameterId: Number(parameterId), ParameterCode: 'X', Function: params.function, Depth: depth,
    Samples: [{ Date: '2026-10-19T16:10:00Z', Value: value, QualityCode: 1 }] }];
}

describe('runIntecmarLive', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    process.env.INTECMAR_USER = 'u';
    delete process.env.INTECMAR_LIVE;
    get.mockReset().mockImplementation(async (path: string, params: { function: string }) => answer(path, params));
    left.mockReset().mockReturnValue(3000);
    capNote.mockReset();
    breakerOpen.mockReset().mockReturnValue(false);
    insert.mockClear();
    const m = await import('./intecmarLive');
    m.__resetIntecmarLiveForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.INTECMAR_USER;
    delete process.env.INTECMAR_LIVE;
  });

  it('asks the 37 live series over today, keeps one row per platform and stores what came back', async () => {
    const m = await import('./intecmarLive');
    await m.runIntecmarLive(new Map([[1250, Date.parse('2026-10-19T15:20:00Z')]]), NOW);
    expect(get).toHaveBeenCalledTimes(37);
    expect(get.mock.calls.every(([, p, pass]) => p.begin_date === '2026-10-19' && p.end_date === '2026-10-20' && pass.tag === 'vivo')).toBe(true);
    expect(new Set(get.mock.calls.map(([, , pass]) => pass)).size).toBe(1); // one pass: one new login at most
    const rows = m.intecmarLiveReadings(NOW);
    expect(rows.map((r) => r.stationId).sort((a, b) => a - b)).toEqual([1250, 1251, 1253, 1255, 15009]);
    const cortegada = rows.find((r) => r.stationId === 1250)!;
    expect(cortegada).toMatchObject({ source: 'intecmar', time: '2026-10-19T16:10:00Z', windSpeed: 6.29, windGust: 8.9 });
    expect(rows.find((r) => r.stationId === 1251)!.windSpeed).toBeNull();
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('a pass that does not fit in what is left of the daily cap is not started', async () => {
    left.mockReturnValue(10);
    const m = await import('./intecmarLive');
    await m.runIntecmarLive(new Map(), NOW);
    expect(get).not.toHaveBeenCalled();
    expect(capNote).toHaveBeenCalledTimes(1);
  });

  it('INTECMAR_LIVE=0 switches it off', async () => {
    process.env.INTECMAR_LIVE = '0';
    const m = await import('./intecmarLive');
    await m.runIntecmarLive(new Map(), NOW);
    expect(get).not.toHaveBeenCalled();
    expect(m.intecmarLiveReadings(NOW)).toEqual([]);
  });

  it('a failing series costs that series only; it never throws', async () => {
    get.mockImplementation(async (path: string, params: { function: string }) => {
      if (path.includes('/15004/')) throw new Error('HTTP 502');
      return answer(path, params);
    });
    const m = await import('./intecmarLive');
    await expect(m.runIntecmarLive(new Map(), NOW)).resolves.toBeUndefined();
    expect(m.intecmarLiveReadings(NOW).map((r) => r.stationId)).not.toContain(1253);
    expect(m.intecmarLiveReadings(NOW)).toHaveLength(4);
  });

  it('rows older than six hours are no longer served', async () => {
    const m = await import('./intecmarLive');
    await m.runIntecmarLive(new Map(), NOW);
    expect(m.intecmarLiveReadings(NOW + 7 * 3_600_000)).toEqual([]);
  });

  it('a series that comes back empty (stopped sensor, Cies-like) is not asked again for 6 hours', async () => {
    get.mockImplementation(async (path: string, params: { function: string }) => (path.includes('/15100/') ? [] : answer(path, params)));
    const m = await import('./intecmarLive');
    await m.runIntecmarLive(new Map(), NOW);
    expect(get).toHaveBeenCalledTimes(37);
    get.mockClear();
    await m.runIntecmarLive(new Map(), NOW + 20 * 60_000);
    expect(get).toHaveBeenCalledTimes(32);
    expect(get.mock.calls.some(([path]) => String(path).includes('/15100/'))).toBe(false);
    get.mockClear();
    await m.runIntecmarLive(new Map(), NOW + 6 * 3_600_000 + 60_000);
    expect(get).toHaveBeenCalledTimes(37);
  });

  it('a token refused twice aborts the whole pass (no new login per request)', async () => {
    const { IntecmarSessionError } = await import('./intecmarClient.js');
    get.mockImplementation(async () => { throw new IntecmarSessionError('token rechazado'); });
    const m = await import('./intecmarLive');
    await expect(m.runIntecmarLive(new Map(), NOW)).resolves.toBeUndefined();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('errors in a row: the pass stops when the breaker opens, and waits while it is open', async () => {
    const { IntecmarBreakerError } = await import('./intecmarClient.js');
    let n = 0;
    get.mockImplementation(async () => { n++; if (n >= 5) throw new IntecmarBreakerError('en pausa'); throw new Error('HTTP 503'); });
    const m = await import('./intecmarLive');
    await m.runIntecmarLive(new Map(), NOW);
    expect(get).toHaveBeenCalledTimes(5);
    get.mockClear();
    breakerOpen.mockReturnValue(true);
    await m.runIntecmarLive(new Map(), NOW + 20 * 60_000);
    expect(get).not.toHaveBeenCalled();
  });
});
