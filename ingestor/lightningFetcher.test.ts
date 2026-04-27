/**
 * Tests for ingestor/lightningFetcher — pure parser & mapping.
 *
 * The fetch + DB write paths are covered by integration in production
 * (deduplication is enforced by the PK constraint, not the test). Here
 * we lock the parser behavior so the wire format from meteo2api can't
 * regress silently.
 */

import { describe, it, expect } from 'vitest';
import { parseRaioDate, mapStrikesForPersist } from './lightningFetcher';

// ── parseRaioDate ────────────────────────────────────

describe('parseRaioDate', () => {
  it('parses "DD-MM-YYYY HH:MM" UTC format', () => {
    const ts = parseRaioDate('27-04-2026 14:35');
    expect(new Date(ts).toISOString()).toBe('2026-04-27T14:35:00.000Z');
  });

  it('returns NaN for malformed input', () => {
    expect(Number.isNaN(parseRaioDate('not a date'))).toBe(true);
    expect(Number.isNaN(parseRaioDate(''))).toBe(true);
  });

  it('returns NaN for missing time portion', () => {
    expect(Number.isNaN(parseRaioDate('27-04-2026'))).toBe(true);
  });

  it('handles single-digit day/month with leading zeros', () => {
    const ts = parseRaioDate('05-01-2026 09:03');
    expect(new Date(ts).toISOString()).toBe('2026-01-05T09:03:00.000Z');
  });
});

// ── mapStrikesForPersist ─────────────────────────────

const mkRaio = (overrides: Partial<{ date: string; latitude: number; longitude: number; peakCurrent: number }> = {}) => ({
  date: '27-04-2026 14:35',
  latitude: 42.5,
  longitude: -8.2,
  peakCurrent: 25,
  idCityHall: 36057,
  delaySymbol: 1,
  ...overrides,
});

describe('mapStrikesForPersist', () => {
  it('returns empty array for empty input', () => {
    expect(mapStrikesForPersist([], [])).toEqual([]);
  });

  it('maps positive-polarity strikes with positive peakCurrent', () => {
    const strikes = mapStrikesForPersist([mkRaio({ peakCurrent: 18 })], []);
    expect(strikes).toHaveLength(1);
    expect(strikes[0].peakCurrent).toBe(18);
  });

  it('maps negative-polarity strikes with NEGATIVE peakCurrent (polarity preserved)', () => {
    const strikes = mapStrikesForPersist([], [mkRaio({ peakCurrent: 18 })]);
    expect(strikes).toHaveLength(1);
    expect(strikes[0].peakCurrent).toBe(-18);
  });

  it('takes |peakCurrent| from input regardless of input sign', () => {
    // API returns absolute current; our convention encodes polarity in the sign
    const pos = mapStrikesForPersist([mkRaio({ peakCurrent: -25 })], []);
    expect(pos[0].peakCurrent).toBe(25); // positive bucket → positive sign

    const neg = mapStrikesForPersist([], [mkRaio({ peakCurrent: -25 })]);
    expect(neg[0].peakCurrent).toBe(-25); // negative bucket → negative sign
  });

  it('flags cloud_to_cloud=false (meteo2api lenda is CG only)', () => {
    const strikes = mapStrikesForPersist([mkRaio()], []);
    expect(strikes[0].cloudToCloud).toBe(false);
  });

  it('multiplicity defaults to 1 (not provided by meteo2api)', () => {
    const strikes = mapStrikesForPersist([mkRaio()], []);
    expect(strikes[0].multiplicity).toBe(1);
  });

  it('preserves lat/lon at full precision', () => {
    const strikes = mapStrikesForPersist([mkRaio({ latitude: 42.54042, longitude: -8.30263 })], []);
    expect(strikes[0].lat).toBe(42.54042);
    expect(strikes[0].lon).toBe(-8.30263);
  });

  it('skips records with non-finite lat/lon', () => {
    const strikes = mapStrikesForPersist([
      mkRaio({ latitude: NaN }),
      mkRaio({ longitude: Infinity }),
      mkRaio(),
    ], []);
    expect(strikes).toHaveLength(1); // only the valid one
  });

  it('skips records with unparseable date', () => {
    const strikes = mapStrikesForPersist([mkRaio({ date: 'garbage' })], []);
    expect(strikes).toEqual([]);
  });

  it('combines positives + negatives in one list', () => {
    const strikes = mapStrikesForPersist(
      [mkRaio({ peakCurrent: 10, latitude: 42.1 })],
      [mkRaio({ peakCurrent: 20, latitude: 42.2 })],
    );
    expect(strikes).toHaveLength(2);
    // Positive first (input order), then negative
    expect(strikes[0].peakCurrent).toBe(10);
    expect(strikes[1].peakCurrent).toBe(-20);
  });

  it('returns time as Date object for direct DB write', () => {
    const strikes = mapStrikesForPersist([mkRaio({ date: '27-04-2026 14:35' })], []);
    expect(strikes[0].time).toBeInstanceOf(Date);
    expect(strikes[0].time.toISOString()).toBe('2026-04-27T14:35:00.000Z');
  });
});
