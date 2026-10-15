import { describe, it, expect } from 'vitest';
import { parseFieldReport, summarizeRecentReports, recentReportWhen, recentReportWhat, reportConflict, KT_RANGES, ktRangeLabel, observerReportWhat } from './fieldReport';

const isValid = (id: string) => id === 'cesantes' || id === 'castrelo';
const base = { spotId: 'cesantes', windVsApp: 1, waterState: 3, dirSeen: 225, appWindKt: 12.34, appVerdict: 'good', appVersion: '2.143.0' };

describe('parseFieldReport', () => {
  it('accepts a complete report and rounds the figure the reporter saw', () => {
    const r = parseFieldReport(base, isValid);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.report.appWindKt).toBe(12.3);
      expect(r.report.waterState).toBe(3);
      expect(r.report.dirSeen).toBe(225);
      expect(r.report.observerCode).toBeNull();
    }
  });

  it('only the wind comparison is required', () => {
    const r = parseFieldReport({ spotId: 'castrelo', windVsApp: 0 }, isValid);
    expect(r.ok && r.report.waterState === null && r.report.dirSeen === null && r.report.appWindKt === null).toBe(true);
  });

  it('rejects spots that are not curated, and anything that is not a fact from the fixed set', () => {
    expect(parseFieldReport({ ...base, spotId: 'user-123' }, isValid)).toEqual({ ok: false, error: 'spotId' });
    expect(parseFieldReport({ ...base, windVsApp: 2 }, isValid)).toEqual({ ok: false, error: 'windVsApp' });
    expect(parseFieldReport({ ...base, windVsApp: '1' }, isValid)).toEqual({ ok: false, error: 'windVsApp' });
    expect(parseFieldReport({ ...base, waterState: 4 }, isValid)).toEqual({ ok: false, error: 'waterState' });
    expect(parseFieldReport({ ...base, dirSeen: 200 }, isValid)).toEqual({ ok: false, error: 'dirSeen' });
    expect(parseFieldReport({ ...base, dirSeen: '225' }, isValid)).toEqual({ ok: false, error: 'dirSeen' });
    expect(parseFieldReport({ ...base, appWindKt: 300 }, isValid)).toEqual({ ok: false, error: 'appWindKt' });
    expect(parseFieldReport({ ...base, appVerdict: 'epic' }, isValid)).toEqual({ ok: false, error: 'appVerdict' });
    expect(parseFieldReport({ ...base, appVersion: '<script>' }, isValid)).toEqual({ ok: false, error: 'appVersion' });
    expect(parseFieldReport(null, isValid)).toEqual({ ok: false, error: 'body' });
  });

  it('keeps a well-formed observer code and silently drops a malformed one', () => {
    const good = parseFieldReport({ ...base, observerCode: 'observer2026' }, isValid);
    const short = parseFieldReport({ ...base, observerCode: 'obs2026' }, isValid);   // too short to be one of ours
    expect(short.ok && short.report.observerCode).toBeNull();
    const bad = parseFieldReport({ ...base, observerCode: "x'; DROP TABLE" }, isValid);
    expect(good.ok && good.report.observerCode).toBe('observer2026');
    expect(bad.ok && bad.report.observerCode).toBeNull();
  });
});

