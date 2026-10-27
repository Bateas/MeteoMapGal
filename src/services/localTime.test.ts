import { describe, it, expect } from 'vitest';
import { madridHour, parseMadridWallTime, sunHour } from './localTime';

describe('sunHour — the heating-cycle windows stay on the same sun all year', () => {
  it('in summer it is the official hour', () => {
    expect(sunHour(Date.parse('2026-08-05T12:00:00Z'))).toBe(14);
    expect(sunHour(Date.parse('2026-08-05T12:00:00Z'))).toBe(madridHour(Date.parse('2026-08-05T12:00:00Z')));
  });
  it('in winter it is one hour ahead of the official clock (same sun as the summer hour)', () => {
    // 13:00 CET on 26-oct = 12:00 UTC: the same sun as 14:00 CEST in summer.
    expect(sunHour(Date.parse('2026-10-26T12:00:00Z'))).toBe(14);
    expect(madridHour(Date.parse('2026-10-26T12:00:00Z'))).toBe(13);
  });
  it('wraps at midnight and takes a Date too', () => {
    expect(sunHour(new Date('2026-12-15T22:30:00Z'))).toBe(0);
  });
});

describe('madridHour — the hour in Galicia, whatever the machine clock', () => {
  it('summer time (CEST, UTC+2)', () => {
    expect(madridHour(Date.parse('2026-09-29T14:00:00Z'))).toBe(16);
  });
  it('winter time (CET, UTC+1)', () => {
    expect(madridHour(new Date('2026-12-15T14:00:00Z'))).toBe(15);
  });
  it('midnight is 0', () => {
    expect(madridHour(Date.parse('2026-09-29T22:00:00Z'))).toBe(0);
  });
});

describe('parseMadridWallTime — local text with no offset to UTC', () => {
  const iso = (text: string) => new Date(parseMadridWallTime(text)).toISOString();
  it('summer time (CEST, UTC+2)', () => {
    expect(iso('2026-10-12 23:00')).toBe('2026-10-12T21:00:00.000Z');
  });
  it('winter time (CET, UTC+1), with seconds or a T', () => {
    expect(iso('2026-12-01 12:00:30')).toBe('2026-12-01T11:00:30.000Z');
    expect(iso('2026-12-01T12:00')).toBe('2026-12-01T11:00:00.000Z');
  });
  it('the days the clocks change land on the right side', () => {
    // 25-oct-2026: 03:00 CEST -> 02:00 CET. 01:30 is still summer time, 04:00 already winter.
    expect(iso('2026-10-25 01:30')).toBe('2026-10-24T23:30:00.000Z');
    expect(iso('2026-10-25 04:00')).toBe('2026-10-25T03:00:00.000Z');
    // 29-mar-2026: 02:00 CET -> 03:00 CEST. 01:00 winter, 04:00 summer.
    expect(iso('2026-03-29 01:00')).toBe('2026-03-29T00:00:00.000Z');
    expect(iso('2026-03-29 04:00')).toBe('2026-03-29T02:00:00.000Z');
  });
  it('anything else is NaN', () => {
    expect(parseMadridWallTime('ayer')).toBeNaN();
    expect(parseMadridWallTime('')).toBeNaN();
    expect(parseMadridWallTime('2026-10-12')).toBeNaN();
  });
});
