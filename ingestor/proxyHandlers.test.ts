/**
 * Real users got a 502 for the AEMET station inventory: AEMET failed, and the
 * "serve the last good copy" path had nothing to serve, because every cache
 * here was pruned at its freshness TTL. These pin the three pieces that make
 * the last good copy exist and be the right one.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { aemetTtlFor, aemetAnswerOk, aemetDataPaths, AEMET_INVENTORY_TTL, isMeteoSixErrorEnvelope, createDownMemo, downStatus, gatewayStatus, DOWN_FIRST_MS, DOWN_MAX_MS, GRACE_WINDOW_MS } from './proxyHandlers';

const b = (s: string) => Buffer.from(s, 'utf8');

/** A step-one answer exactly as AEMET sent it on 23-sep. */
const STEP_ONE = b(`{
  "descripcion" : "exito",
  "estado" : 200,
  "datos" : "https://opendata.aemet.es/opendata/sh/a9ce101b",
  "metadatos" : "https://opendata.aemet.es/opendata/sh/0556af7a"
}`);

describe('aemetTtlFor', () => {
  it('keeps the station inventory for hours: it barely changes', () => {
    expect(aemetTtlFor('/api/valores/climatologicos/inventarioestaciones/todasestaciones'))
      .toBe(AEMET_INVENTORY_TTL);
  });

  it('keeps observations short: they change every few minutes', () => {
    expect(aemetTtlFor('/api/observacion/convencional/todas')).toBeLessThan(10 * 60_000);
  });
});

describe('aemetAnswerOk', () => {
  it('accepts a real step-one answer', () => {
    expect(aemetAnswerOk(STEP_ONE)).toBe(true);
  });

  it('rejects AEMET failures dressed as a 200', () => {
    // Caching this under a twelve-hour TTL would serve it to everyone all day.
    expect(aemetAnswerOk(b('{"descripcion":"Limite de peticiones","estado":429}'))).toBe(false);
    expect(aemetAnswerOk(b('{ "descripcion" : "No hay datos", "estado" : 404 }'))).toBe(false);
  });

  it('accepts data payloads, which are arrays', () => {
    expect(aemetAnswerOk(b('[{"indicativo":"1484C","nombre":"PONTEVEDRA"}]'))).toBe(true);
    expect(aemetAnswerOk(b('  \n[ ]'))).toBe(true);
  });

  it('reads Latin-1 bodies without choking (AEMET data is ISO-8859-1)', () => {
    expect(aemetAnswerOk(Buffer.from('[{"nombre":"OURENSE, A CORUÑA"}]', 'latin1'))).toBe(true);
  });
});

describe('aemetDataPaths', () => {
  it('returns both step-two paths in the form the data route receives them', () => {
    expect(aemetDataPaths(STEP_ONE)).toEqual(['/opendata/sh/a9ce101b', '/opendata/sh/0556af7a']);
  });

  it('ignores anything that does not point at AEMET', () => {
    expect(aemetDataPaths(b('{"estado":200,"datos":"https://example.com/opendata/sh/x"}'))).toEqual([]);
  });

  it('returns nothing for a body that is not a step-one answer', () => {
    expect(aemetDataPaths(b('[1,2,3]'))).toEqual([]);
    expect(aemetDataPaths(b('no es json'))).toEqual([]);
  });
});

describe('isMeteoSixErrorEnvelope', () => {
  it('spots the error answer MeteoSIX sends with a 200', () => {
    expect(isMeteoSixErrorEnvelope(b('{"exception":{"code":"000","message":"Mmmm... algo ha ido mal."}}'))).toBe(true);
    expect(isMeteoSixErrorEnvelope(b(' { "exception" : {"message":"No se puede obtener la informacion"}}'))).toBe(true);
  });

  it('lets a real table through, even one that mentions the word later on', () => {
    expect(isMeteoSixErrorEnvelope(b('{"type":"FeatureCollection","features":[{"properties":{"note":"exception"}}]}'))).toBe(false);
    expect(isMeteoSixErrorEnvelope(b(''))).toBe(false);
  });
});

// ── Negative cache (21-oct audit, finding 9) ──────────────────────────────

