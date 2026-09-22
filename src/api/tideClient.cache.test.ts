/**
 * The last-good tide table. A day's table is astronomical and never changes,
 * so when the IHM fails the previous answer for that same day is served
 * instead of every tide surface failing at once.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./fetchWithRetry', () => ({ fetchWithRetry: vi.fn() }));

import { fetchWithRetry } from './fetchWithRetry';
import {
  fetchTidePredictions,
  fetchTides48h,
  isTideFromCache,
  parseMeteoSixTides,
  __clearTideTableCacheForTests,
} from './tideClient';

const DAY = new Date(2026, 8, 22, 12, 0, 0); // 22-Sep-2026, local

function ihmPayload(fecha: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      mareas: {
        fecha,
        datos: {
          marea: [
            { hora: '04:12', altura: '3.10', tipo: 'pleamar' },
            { hora: '10:30', altura: '0.90', tipo: 'bajamar' },
          ],
        },
      },
    }),
  } as unknown as Response;
}

const failing = { ok: false, status: 500, json: async () => ({}) } as unknown as Response;

/** Shape documented in the MeteoSIX v5 manual, chapter 7 (getTidesInfo). */
function meteoSixBody() {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        port: { id: 3, name: 'Vigo' },
        referencePort: { id: 3, name: 'Vigo' },
        days: [{
          timePeriod: { begin: { timeInstant: '2026-09-22T00:00:00+02' }, end: { timeInstant: '2026-09-22T23:59:59+02' } },
          variables: [{
            name: 'tides',
            units: 'm',
            summary: [
              { id: 1, state: 'High tides', timeInstant: '2026-09-22T04:32:00+02', height: 3.12 },
              { id: 2, state: 'Low tides', timeInstant: '2026-09-22T10:47:00+02', height: 0.94 },
              { id: 3, state: 'High tides', timeInstant: '2026-09-22T17:01:00+02', height: '3.30' },
              // Belongs to the next local day: must not leak into this one
              { id: 4, state: 'Low tides', timeInstant: '2026-09-23T00:05:00+02', height: 0.88 },
            ],
            values: [],
          }],
        }],
      },
    }],
  };
}

function meteoSixPayload() {
  return { ok: true, status: 200, json: async () => meteoSixBody() } as unknown as Response;
}

/** What a page reload does to the client: every answer and outage forgotten. */
const reload = () => __clearTideTableCacheForTests();

