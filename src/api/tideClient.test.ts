import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchTidePredictions,
  fetchTides48h,
  formatToLocalHHMM,
  formatToLocalDate,
} from './tideClient';

describe('tideClient time formatting', () => {
  it('formats UTC time to Europe/Madrid summer time (CEST, UTC+2)', () => {
    // 2026-09-20 16:39 UTC -> 18:39 CEST
    const date = new Date(Date.UTC(2026, 8, 20, 16, 39, 0));
    expect(formatToLocalHHMM(date)).toBe('18:39');
    expect(formatToLocalDate(date)).toBe('2026-09-20');
  });

  it('formats UTC time to Europe/Madrid winter time (CET, UTC+1)', () => {
    // 2026-01-15 16:39 UTC -> 17:39 CET
    const date = new Date(Date.UTC(2026, 0, 15, 16, 39, 0));
    expect(formatToLocalHHMM(date)).toBe('17:39');
    expect(formatToLocalDate(date)).toBe('2026-01-15');
  });

  it('correctly shifts date across midnight when UTC+2 rolls into next day', () => {
    // 2026-09-20 22:55 UTC -> 2026-09-21 00:55 CEST
    const date = new Date(Date.UTC(2026, 8, 20, 22, 55, 0));
    expect(formatToLocalHHMM(date)).toBe('00:55');
    expect(formatToLocalDate(date)).toBe('2026-09-21');
  });
});

describe('fetchTidePredictions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses IHM UTC tide predictions and converts them to local Spanish time', async () => {
    const mockIhmResponse = {
      mareas: {
        puerto: 'Vigo',
        fecha: '2026-09-20',
        datos: {
          marea: [
            { hora: '03:21', altura: '1.752', tipo: 'bajamar' },
            { hora: '09:55', altura: '2.645', tipo: 'pleamar' },
            { hora: '16:39', altura: '1.641', tipo: 'bajamar' },
            { hora: '22:55', altura: '2.498', tipo: 'pleamar' },
          ],
        },
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockIhmResponse,
    });

    const points = await fetchTidePredictions('29', new Date('2026-09-20T12:00:00Z'));

    expect(points).toHaveLength(4);

    // 03:21 UTC -> 05:21 CEST
    expect(points[0].time).toBe('05:21');
    expect(points[0].type).toBe('low');
    expect(points[0].height).toBe(1.752);
    expect(points[0].rawUtc).toBe('03:21');

    // 09:55 UTC -> 11:55 CEST
    expect(points[1].time).toBe('11:55');
    expect(points[1].type).toBe('high');
    expect(points[1].height).toBe(2.645);

    // 16:39 UTC -> 18:39 CEST (this was the user's reported bug: 16 y algo vs 18:38!)
    expect(points[2].time).toBe('18:39');
    expect(points[2].type).toBe('low');
    expect(points[2].height).toBe(1.641);
    expect(points[2].date).toBe('2026-09-20');

    // 22:55 UTC -> 00:55 CEST on next day (2026-09-21)
    expect(points[3].time).toBe('00:55');
    expect(points[3].type).toBe('high');
    expect(points[3].date).toBe('2026-09-21');
    expect(points[3].epochMs).toBe(new Date('2026-09-20T22:55:00Z').getTime());
  });

  it('returns empty array when IHM response is empty or missing datos', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ mareas: {} }),
    });

    const points = await fetchTidePredictions('29');
    expect(points).toEqual([]);
  });
});

describe('fetchTides48h', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('partitions 48h tides accurately by local calendar day', async () => {
    const r19 = {
      mareas: {
        fecha: '2026-09-19',
        datos: {
          marea: [
            { hora: '14:50', altura: '1.674', tipo: 'bajamar' },
            { hora: '21:10', altura: '2.437', tipo: 'pleamar' }, // 23:10 CEST Sept 19
          ],
        },
      },
    };

    const r20 = {
      mareas: {
        fecha: '2026-09-20',
        datos: {
          marea: [
            { hora: '03:21', altura: '1.752', tipo: 'bajamar' }, // 05:21 CEST Sept 20
            { hora: '09:55', altura: '2.645', tipo: 'pleamar' }, // 11:55 CEST Sept 20
            { hora: '16:39', altura: '1.641', tipo: 'bajamar' }, // 18:39 CEST Sept 20
            { hora: '22:55', altura: '2.498', tipo: 'pleamar' }, // 00:55 CEST Sept 21
          ],
        },
      },
    };

    const r21 = {
      mareas: {
        fecha: '2026-09-21',
        datos: {
          marea: [
            { hora: '04:58', altura: '1.680', tipo: 'bajamar' }, // 06:58 CEST Sept 21
            { hora: '11:17', altura: '2.782', tipo: 'pleamar' }, // 13:17 CEST Sept 21
            { hora: '17:49', altura: '1.472', tipo: 'bajamar' }, // 19:49 CEST Sept 21
          ],
        },
      },
    };

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T12:00:00+02:00'));

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('date=20260919')) return { ok: true, json: async () => r19 };
      if (url.includes('date=20260920')) return { ok: true, json: async () => r20 };
      if (url.includes('date=20260921')) return { ok: true, json: async () => r21 };
      return { ok: false, status: 404 };
    });

    const result = await fetchTides48h('29');

    // Today (Sept 20) should have 3 tides: 05:21, 11:55, 18:39
    expect(result.today).toHaveLength(3);
    expect(result.today[0].time).toBe('05:21');
    expect(result.today[1].time).toBe('11:55');
    expect(result.today[2].time).toBe('18:39');

    // Tomorrow (Sept 21) should have 4 tides: 00:55, 06:58, 13:17, 19:49
    expect(result.tomorrow).toHaveLength(4);
    expect(result.tomorrow[0].time).toBe('00:55');
    expect(result.tomorrow[1].time).toBe('06:58');
    expect(result.tomorrow[2].time).toBe('13:17');
    expect(result.tomorrow[3].time).toBe('19:49');

    // Yesterday (Sept 19) and all combined points
    expect(result.yesterday).toBeDefined();
    expect(result.all).toBeDefined();
    expect((result.all?.length ?? 0)).toBeGreaterThanOrEqual(7);

    vi.useRealTimers();
  });
});
