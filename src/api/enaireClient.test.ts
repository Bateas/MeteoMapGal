/**
 * ENAIRE answers by layer. If one layer fails, the list is not «no zones», it is «we don't
 * know», and the drone tab must not read «sin restricciones». On 28-oct ENAIRE's firewall
 * refused our server: every layer failed, the empty list was taken as a good answer and the
 * tab said «SIN RESTRICCIONES» in green. And a dead ENAIRE is asked less and less often.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  __resetEnaireForTests, enaireCooldownMs, EnaireUnavailableError, fetchActiveNotams, fetchUasZones,
} from './enaireClient';

const BBOX: [number, number, number, number] = [-8.9, 42.1, -8.5, 42.4];
const MIN = 60_000;

type Answer = 'ok' | 'forbidden' | 'layer-error' | 'drone-notam';

// A real one from ENAIRE's drone NOTAM service (29-oct), geometry shortened to its own corners.
const DRONE_NOTAM = {
  attributes: {
    notamId: 'V48168/26', itemA: 'LECM', itemB: 1791441540000, itemC: 1794158580000,
    itemE: 'TEMPO SEGREGATED AREA ACTIVATED FOR UNMANNED ACFT FLYING WI COORD: 420733N 0075823W - 420726N 0075736W CELANOVA, OURENSE',
    DESCRIPTION: '<b>DESDE:</b>08/10/2026 06:39:00<br /><b>DESCRIPCI�N:</b>TEMPO SEGREGATED AREA',
    LOWER_VAL: 0, UPPER_VAL: 400, LOWER_VAL_AGL: null, qcode: 'RTCA',
  },
  geometry: { rings: [[[-7.973, 42.126], [-7.960, 42.124], [-7.977, 42.084], [-8.004, 42.096], [-7.973, 42.126]]] },
};
let answers: (url: string) => Answer;
const fetchMock = vi.fn(async (url: string) => {
  const a = answers(url);
  if (a === 'forbidden') return { ok: false, status: 403, json: async () => ({}) };
  if (a === 'layer-error') return { ok: true, status: 200, json: async () => ({ error: { message: 'Invalid query', code: 400 } }) };
  if (a === 'drone-notam') return { ok: true, status: 200, json: async () => ({ features: [DRONE_NOTAM] }) };
  return { ok: true, status: 200, json: async () => ({ features: [] }) };
});

beforeEach(() => {
  __resetEnaireForTests();
  fetchMock.mockClear();
  answers = () => 'ok';
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const later = (ms: number) => vi.setSystemTime(Date.now() + ms);

describe('ENAIRE zones', () => {
  it('a complete answer with no zones is a real «no zones», and it is kept for the day', async () => {
    await expect(fetchUasZones(BBOX)).resolves.toEqual([]);
    const calls = fetchMock.mock.calls.length;
    expect(calls).toBe(3); // the three layers
    later(60 * MIN);
    await expect(fetchUasZones(BBOX)).resolves.toEqual([]);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('one layer refused makes the answer unknown, not empty', async () => {
    answers = (url) => (url.includes('/2/query') ? 'forbidden' : 'ok');
    await expect(fetchUasZones(BBOX)).rejects.toBeInstanceOf(EnaireUnavailableError);
  });

  it('a layer that answers with an error in the body counts as a failure too', async () => {
    answers = (url) => (url.includes('/0/query') ? 'layer-error' : 'ok');
    await expect(fetchUasZones(BBOX)).rejects.toBeInstanceOf(EnaireUnavailableError);
  });

  it('after a failure the last complete answer is served, within a week', async () => {
    await fetchUasZones(BBOX);
    later(25 * 60 * MIN); // past the 24 h cache
    answers = () => 'forbidden';
    await expect(fetchUasZones(BBOX)).resolves.toEqual([]);
    later(7 * 24 * 60 * MIN);
    await expect(fetchUasZones(BBOX)).rejects.toBeInstanceOf(EnaireUnavailableError);
  });
});

describe('ENAIRE NOTAMs', () => {
  it('serve a complete answer for 2 h when ENAIRE fails, never older', async () => {
    await expect(fetchActiveNotams(BBOX)).resolves.toEqual([]);
    answers = () => 'forbidden';
    later(31 * MIN); // past the 30 min cache
    await expect(fetchActiveNotams(BBOX)).resolves.toEqual([]);
    later(95 * MIN); // 2 h 06 after the good answer, and past the 30 min pause
    await expect(fetchActiveNotams(BBOX)).rejects.toBeInstanceOf(EnaireUnavailableError);
  });
});

describe('ENAIRE drone NOTAMs', () => {
  it('are asked to the drone service, area layer only', async () => {
    await fetchActiveNotams(BBOX);
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('/insignias/rest/services/NOTAM/NOTAM_UAS_APP_V3/MapServer/1/query?');
    expect(urls[0]).not.toContain('InfoARES');
  });

  it('read dates, place, text and heights from the fields the service sends today', async () => {
    answers = () => 'drone-notam';
    const [n] = await fetchActiveNotams(BBOX);
    expect(n.notamId).toBe('V48168/26');
    expect(n.location).toBe('LECM');
    // NOTAM times are UTC: item B 08/10/2026 06:39, item C 08/11/2026 17:23
    expect(n.startDate.toISOString()).toBe('2026-10-08T06:39:00.000Z');
    expect(n.endDate.toISOString()).toBe('2026-11-08T17:23:00.000Z');
    expect(n.description).toMatch(/^TEMPO SEGREGATED AREA/); // item E, not the HTML copy
    expect(n.lowerAltitudeFt).toBe(0);
    expect(n.upperAltitudeFt).toBe(400);
    expect(n.qcode).toBe('RTCA');
    expect(n.geometry.type).toBe('Polygon');
  });
});

describe('a dead ENAIRE is asked less and less often', () => {
  it('pauses 30 min, then 1 h, 2 h and 4 h at most', () => {
    expect([1, 2, 3, 4, 5, 9].map((n) => enaireCooldownMs(n) / MIN)).toEqual([30, 60, 120, 240, 240, 240]);
  });

  it('asks nothing during the pause, and the pause grows', async () => {
    answers = () => 'forbidden';
    await expect(fetchUasZones(BBOX)).rejects.toBeInstanceOf(EnaireUnavailableError);
    const first = fetchMock.mock.calls.length;

    later(10 * MIN);
    await expect(fetchUasZones(BBOX)).rejects.toBeInstanceOf(EnaireUnavailableError);
    await expect(fetchActiveNotams(BBOX)).rejects.toBeInstanceOf(EnaireUnavailableError);
    expect(fetchMock.mock.calls.length).toBe(first); // one pause for both services

    later(21 * MIN); // 31 min after the failure
    await expect(fetchUasZones(BBOX)).rejects.toBeInstanceOf(EnaireUnavailableError);
    const second = fetchMock.mock.calls.length;
    expect(second).toBeGreaterThan(first);

    later(31 * MIN); // the second pause is 1 h
    await fetchUasZones(BBOX).catch(() => undefined);
    expect(fetchMock.mock.calls.length).toBe(second);

    later(30 * MIN);
    answers = () => 'ok';
    await expect(fetchUasZones(BBOX)).resolves.toEqual([]);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(second);
  });

  it('a good answer resets the pause to 30 min', async () => {
    answers = () => 'forbidden';
    await fetchUasZones(BBOX).catch(() => undefined);
    later(31 * MIN);
    await fetchUasZones(BBOX).catch(() => undefined); // second failure: pause 1 h
    later(61 * MIN);
    answers = () => 'ok';
    await fetchUasZones(BBOX);
    answers = () => 'forbidden';
    await fetchActiveNotams(BBOX).catch(() => undefined); // first failure again
    const calls = fetchMock.mock.calls.length;
    later(31 * MIN);
    await fetchActiveNotams(BBOX).catch(() => undefined);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
  });
});
