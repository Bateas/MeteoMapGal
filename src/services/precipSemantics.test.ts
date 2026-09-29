import { describe, it, expect } from 'vitest';
import { precipKindFor, precipSamplesFromHistory, rainInWindowMm, type PrecipSample } from './precipSemantics';
import type { NormalizedReading } from '../types/station';

const T = (iso: string) => Date.parse(iso);
const MIN = 60_000;
// 26-ago, the instant of the rain-veto study (UTC).
const NOW = T('2026-08-26T15:20:53Z');

describe('precipKindFor', () => {
  it('reads the meaning of the field from the network prefix', () => {
    expect(precipKindFor('mg_10154')).toBe('interval');
    expect(precipKindFor('aemet_1484C')).toBe('interval');
    expect(precipKindFor('ipma_1210702')).toBe('interval');
    expect(precipKindFor('nt_70:ee:50:00:00:01')).toBe('rolling60');
    expect(precipKindFor('wu_IREDON36')).toBe('dayTotal');
    expect(precipKindFor('mc_ESGAL3600000036316A')).toBe('dayTotal');
  });

  it('is null for a network whose meaning is unknown', () => {
    expect(precipKindFor('skyx_SKY100')).toBeNull();
    expect(precipKindFor('station')).toBeNull();
  });
});

describe('rainInWindowMm — interval (mg_, aemet_, ipma_)', () => {
  // mg_10154 every 10 min: 13:20 = 0.8 (before the window), 13:30 = 0.1, 15:00 = 0.2, the rest 0.
  const mg: PrecipSample[] = [];
  for (let t = T('2026-08-26T13:20:00Z'); t <= T('2026-08-26T15:20:00Z'); t += 10 * MIN) {
    const mm = t === T('2026-08-26T13:20:00Z') ? 0.8
      : t === T('2026-08-26T13:30:00Z') ? 0.1
        : t === T('2026-08-26T15:00:00Z') ? 0.2 : 0;
    mg.push({ t, mm });
  }

  it('sums the readings inside the window (26-ago: 0.1 + 0.2, the 0.8 of 13:20 is outside)', () => {
    expect(rainInWindowMm('mg_10154', mg, NOW, 120)).toBeCloseTo(0.3, 5);
  });

  it('gives the same answer for unsorted input', () => {
    const shuffled = [...mg].reverse();
    shuffled.push(shuffled.shift()!);
    expect(rainInWindowMm('mg_10154', shuffled, NOW, 120)).toBeCloseTo(0.3, 5);
  });

  it('counts a reading 119 min old; one exactly 120 min old holds the rain of the 10 min before the window', () => {
    expect(rainInWindowMm('mg_1', [{ t: NOW - 119 * MIN, mm: 0.4 }], NOW, 120)).toBeCloseTo(0.4, 5);
    expect(rainInWindowMm('mg_1', [{ t: NOW - 120 * MIN, mm: 0.4 }, { t: NOW - 10 * MIN, mm: 0 }], NOW, 120)).toBe(0);
    expect(rainInWindowMm('mg_1', [{ t: NOW - 121 * MIN, mm: 0.4 }, { t: NOW - 10 * MIN, mm: 0 }], NOW, 120)).toBe(0);
  });

  it('26-ago at 15:20:00 sharp: the 13:20 reading (0.8) is still out, it is the rain of 13:10-13:20', () => {
    expect(rainInWindowMm('mg_10154', mg, T('2026-08-26T15:20:00Z'), 120)).toBeCloseTo(0.3, 5);
  });

  it('is null with no reading inside the window', () => {
    expect(rainInWindowMm('aemet_1484C', [{ t: NOW - 3 * 60 * MIN, mm: 1 }], NOW, 120)).toBeNull();
    expect(rainInWindowMm('aemet_1484C', [], NOW, 120)).toBeNull();
  });

  it('ignores readings stamped after now', () => {
    expect(rainInWindowMm('mg_1', [{ t: NOW - 5 * MIN, mm: 0.1 }, { t: NOW + 5 * MIN, mm: 3 }], NOW, 120)).toBeCloseTo(0.1, 5);
  });
});

describe('rainInWindowMm — dayTotal (wu_, mc_)', () => {
  it('measures how much the counter grew (wu_IREDON36 26-ago: 4.32 → 4.57 → 4.83 = 0.51)', () => {
    const wu: PrecipSample[] = [
      { t: T('2026-08-26T13:20:00Z'), mm: 4.32 },
      { t: T('2026-08-26T14:55:00Z'), mm: 4.57 },
      { t: T('2026-08-26T14:59:00Z'), mm: 4.83 },
    ];
    expect(rainInWindowMm('wu_IREDON36', wu, NOW, 120)).toBeCloseTo(0.51, 5);
    expect(rainInWindowMm('wu_IREDON36', [wu[2], wu[0], wu[1]], NOW, 120)).toBeCloseTo(0.51, 5);
  });

  it('a counter all afternoon at 4.83 after a morning shower is no rain now', () => {
    const flat = [0, 30, 60, 90, 120].map((m) => ({ t: NOW - m * MIN, mm: 4.83 }));
    expect(rainInWindowMm('wu_X', flat, NOW, 120)).toBe(0);
  });

  it('treats a reset as a reset, not as negative rain (5.0 → 0 → 0.3 → 0.3 = 0.3)', () => {
    const s = [
      { t: NOW - 100 * MIN, mm: 5.0 },
      { t: NOW - 70 * MIN, mm: 0 },
      { t: NOW - 40 * MIN, mm: 0.3 },
      { t: NOW - 10 * MIN, mm: 0.3 },
    ];
    expect(rainInWindowMm('mc_X', s, NOW, 120)).toBeCloseTo(0.3, 5);
  });

  it('is null with a single reading: growth needs two', () => {
    expect(rainInWindowMm('wu_X', [{ t: NOW - 10 * MIN, mm: 2 }], NOW, 120)).toBeNull();
  });

  it('measures from a reading up to 30 min before the window, not older', () => {
    const start = NOW - 120 * MIN;
    // Baseline 30 min before the window start: its growth counts.
    expect(rainInWindowMm('wu_X', [{ t: start - 30 * MIN, mm: 1 }, { t: NOW - 5 * MIN, mm: 1.5 }], NOW, 120)).toBeCloseTo(0.5, 5);
    // 31 min before: too old to say where the counter stood; no reading left to compare.
    expect(rainInWindowMm('wu_X', [{ t: start - 31 * MIN, mm: 1 }, { t: NOW - 5 * MIN, mm: 1.5 }], NOW, 120)).toBeNull();
    // Without a baseline, from the first reading inside the window.
    expect(rainInWindowMm('wu_X', [{ t: start - 31 * MIN, mm: 1 }, { t: NOW - 60 * MIN, mm: 1.2 }, { t: NOW - 5 * MIN, mm: 1.5 }], NOW, 120)).toBeCloseTo(0.3, 5);
  });
});