describe('what people at the water said lately', () => {
  type W = -1 | 0 | 1;
  type Wa = 0 | 1 | 2 | 3 | null;
  type D = 0 | 45 | 90 | 135 | 180 | 225 | 270 | 315 | null;
  const row = (minutesAgo: number, windVsApp: W, waterState: Wa = null, dirSeen: D = null, appWindKt: number | null = 9) =>
    ({ minutesAgo, windVsApp, waterState, dirSeen, appWindKt });

  it('nothing in the last two hours: nothing to say', () => {
    expect(summarizeRecentReports([])).toBeNull();
    expect(summarizeRecentReports([row(130, 1)])).toBeNull();
  });

  it('agreement is two thirds or more; less than that is said as such', () => {
    expect(summarizeRecentReports([row(10, 1), row(30, 1), row(50, -1)])!.wind).toBe(1);
    expect(summarizeRecentReports([row(10, 1), row(30, -1)])!.wind).toBe('mixed');
  });

  it('when is the newest, rounded down to 5 min, and the figure is what the newest saw', () => {
    const s = summarizeRecentReports([row(47, 0, null, null, 12), row(17, 1, null, null, 9)])!;
    expect(s.newestMin).toBe(15);
    expect(s.appWindKt).toBe(9);
    expect(recentReportWhen(s)).toBe('hace 15 min · 2 reportes');
    expect(recentReportWhen({ ...s, newestMin: 0, count: 1 })).toBe('hace un momento · 1 reporte');
    expect(recentReportWhen({ ...s, newestMin: 70 })).toBe('hace 1 h 10 min · 2 reportes');
  });

  it('direction only when more than half of those who gave it agree; water by most said', () => {
    const s = summarizeRecentReports([row(5, 1, 2, 0), row(20, 1, 2, 45), row(40, 1, 3, 0)])!;
    expect(s.dir).toBe(0);
    expect(s.water).toBe(2);
    expect(summarizeRecentReports([row(5, 1, null, 0), row(20, 1, null, 45)])!.dir).toBeNull();
  });

  it('reads as plain words', () => {
    const s = summarizeRecentReports([row(5, 1, 2, 0)])!;
    expect(recentReportWhat(s)).toBe('Más viento que los 9 kt de la app · algo de espuma · del N');
    expect(recentReportWhat({ ...s, wind: 'mixed', water: null, dir: null })).toBe('No coinciden entre ellos');
    expect(recentReportWhat({ ...s, wind: 0, appWindKt: null, water: 0, dir: null })).toBe('El viento de la app · agua como un espejo');
  });
});

describe('reportConflict', () => {
  it('less wind with foam under 8 kt shown is a contradiction (15-oct 17:46, a mis-tap)', () => {
    expect(reportConflict(-1, 2, 6.8)).toBe('less-with-foam');
    expect(reportConflict(-1, 3, 7.9)).toBe('less-with-foam');
  });
  it('more wind with a mirror over 3 kt shown is a contradiction', () => {
    expect(reportConflict(1, 0, 4)).toBe('more-with-mirror');
  });
  it('consistent answers, or missing ones, are not flagged', () => {
    expect(reportConflict(-1, 2, 12)).toBeNull();   // foam, but the app says even more
    expect(reportConflict(-1, 1, 6)).toBeNull();    // moved water without foam
    expect(reportConflict(1, 0, 2)).toBeNull();     // mirror with the app at 2: little to say
    expect(reportConflict(1, 3, 6)).toBeNull();
    expect(reportConflict(-1, null, 6)).toBeNull();
    expect(reportConflict(-1, 2, null)).toBeNull();
    expect(reportConflict(null, 2, 6)).toBeNull();
  });
});

describe('knots seen (observers with a personal link)', () => {
  it('takes an index into the fixed ranges and nothing else', () => {
    for (const k of [0, 5]) expect(parseFieldReport({ ...base, ktRange: k }, isValid)).toMatchObject({ ok: true, report: { ktRange: k } });
    for (const k of [6, -1, 1.5, '2']) expect(parseFieldReport({ ...base, ktRange: k }, isValid)).toEqual({ ok: false, error: 'ktRange' });
    const r = parseFieldReport(base, isValid);
    expect(r.ok && r.report.ktRange).toBeNull();
  });

  it('reads the ranges and a diary line as plain words', () => {
    expect(KT_RANGES[3]).toEqual([12, 16]);
    expect(ktRangeLabel(12, 16)).toBe('12-16 kt');
    expect(ktRangeLabel(20, 30)).toBe('más de 20 kt');
    expect(observerReportWhat({ time: 0, spotId: 'cesantes', windVsApp: 1, waterState: 2, dirSeen: 225, ktLo: 12, ktHi: 16, appWindKt: 9.6 }))
      .toBe('12-16 kt · algo de espuma · del SO · la app decía 10');
    expect(observerReportWhat({ time: 0, spotId: 'vao', windVsApp: -1, waterState: null, dirSeen: null, ktLo: null, ktHi: null, appWindKt: null }))
      .toBe('menos viento que la app');
  });
});

describe('reportConflict with an observer\'s knots', () => {
  it('a range wholly on the other side of the figure contradicts «more / less»', () => {
    expect(reportConflict(-1, null, 2.1, 3)).toBe('less-with-knots');    // «less» than 2 kt, marking 12-16
    expect(reportConflict(1, null, 14, 0)).toBe('more-with-knots');      // «more» than 14 kt, marking 0-5
    expect(reportConflict(1, null, 14, 3)).toBeNull();                   // 12-16 straddles 14: fine
    expect(reportConflict(-1, null, 2.1, null)).toBeNull();
  });
});
