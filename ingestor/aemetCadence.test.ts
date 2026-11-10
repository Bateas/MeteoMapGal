import { describe, it, expect } from 'vitest';
import {
  aemetPollDue, isAemetQuotaAnswer, isAemetKeyRefusal, aemetKeyNotice, AEMET_MIN_GAP_MS,
  lateAemetReadings, AEMET_LATE_RESEND_MS,
} from './aemetCadence';

describe('aemetPollDue', () => {
  it('polls when nothing good has arrived yet', () => {
    expect(aemetPollDue(null, 1_000)).toBe(true);
  });
  it('waits 15 min after a good answer', () => {
    const t = 1_000_000;
    expect(aemetPollDue(t, t + AEMET_MIN_GAP_MS - 1)).toBe(false);
    expect(aemetPollDue(t, t + AEMET_MIN_GAP_MS)).toBe(true);
  });
});

describe('isAemetQuotaAnswer', () => {
  it('reads both the HTTP status and the estado inside a 200', () => {
    expect(isAemetQuotaAnswer(429, undefined)).toBe(true);
    expect(isAemetQuotaAnswer(200, 429)).toBe(true);
    expect(isAemetQuotaAnswer(200, '429')).toBe(true);
    expect(isAemetQuotaAnswer(200, 200)).toBe(false);
    expect(isAemetQuotaAnswer(200, 404)).toBe(false);
  });
});

describe('isAemetKeyRefusal', () => {
  it('reads 401/403 as HTTP status or as estado, and nothing else', () => {
    expect(isAemetKeyRefusal(200, 401)).toBe(true);
    expect(isAemetKeyRefusal(200, '401')).toBe(true);
    expect(isAemetKeyRefusal(401, undefined)).toBe(true);
    expect(isAemetKeyRefusal(403, undefined)).toBe(true);
    expect(isAemetKeyRefusal(200, 200)).toBe(false);
    expect(isAemetKeyRefusal(200, 429)).toBe(false);
  });
});

describe('aemetKeyNotice', () => {
  const now = Date.UTC(2026, 9, 26, 12);
  const DAY = 86_400_000;
  it('warns about a key without expiry (AEMET withdraws them since 15-oct-2026)', () => {
    expect(aemetKeyNotice(null, now).level).toBe('warn');
  });
  it('says error once expired, warn within 14 days, info otherwise', () => {
    expect(aemetKeyNotice(now - DAY, now).level).toBe('error');
    expect(aemetKeyNotice(now + 5 * DAY, now)).toEqual({ level: 'warn', text: expect.stringContaining('en 5 dias') });
    expect(aemetKeyNotice(now + 60 * DAY, now).level).toBe('info');
  });
});

describe('lateAemetReadings', () => {
  const HOUR = 60 * 60_000;
  const now = Date.UTC(2026, 10, 10, 11, 15);
  const at = (hoursAgo: number, stationId = 'aemet_1696O') => ({ stationId, timestamp: new Date(now - hoursAgo * HOUR) });

  it('takes the hours of a 4-hour batch that the cycle drops, and leaves the live ones to the cycle', () => {
    // Beariz, 10-nov: the batch with 07, 08, 09 and 10 UTC lands after 11 UTC.
    const batch = [at(4.25), at(3.25), at(2.25), at(1.25)];
    const late = lateAemetReadings(batch, now, new Map());
    expect(late.map((r) => r.timestamp.getTime())).toEqual([now - 4.25 * HOUR, now - 3.25 * HOUR, now - 2.25 * HOUR]);
  });

  it('does not offer the same reading again until the resend time has passed', () => {
    const sent = new Map<string, number>();
    expect(lateAemetReadings([at(3)], now, sent)).toHaveLength(1);
    expect(lateAemetReadings([at(3)], now + 15 * 60_000, sent)).toHaveLength(0);
    const later = now + AEMET_LATE_RESEND_MS;
    expect(lateAemetReadings([{ stationId: 'aemet_1696O', timestamp: new Date(now - 3 * HOUR) }], later, sent)).toHaveLength(1);
  });

  it('tells two stations at the same hour apart', () => {
    expect(lateAemetReadings([at(3, 'aemet_1696O'), at(3, 'aemet_1690A')], now, new Map())).toHaveLength(2);
  });

  it('drops what is older than a day and what has no valid time', () => {
    const bad = { stationId: 'aemet_1696O', timestamp: new Date('nonsense') };
    expect(lateAemetReadings([at(25), bad], now, new Map())).toHaveLength(0);
  });
});
