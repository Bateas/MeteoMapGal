import { describe, it, expect } from 'vitest';
import { aemetPollDue, isAemetQuotaAnswer, AEMET_MIN_GAP_MS } from './aemetCadence';

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