describe('createDownMemo', () => {
  const make = () => {
    let now = 1_000_000;
    return { memo: createDownMemo(() => now), advance: (ms: number) => { now += ms; } };
  };

  it('pauses a failed resource 1 min, doubling while it keeps failing, up to 5 min', () => {
    const { memo, advance } = make();
    expect(memo.noteFailure('k', 503)).toEqual({ pauseMs: DOWN_FIRST_MS, first: true });
    expect(memo.downFor('k')).toEqual({ status: 503, remainingMs: DOWN_FIRST_MS });
    advance(DOWN_FIRST_MS);
    expect(memo.downFor('k')).toBeNull();
    expect(memo.noteFailure('k', 503).pauseMs).toBe(2 * DOWN_FIRST_MS);
    expect(memo.noteFailure('k', 503).pauseMs).toBe(4 * DOWN_FIRST_MS);
    expect(memo.noteFailure('k', 503).pauseMs).toBe(DOWN_MAX_MS);
    expect(memo.noteFailure('k', 503)).toEqual({ pauseMs: DOWN_MAX_MS, first: false });
  });

  it('the first good answer clears it, and each resource has its own pause', () => {
    const { memo } = make();
    memo.noteFailure('a', 502);
    expect(memo.downFor('b')).toBeNull();
    memo.noteSuccess('a');
    expect(memo.downFor('a')).toBeNull();
    expect(memo.noteFailure('a', 502).first).toBe(true);
  });

  it('with grace, a lone failure only counts and the second in a row pauses', () => {
    const { memo, advance } = make();
    expect(memo.noteFailure('tides', 502, true)).toEqual({ pauseMs: 0, first: false });
    expect(memo.downFor('tides')).toBeNull();
    expect(memo.noteFailure('tides', 502, true)).toEqual({ pauseMs: DOWN_FIRST_MS, first: true });
    memo.noteSuccess('tides');
    memo.noteFailure('tides', 502, true);
    advance(GRACE_WINDOW_MS + 1); // a lone failure long ago is forgotten
    expect(memo.noteFailure('tides', 502, true).pauseMs).toBe(0);
  });

  it('stays bounded', () => {
    const memo = createDownMemo(() => 0, 3);
    for (const k of ['a', 'b', 'c', 'd']) memo.noteFailure(k, 500);
    expect(memo.downFor('a')).toBeNull();
    expect(memo.downFor('d')).not.toBeNull();
  });
});

describe('downStatus', () => {
  it('passes a 4xx through (a refused key is not a gateway error) and turns the rest into 502', () => {
    expect(downStatus(401)).toBe(401);
    expect(downStatus(429)).toBe(429);
    expect(downStatus(500)).toBe(502);
    expect(downStatus(0)).toBe(502);
  });
});

describe('gatewayStatus', () => {
  it('a provider 5xx goes out as 502; 2xx and 4xx as they came', () => {
    for (const s of [500, 503, 504]) expect(gatewayStatus(s)).toBe(502);
    expect(gatewayStatus(200)).toBe(200);
    expect(gatewayStatus(404)).toBe(404);
    expect(gatewayStatus(429)).toBe(429);
  });
});

/** Enough of http.ServerResponse for the handlers. */
function fakeRes() {
  const r = {
    status: 0,
    headers: {} as Record<string, string>,
    body: '',
    setHeader(k: string, v: unknown) { r.headers[k.toLowerCase()] = String(v); },
    getHeader(k: string) { return r.headers[k.toLowerCase()]; },
    writeHead(s: number, h?: Record<string, string>) {
      r.status = s;
      for (const [k, v] of Object.entries(h ?? {})) r.headers[k.toLowerCase()] = String(v);
      return r;
    },
    end(b?: unknown) { r.body = b == null ? '' : String(b); },
  };
  return r;
}

