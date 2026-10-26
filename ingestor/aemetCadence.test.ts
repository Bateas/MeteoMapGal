import { describe, it, expect } from 'vitest';
import { aemetPollDue, isAemetQuotaAnswer, isAemetKeyRefusal, aemetKeyNotice, AEMET_MIN_GAP_MS } from './aemetCadence';

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