describe('rainInWindowMm — rolling60 (nt_)', () => {
  it('takes the largest reading whose own hour lies inside the window, never a sum', () => {
    const nt = [
      { t: NOW - 90 * MIN, mm: 0.9 }, // its hour started 150 min ago: partly before the window
      { t: NOW - 50 * MIN, mm: 0.3 },
      { t: NOW - 30 * MIN, mm: 0.3 },
      { t: NOW - 10 * MIN, mm: 0.1 },
    ];
    expect(rainInWindowMm('nt_A', nt, NOW, 120)).toBeCloseTo(0.3, 5);
  });

  it('is null when no reading covers the last hour', () => {
    expect(rainInWindowMm('nt_A', [{ t: NOW - 90 * MIN, mm: 0.9 }], NOW, 120)).toBeNull();
  });
});

describe('rainInWindowMm — unknown network', () => {
  it('is null', () => {
    expect(rainInWindowMm('skyx_SKY100', [{ t: NOW - 5 * MIN, mm: 3 }], NOW, 120)).toBeNull();
  });
});

describe('precipSamplesFromHistory', () => {
  const r = (iso: string, precipitation: number | null): NormalizedReading => ({
    stationId: 'mg_1', timestamp: new Date(iso), windSpeed: null, windGust: null, windDirection: null,
    temperature: null, humidity: null, precipitation, solarRadiation: null, pressure: null, dewPoint: null,
  });

  it('keeps readings with a value, one per timestamp, sorted, current reading included', () => {
    const history = [
      r('2026-08-26T15:00:00Z', 0.2),
      r('2026-08-26T14:40:00Z', null),
      r('2026-08-26T14:50:00Z', 0),
      r('2026-08-26T15:00:00Z', 0.2),
    ];
    const current = r('2026-08-26T15:10:00Z', 0.1);
    expect(precipSamplesFromHistory(history, current)).toEqual([
      { t: T('2026-08-26T14:50:00Z'), mm: 0 },
      { t: T('2026-08-26T15:00:00Z'), mm: 0.2 },
      { t: T('2026-08-26T15:10:00Z'), mm: 0.1 },
    ]);
  });

  it('works with no history, and with nothing at all', () => {
    expect(precipSamplesFromHistory(undefined, r('2026-08-26T15:10:00Z', 0.1))).toHaveLength(1);
    expect(precipSamplesFromHistory(undefined, undefined)).toEqual([]);
    expect(precipSamplesFromHistory([r('2026-08-26T15:10:00Z', null)], undefined)).toEqual([]);
  });
});

describe('rainInWindowMm — a broken gauge is not rain (29-sep)', () => {
  const NOW = Date.UTC(2026, 8, 29, 12, 0);
  const every5 = (mm0: number, step: number, n: number) => Array.from({ length: n }, (_, i) => ({ t: NOW - (n - 1 - i) * 5 * 60_000, mm: mm0 + i * step }));

  it('wu_INIGRN10: a day counter rising 12 mm every 5 min (144 mm/h) is unknown, not heavy rain', () => {
    expect(rainInWindowMm('wu_INIGRN10', every5(294, 12, 14), NOW, 60)).toBeNull();
    expect(rainInWindowMm('wu_INIGRN10', every5(294, 12, 26), NOW, 120)).toBeNull();
  });

  it('the real maximum of the day (25.8 mm in an hour at an interval station) is kept', () => {
    const s = Array.from({ length: 6 }, (_, i) => ({ t: NOW - (5 - i) * 10 * 60_000, mm: 4.3 }));
    expect(rainInWindowMm('mg_10169', s, NOW, 60)).toBeCloseTo(25.8, 1);
  });

  it('a short intense burst over a 30-minute window is not thrown away (the hour is the base)', () => {
    const s = [{ t: NOW - 20 * 60_000, mm: 12 }, { t: NOW - 10 * 60_000, mm: 18 }, { t: NOW, mm: 10 }];
    expect(rainInWindowMm('mg_10169', s, NOW, 30)).toBe(40);
  });

  it('a Netatmo last-hour value above the ceiling is unknown', () => {
    expect(rainInWindowMm('nt_abc', [{ t: NOW - 5 * 60_000, mm: 150 }], NOW, 60)).toBeNull();
  });
});

