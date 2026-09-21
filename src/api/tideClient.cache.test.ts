/**
 * The last-good tide table. A day's table is astronomical and never changes,
 * so when the IHM fails the previous answer for that same day is served
 * instead of every tide surface failing at once.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

describe('tideClient last-good table', () => {
  beforeEach(() => {
    localStorage.clear();
    __clearTideTableCacheForTests();
    vi.mocked(fetchWithRetry).mockReset();
  });

  it('serves the stored table for the same day when the IHM fails', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(ihmPayload('2026-09-22'));
    const live = await fetchTidePredictions('29', DAY);
    expect(live).toHaveLength(2);
    expect(isTideFromCache('29', DAY)).toBe(false);

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
    expect(url).toContain('startTime=2026-09-22T00:00:00');
  });

  it('prefers the stored IHM table over the MeteoGalicia stand-in', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(ihmPayload('2026-09-22'));
    const live = await fetchTidePredictions('29', DAY);

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
    vi.mocked(fetchWithRetry).mockResolvedValueOnce(empty);
    expect(await fetchTidePredictions('29', DAY)).toEqual([]);

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

      vi.mocked(fetchWithRetry).mockResolvedValue(failing);
      const cached = await fetchTides48h('29');
      expect(cached.fromCache).toBe(true);
      expect(cached.today.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
