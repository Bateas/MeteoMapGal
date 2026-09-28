import { describe, it, expect } from 'vitest';
import { portusFechaToIso } from './portusTime';

describe('portusFechaToIso', () => {
  it('reads the zone-less fecha as UTC (live answer at 16:28:05 UTC, 27-sep)', () => {
    expect(portusFechaToIso('2026-09-27 16:28:00.0')).toBe('2026-09-27T16:28:00.000Z');
  });
  it('is UTC in winter too, not Madrid time', () => {
    expect(portusFechaToIso('2026-01-15 09:00:00.0')).toBe('2026-01-15T09:00:00.000Z');
  });
  it('does not depend on the machine time zone (Madrid would give 14:28Z)', () => {
    const iso = portusFechaToIso('2026-09-27 16:28:00.0')!;
    expect(new Date(iso).getUTCHours()).toBe(16);
  });
  it('accepts a T separator, no seconds, and a longer fraction', () => {
    expect(portusFechaToIso('2026-09-27T16:28:00')).toBe('2026-09-27T16:28:00.000Z');
    expect(portusFechaToIso('2026-09-27 16:28')).toBe('2026-09-27T16:28:00.000Z');
    expect(portusFechaToIso('2026-09-27 16:28:00.1234')).toBe('2026-09-27T16:28:00.123Z');
  });
  it('trusts an explicit zone if PORTUS ever sends one', () => {
    expect(portusFechaToIso('2026-09-27 18:28:00+02:00')).toBe('2026-09-27T16:28:00.000Z');
    expect(portusFechaToIso('2026-09-27T16:28:00Z')).toBe('2026-09-27T16:28:00.000Z');
  });
  it('returns null for anything it cannot read', () => {
    expect(portusFechaToIso(undefined)).toBeNull();
    expect(portusFechaToIso('')).toBeNull();
    expect(portusFechaToIso('27/09/2026 16:28')).toBeNull();
  });
});