describe('ObsCosteiro proxy with the provider failing', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('asks once, then answers without asking until the pause ends; serves the last copy meanwhile', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T09:00:00Z'));
    vi.stubEnv('OBSCOSTEIRO_API_KEY', 'test-key');
    vi.resetModules();
    const { handleObsCosteiroProxy } = await import('./proxyHandlers');

    let status = 503;
    const fetchMock = vi.fn(async () => new Response(status === 200 ? '{"ok":1}' : 'down', { status }));
    vi.stubGlobal('fetch', fetchMock);
    const path = '/ultimo/recente/15001';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = async () => { const r = fakeRes(); await handleObsCosteiroProxy(path, r as any); return r; };

    // Cold and failing: the failure goes out once...
    let r = await call();
    expect(r.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // ...and the next visitors in the pause get an error without a request.
    r = await call();
    expect(r.headers['x-cache']).toBe('DOWN');
    expect(r.status).toBe(502);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Pause over and the provider back: a fresh copy.
    vi.setSystemTime(Date.now() + DOWN_FIRST_MS + 1);
    status = 200;
    r = await call();
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Copy expired and the provider down again: stale copy, and during the pause no ask at all.
    vi.setSystemTime(Date.now() + 4 * 60_000);
    status = 500;
    r = await call();
    expect(r.headers['x-cache']).toBe('STALE');
    expect(r.body).toBe('{"ok":1}');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    r = await call();
    expect(r.headers['x-cache']).toBe('STALE');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('AEMET data proxy with an expired temporary url', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('a 404 does not pause the resource: the next visitor still asks AEMET', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T09:00:00Z'));
    vi.resetModules();
    const { handleAemetDataProxy } = await import('./proxyHandlers');
    const fetchMock = vi.fn(async () => new Response('{"estado":404}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = async () => { const r = fakeRes(); await handleAemetDataProxy('/opendata/sh/deadbeef', r as any); return r; };

    let r = await call();
    expect(r.status).toBe(404);
    r = await call();
    expect(r.headers['x-cache']).not.toBe('DOWN');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// Audit 28-oct: the keyed proxies signed whatever path a visitor chose. Now an exact list.
describe('keyed proxies — only the exact requests the map makes', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const src = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

  it('the AEMET list holds exactly the step-one paths the frontend asks for', async () => {
    const { AEMET_STEP_ONE_PATHS } = await import('./proxyHandlers');
    const used = new Set<string>();
    for (const f of ['src/config/apiEndpoints.ts', 'src/api/aemetAvisosClient.ts']) {
      for (const m of src(f).matchAll(/\/api\/v1\/aemet(\/api\/[A-Za-z0-9_/]+)/g)) used.add(m[1]);
    }
    expect([...used].sort()).toEqual([...AEMET_STEP_ONE_PATHS].sort());
  });

  it('AEMET answers 400 to any other path without asking AEMET', async () => {
    vi.stubEnv('AEMET_API_KEY', 'test-key');
    vi.resetModules();
    const { handleAemetProxy } = await import('./proxyHandlers');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const p of ['/api/prediccion/especifica/municipio/diaria/36057', '/opendata/x', '/api/observacion/convencional/todas/extra']) {
      const r = fakeRes();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await handleAemetProxy(p, r as any);
      expect(r.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AEMET step two takes only /opendata/sh/<code>', async () => {
    const { isAemetDataPath } = await import('./proxyHandlers');
    expect(isAemetDataPath('/opendata/sh/a9ce101b')).toBe(true);
    expect(isAemetDataPath('/api/observacion/convencional/todas')).toBe(false);
    expect(isAemetDataPath('/opendata/sh/a9ce101b/extra')).toBe(false);
    expect(isAemetDataPath('/opendata/sh/..%2Fx')).toBe(false);
    expect(isAemetDataPath('/dist/index.html')).toBe(false);
  });

  it('only the temporary path a resource handed out LAST shares its cache and pause', async () => {
    vi.resetModules();
    const m = await import('./proxyHandlers');
    const R = '/api/observacion/convencional/todas';
    m.__rememberDataOriginForTests(R, STEP_ONE);
    expect(m.aemetDataKey('/opendata/sh/a9ce101b').key).toBe(`data:${R}`);
    // A newer answer supersedes it: the old path no longer touches the shared copy.
    m.__rememberDataOriginForTests(R, b('{"estado":200,"datos":"https://opendata.aemet.es/opendata/sh/bbbb0001"}'));
    expect(m.aemetDataKey('/opendata/sh/bbbb0001').key).toBe(`data:${R}`);
    expect(m.aemetDataKey('/opendata/sh/a9ce101b').key).toBe('data-raw:/opendata/sh/a9ce101b');
    // A path no answer ever handed out never collides with a resource key.
    expect(m.aemetDataKey('/opendata/sh/ffff0000').key).toBe('data-raw:/opendata/sh/ffff0000');
  });

  it('the ObsCosteiro list matches the buoys the frontend polls', async () => {
    const { OBSCOSTEIRO_BUOY_IDS } = await import('./proxyHandlers');
    const ids = [...src('src/api/observatorioCosteiro.ts').matchAll(/obsId:\s*(\d+)/g)].map((x) => Number(x[1]));
    expect(ids.sort()).toEqual([...OBSCOSTEIRO_BUOY_IDS].sort());
  });

  it('ObsCosteiro takes only /ultimo/recente/<known id>', async () => {
    const { isAllowedObsCosteiroPath } = await import('./proxyHandlers');
    expect(isAllowedObsCosteiroPath('/ultimo/recente/15001')).toBe(true);
    expect(isAllowedObsCosteiroPath('/ultimo/recente/99999')).toBe(false);
    expect(isAllowedObsCosteiroPath('/ultimo/otra/cosa')).toBe(false);
    expect(isAllowedObsCosteiroPath('/ultimo/..%2F..%2Fmeteo2api/v1/api/x')).toBe(false);
    expect(isAllowedObsCosteiroPath('/ultimo/recente/15001/x')).toBe(false);
  });

  it('ObsCosteiro answers 400 to any other path without calling the gateway', async () => {
    vi.stubEnv('OBSCOSTEIRO_API_KEY', 'test-key');
    vi.resetModules();
    const { handleObsCosteiroProxy } = await import('./proxyHandlers');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = fakeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleObsCosteiroProxy('/ultimo/..%2F..%2Fx', r as any);
    expect(r.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('canonicalMeteoSixQuery — our key signs only the shapes the map builds', () => {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const client = fs.readFileSync(path.join(__dirname, '..', 'src/api/meteoSixClient.ts'), 'utf8');
  const listOf = (name: string) => [...(client.split(`const ${name} = [`)[1] ?? '').split(']')[0].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  const q = (vars: string[], model: string, grid: string, coords = '-8.619,42.307') =>
    `coords=${coords}&variables=${vars.join(',')}&models=${vars.map(() => model).join(',')}&grids=${vars.map(() => grid).join(',')}&lang=es&format=application/json`;

  it('passes the three forecasts and the tide table the map asks for, unchanged', async () => {
    const { canonicalMeteoSixQuery } = await import('./proxyHandlers');
    const atmo = listOf('ATMO_VARIABLES');
    const marine = listOf('MARINE_VARIABLES');
    expect(atmo.length).toBeGreaterThan(5);
    expect(marine.length).toBe(3);
    for (const s of [q(atmo, 'WRF', '1km'), q(marine, 'USWAN', 'Galicia'), q(['sea_water_temperature'], 'MOHID', 'Vigo'), q(['wind'], 'WRF', '1km')]) {
      expect(canonicalMeteoSixQuery('/getNumericForecastInfo', s)).toBe(s);
    }
    const tides = 'coords=-8.7262,42.2406&lang=es&format=application/json';
    expect(canonicalMeteoSixQuery('/getTidesInfo', tides)).toBe(tides);
  });

  it('rejects extra parameters, another format, mixed models, unknown variables and coordinates outside Galicia', async () => {
    const { canonicalMeteoSixQuery } = await import('./proxyHandlers');
    const ok = q(['wind'], 'WRF', '1km');
    expect(canonicalMeteoSixQuery('/getNumericForecastInfo', `${ok}&x=1`)).toBeNull();
    expect(canonicalMeteoSixQuery('/getNumericForecastInfo', ok.replace('application/json', 'text/html'))).toBeNull();
    expect(canonicalMeteoSixQuery('/getNumericForecastInfo', 'coords=-8.6,42.3&variables=wind,temperature&models=WRF,USWAN&grids=1km,1km&lang=es&format=application/json')).toBeNull();
    expect(canonicalMeteoSixQuery('/getNumericForecastInfo', q(['geopotential'], 'WRF', '1km'))).toBeNull();
    expect(canonicalMeteoSixQuery('/getNumericForecastInfo', q(['wind'], 'WRF', '1km', '-3.7,40.4'))).toBeNull();
    expect(canonicalMeteoSixQuery('/getNumericForecastInfo', `${ok}&coords=-8.1,42.1`)).toBeNull();
  });
});
