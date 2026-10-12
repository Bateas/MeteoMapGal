/**
 * What the lightning poll asks for. The official service answers whole UTC days, so the risk is
 * the day edge: strikes of 23:55 published at 00:01 belong to yesterday. What these tests pin:
 * yesterday is asked after a restart, after a poll that missed the day change and in the first
 * half hour of the UTC day, and only then; the date format is the one the service takes.
 */
import { describe, it, expect } from 'vitest';
import { jsonRaiosUrl, utcDayParam, isStormActive, type PersistedStrike } from './lightningFetcher';

const MIN = 60_000;
const BASE = 'https://servizos.meteogalicia.gal/mgrss/observacion/jsonRaios.action';

describe('utcDayParam', () => {
  it('dd/mm/yyyy of the UTC day, zero-padded', () => {
    expect(utcDayParam(Date.parse('2026-10-06T12:00:00Z'))).toBe('06/10/2026');
    expect(utcDayParam(Date.parse('2026-01-05T00:00:00Z'))).toBe('05/01/2026');
  });

  it('the UTC day, not the Madrid one (23:30 UTC is already tomorrow in Madrid)', () => {
    expect(utcDayParam(Date.parse('2026-10-06T23:30:00Z'))).toBe('06/10/2026');
  });
});

describe('jsonRaiosUrl', () => {
  const now = Date.parse('2026-10-12T14:00:30Z');

  it('just today in the middle of the day after a good poll', () => {
    expect(jsonRaiosUrl(now, now - 5 * MIN)).toBe(BASE);
  });

  it('yesterday and today after a restart', () => {
    expect(jsonRaiosUrl(now, null)).toBe(`${BASE}?dataIni=11/10/2026&dataFin=12/10/2026`);
  });

  it('yesterday and today in the first half hour of the UTC day', () => {
    const t = Date.parse('2026-10-12T00:10:30Z');
    expect(jsonRaiosUrl(t, t - 5 * MIN)).toBe(`${BASE}?dataIni=11/10/2026&dataFin=12/10/2026`);
  });

  it('yesterday and today when the last good poll is from before the day change', () => {
    expect(jsonRaiosUrl(now, Date.parse('2026-10-11T23:50:00Z'))).toBe(`${BASE}?dataIni=11/10/2026&dataFin=12/10/2026`);
  });

  it('back to today alone once a poll after 00:30 has succeeded', () => {
    const t = Date.parse('2026-10-12T00:35:30Z');
    expect(jsonRaiosUrl(t, Date.parse('2026-10-12T00:30:30Z'))).toBe(BASE);
  });

  it('the range crosses months and years', () => {
    expect(jsonRaiosUrl(Date.parse('2027-01-01T00:05:00Z'), null)).toBe(`${BASE}?dataIni=31/12/2026&dataFin=01/01/2027`);
  });
});

describe('isStormActive', () => {
  const now = Date.parse('2026-10-06T14:00:00Z');
  const s = (minAgo: number, isGalicia = true): PersistedStrike => ({
    time: new Date(now - minAgo * MIN), lat: 42.3, lon: -8.7, peakCurrent: -10,
    cloudToCloud: false, multiplicity: 1, isGalicia,
  });
  it('one strike in the last 5 min, or five in the last 15', () => {
    expect(isStormActive([s(3)], now)).toBe(true);
    expect(isStormActive([s(8), s(9), s(10), s(12), s(14)], now)).toBe(true);
    expect(isStormActive([s(8), s(9), s(10), s(12)], now)).toBe(false);
  });
  it('strikes outside the Galicia scope or older than 15 min do not count', () => {
    expect(isStormActive([s(2, false), s(3, false)], now)).toBe(false);
    expect(isStormActive([s(20), s(25), s(30), s(40), s(50), s(55)], now)).toBe(false);
  });
});
