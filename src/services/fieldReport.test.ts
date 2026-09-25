import { describe, it, expect } from 'vitest';
import { parseFieldReport } from './fieldReport';

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
    const good = parseFieldReport({ ...base, observerCode: 'simon2026' }, isValid);
    const bad = parseFieldReport({ ...base, observerCode: "x'; DROP TABLE" }, isValid);
    expect(good.ok && good.report.observerCode).toBe('simon2026');
    expect(bad.ok && bad.report.observerCode).toBeNull();
  });
});
