import { describe, it, expect } from 'vitest';
import { madridHour } from './localTime';

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