describe('tideClient last-good table', () => {
  beforeEach(() => {
    // DAY is "today", so the MeteoGalicia stand-in (today onwards only)
    // behaves the same whatever day the suite runs.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(DAY);
    localStorage.clear();
    reload();
    vi.mocked(fetchWithRetry).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves the stored table for the same day when the IHM fails', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(ihmPayload('2026-09-22'));
    const live = await fetchTidePredictions('29', DAY);
    expect(live).toHaveLength(2);
    expect(isTideFromCache('29', DAY)).toBe(false);

    reload();
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(failing);
    const again = await fetchTidePredictions('29', DAY);
    expect(again).toEqual(live);
    expect(isTideFromCache('29', DAY)).toBe(true);
  });

  it('parses the MeteoSIX table into local extremes of that day only', () => {
    const { points, portName } = parseMeteoSixTides(meteoSixBody(), DAY);
    expect(portName).toBe('Vigo');
    expect(points.map((p) => [p.time, p.height, p.type])).toEqual([
      ['04:32', 3.12, 'high'],
      ['10:47', 0.94, 'low'],
      ['17:01', 3.3, 'high'],
    ]);
    expect(points.every((p) => p.source === 'meteosix')).toBe(true);
    expect(points[0].epochMs).toBe(Date.parse('2026-09-22T02:32:00Z'));
  });

  it('survives an answer with no features', () => {
    expect(parseMeteoSixTides({}, DAY)).toEqual({ points: [], portName: null });
    expect(parseMeteoSixTides(null, DAY)).toEqual({ points: [], portName: null });
  });

  it('asks MeteoGalicia for the same day when the IHM fails and nothing is stored', async () => {
    vi.mocked(fetchWithRetry)
      .mockResolvedValueOnce(failing)
      .mockResolvedValueOnce(meteoSixPayload());
    const points = await fetchTidePredictions('29', DAY);
    expect(points).toHaveLength(3);
    expect(points[0].source).toBe('meteosix');

    const url = String(vi.mocked(fetchWithRetry).mock.calls[1][0]);
    expect(url).toContain('/api/v1/meteosix/getTidesInfo');
    expect(url).toContain('coords=-8.73,42.24');
    // Open range: one answer covers today and the next four days
    expect(url).not.toContain('startTime');
  });

  it('prefers the stored IHM table over the MeteoGalicia stand-in', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(ihmPayload('2026-09-22'));
    const live = await fetchTidePredictions('29', DAY);

    reload();
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(failing).mockResolvedValueOnce(meteoSixPayload());
    expect(await fetchTidePredictions('29', DAY)).toEqual(live);
    expect(vi.mocked(fetchWithRetry)).toHaveBeenCalledTimes(2);
  });

  it('names the MeteoGalicia port in the 48 h result when it stood in', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(DAY);
    try {
      vi.mocked(fetchWithRetry).mockImplementation(async (url: string) =>
        String(url).includes('getTidesInfo') ? meteoSixPayload() : failing);
      const result = await fetchTides48h('29');
      expect(result.meteoSixPort).toBe('Vigo');
      expect(result.today.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still fails when there is nothing stored for that day', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(failing);
    await expect(fetchTidePredictions('29', DAY)).rejects.toThrow(/500/);
  });

  it('does not serve another station or another day', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(ihmPayload('2026-09-22'));
    await fetchTidePredictions('29', DAY);

    vi.mocked(fetchWithRetry).mockResolvedValue(failing);
    await expect(fetchTidePredictions('28', DAY)).rejects.toThrow();
    await expect(fetchTidePredictions('29', new Date(2026, 8, 23, 12))).rejects.toThrow();
  });

  it('never overwrites a good table with an empty answer', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(ihmPayload('2026-09-22'));
    const live = await fetchTidePredictions('29', DAY);

    const empty = { ok: true, status: 200, json: async () => ({ mareas: {} }) } as unknown as Response;
    reload();
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(empty);
    expect(await fetchTidePredictions('29', DAY)).toEqual([]);

    reload();
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(failing);
    expect(await fetchTidePredictions('29', DAY)).toEqual(live);
  });

  it('prunes tables older than a few days when it writes a new one', async () => {
    localStorage.setItem('ihm-tide:v1:29:20260101', JSON.stringify([{ time: '01:00', height: 1, type: 'low' }]));
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(ihmPayload('2026-09-22'));
    await fetchTidePredictions('29', DAY);
    expect(localStorage.getItem('ihm-tide:v1:29:20260101')).toBeNull();
  });

  it('flags the 48 h result when it was served from the stored tables', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(DAY);
    try {
      vi.mocked(fetchWithRetry).mockImplementation(async (url: string) => {
        const m = /date=(\d{4})(\d{2})(\d{2})/.exec(String(url));
        return ihmPayload(m ? `${m[1]}-${m[2]}-${m[3]}` : '2026-09-22');
      });
      const live = await fetchTides48h('29');
      expect(live.fromCache).toBe(false);

      reload();
      vi.mocked(fetchWithRetry).mockResolvedValue(failing);
      const cached = await fetchTides48h('29');
      expect(cached.fromCache).toBe(true);
      expect(cached.today.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('tideClient once per page load', () => {
  const calls = (needle: string) =>
    vi.mocked(fetchWithRetry).mock.calls.filter(([url]) => String(url).includes(needle)).length;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(DAY);
    localStorage.clear();
    reload();
    vi.mocked(fetchWithRetry).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a down IHM is probed once, however many surfaces ask at the same time', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(failing); // IHM and MeteoGalicia both down
    // Panel + ticker + spot popup + gauge comparison + a second station, all at page load
    const asks = [
      fetchTides48h('29'),
      fetchTidePredictions(),
      fetchTidePredictions('29', DAY),
      fetchTidePredictions('29', new Date(2026, 8, 21, 12)),
      fetchTides48h('28'),
    ];
    const results = await Promise.allSettled(asks);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(calls('/ihm-api/')).toBe(1);
    expect(calls('getTidesInfo')).toBe(1);
  });

  it('after an outage nothing is asked again until the page is reloaded', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(failing);
    await expect(fetchTides48h('29')).rejects.toThrow();
    const before = vi.mocked(fetchWithRetry).mock.calls.length;

    // The hourly polls of the panel and the ticker, and a popup opened later
    await expect(fetchTides48h('29')).rejects.toThrow();
    await expect(fetchTidePredictions('29', DAY)).rejects.toThrow();
    await expect(fetchTidePredictions('26', DAY)).rejects.toThrow();
    expect(vi.mocked(fetchWithRetry).mock.calls.length).toBe(before);

    reload();
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(ihmPayload('2026-09-22'));
    expect(await fetchTidePredictions('29', DAY)).toHaveLength(2);
  });

  it('keeps each day it got for the page load: the hourly polls do not ask again', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(ihmPayload('2026-09-22'));
    const first = await fetchTidePredictions('29', DAY);
    const second = await fetchTidePredictions('29', DAY);
    expect(second).toBe(first);
    expect(vi.mocked(fetchWithRetry)).toHaveBeenCalledTimes(1);
  });

  it('asks each day once even when several surfaces want it at the same moment', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(ihmPayload('2026-09-22'));
    await Promise.all([fetchTidePredictions('29', DAY), fetchTidePredictions('29', DAY), fetchTidePredictions()]);
    expect(vi.mocked(fetchWithRetry)).toHaveBeenCalledTimes(1);
  });

  it('a 4xx for one station does not stop the IHM for the others', async () => {
    const notFound = { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    vi.mocked(fetchWithRetry).mockImplementation(async (url: string) => {
      if (String(url).includes('id=28')) return notFound;
      if (String(url).includes('getTidesInfo')) return failing;
      return ihmPayload('2026-09-22');
    });
    await expect(fetchTidePredictions('28', DAY)).rejects.toThrow(/404/);
    expect(await fetchTidePredictions('29', DAY)).toHaveLength(2);
    expect(calls('/ihm-api/')).toBe(2);
  });

  it('a 429 counts as the service being down', async () => {
    const limited = { ok: false, status: 429, json: async () => ({}) } as unknown as Response;
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(limited).mockResolvedValue(failing);
    await expect(fetchTidePredictions('28', DAY)).rejects.toThrow(/429/);
    await expect(fetchTidePredictions('29', DAY)).rejects.toThrow();
    expect(calls('/ihm-api/')).toBe(1);
  });

  it('does not ask MeteoGalicia for a past day, which it never serves', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(failing);
    await expect(fetchTidePredictions('29', new Date(2026, 8, 21, 12))).rejects.toThrow();
    expect(calls('getTidesInfo')).toBe(0);
  });

  const envelope = { ok: true, status: 200, json: async () => ({ exception: { code: '000', message: 'Mmmm... algo ha ido mal.' } }) } as unknown as Response;

  function meteoSixTwoDays() {
    const body = meteoSixBody();
    body.features[0].properties.days.push({
      timePeriod: { begin: { timeInstant: '2026-09-23T00:00:00+02' }, end: { timeInstant: '2026-09-23T23:59:59+02' } },
      variables: [{
        name: 'tides',
        units: 'm',
        summary: [
          { id: 5, state: 'High tides', timeInstant: '2026-09-23T05:20:00+02', height: 3.05 },
          { id: 6, state: 'Low tides', timeInstant: '2026-09-23T11:34:00+02', height: 1.01 },
        ],
        values: [],
      }],
    });
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }

  it('one MeteoGalicia answer serves today and tomorrow', async () => {
    vi.mocked(fetchWithRetry).mockImplementation(async (url: string) =>
      String(url).includes('getTidesInfo') ? meteoSixTwoDays() : failing);
    const result = await fetchTides48h('29');
    expect(result.today.length).toBe(3);
    expect(result.tomorrow.map((p) => p.time)).toEqual(['00:05', '05:20', '11:34']);
    expect(calls('getTidesInfo')).toBe(1);
  });

  it('asks MeteoGalicia once more when it answers with its error envelope', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(DAY);
    vi.mocked(fetchWithRetry)
      .mockResolvedValueOnce(failing) // IHM
      .mockResolvedValueOnce(envelope)
      .mockResolvedValueOnce(meteoSixPayload());
    const pending = fetchTidePredictions('29', DAY);
    await vi.runAllTimersAsync();
    expect(await pending).toHaveLength(3);
    expect(calls('getTidesInfo')).toBe(2);
  });

  it('an error envelope twice fails that port only, and only after one retry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(DAY);
    vi.mocked(fetchWithRetry).mockImplementation(async (url: string) => {
      if (!String(url).includes('getTidesInfo')) return failing;
      return String(url).includes('coords=-8.73,42.24') ? envelope : meteoSixPayload();
    });
    const vigo = fetchTidePredictions('29', DAY);
    const settledVigo = vigo.then(() => 'ok', (e: Error) => e.message);
    await vi.runAllTimersAsync();
    expect(await settledVigo).toMatch(/500/); // reports the IHM failure it stood in for
    expect(calls('getTidesInfo')).toBe(2);

    // MeteoGalicia answered, so it is not written off: Marín still asks it
    expect(await fetchTidePredictions('28', DAY)).toHaveLength(3);
    expect(calls('getTidesInfo')).toBe(3);
  });

  it('a failed tomorrow does not hide today: the 48 h view keeps today and leaves tomorrow empty', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(ihmPayload('2026-09-22'));
    await fetchTidePredictions('29', DAY); // an earlier visit stored today
    reload();
    vi.mocked(fetchWithRetry).mockResolvedValue(failing); // IHM and MeteoGalicia down
    const result = await fetchTides48h('29');
    expect(result.today).toHaveLength(2);
    expect(result.tomorrow).toEqual([]);
    expect(result.fromCache).toBe(true);
  });

  it('keeps a 4xx failure for the page load too: the hourly polls do not ask again', async () => {
    const notFound = { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    vi.mocked(fetchWithRetry).mockImplementation(async (url: string) =>
      String(url).includes('getTidesInfo') ? failing : notFound);
    await expect(fetchTidePredictions('28', DAY)).rejects.toThrow(/404/);
    await expect(fetchTidePredictions('28', DAY)).rejects.toThrow(/404/);
    await expect(fetchTides48h('28')).rejects.toThrow(/404/);
    // Today's kept failure rejects the 48 h view at once: let its other two
    // days (the same kept promises) finish before counting.
    await Promise.allSettled([
      fetchTidePredictions('28', new Date(2026, 8, 21, 12)),
      fetchTidePredictions('28', new Date(2026, 8, 23, 12)),
    ]);
    // One request per station-day (21, 22, 23), none repeated
    expect(calls('/ihm-api/')).toBe(3);
  });

  it('a tab open for days asks MeteoGalicia again on a new day, once per port', async () => {
    vi.mocked(fetchWithRetry).mockImplementation(async (url: string) =>
      String(url).includes('getTidesInfo') ? meteoSixPayload() : failing);
    expect(await fetchTidePredictions('29', DAY)).toHaveLength(3);
    expect(calls('getTidesInfo')).toBe(1);

    // Five days later the first answer (today + 4 days) no longer covers today
    vi.setSystemTime(new Date(2026, 8, 27, 12));
    await expect(fetchTidePredictions('29', new Date(2026, 8, 27, 12))).rejects.toThrow();
    expect(calls('getTidesInfo')).toBe(2);
    await expect(fetchTidePredictions('29', new Date(2026, 8, 28, 12))).rejects.toThrow();
    expect(calls('getTidesInfo')).toBe(2);
  });

  it('names the Madrid day everywhere: key, IHM request and MeteoGalicia filter', async () => {
    // 22:30 UTC on the 22nd is already the 23rd in Galicia. On a machine in
    // Madrid the browser date agrees anyway; in UTC or Lisbon it did not.
    const lateNight = new Date('2026-09-22T22:30:00Z');
    vi.setSystemTime(lateNight);
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(ihmPayload('2026-09-23'));
    await fetchTidePredictions('29', lateNight);
    expect(String(vi.mocked(fetchWithRetry).mock.calls[0][0])).toContain('date=20260923');

    reload();
    localStorage.clear();
    vi.mocked(fetchWithRetry).mockImplementation(async (url: string) =>
      String(url).includes('getTidesInfo') ? meteoSixTwoDays() : failing);
    const points = await fetchTidePredictions('29', lateNight);
    expect(points.map((p) => p.date)).toEqual(['2026-09-23', '2026-09-23', '2026-09-23']);
  });

  it('an IHM that fails mid-session stops being asked too', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(ihmPayload('2026-09-22')).mockResolvedValue(failing);
    expect(await fetchTidePredictions('29', DAY)).toHaveLength(2);
    await expect(fetchTidePredictions('29', new Date(2026, 8, 23, 12))).rejects.toThrow();
    const ihmAfterOutage = calls('/ihm-api/');
    await expect(fetchTidePredictions('28', DAY)).rejects.toThrow();
    expect(calls('/ihm-api/')).toBe(ihmAfterOutage);
  });
});
