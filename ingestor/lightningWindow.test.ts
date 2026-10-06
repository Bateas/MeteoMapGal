/**
 * The ingestor is now the only one asking meteo2api, every 2 min in a storm. What these tests
 * pin: the short window really reaches the last strikes (meteo2api reads the window in Madrid
 * time against UTC labels), the reach grows after a missed poll, and the storm mode switches.
 */
import { describe, it, expect } from 'vitest';
import { lightningWindow, madridOffsetMs, pollSpanMs, isStormActive, type PersistedStrike } from './lightningFetcher';

const MIN = 60_000;

describe('madridOffsetMs', () => {
  it('two hours in summer, one in winter', () => {
    expect(madridOffsetMs(Date.parse('2026-10-06T12:00:00Z'))).toBe(120 * MIN);
    expect(madridOffsetMs(Date.parse('2026-12-01T12:00:00Z'))).toBe(60 * MIN);
  });
});

describe('lightningWindow', () => {
  it('6-oct: to get the strikes labelled 11:10-11:40 UTC, ask 09:10Z back from now', () => {
    const now = Date.parse('2026-10-06T11:40:00Z');
    const { fechaInicio, fechaFin } = lightningWindow(now, 30 * MIN);
    expect(fechaInicio.toISOString()).toBe('2026-10-06T11:40:00.000Z');
    expect(fechaFin.toISOString()).toBe('2026-10-06T09:10:00.000Z');
  });
});

describe('pollSpanMs', () => {
  const now = Date.parse('2026-10-06T14:00:00Z');
  it('the whole day after a restart', () => {
    expect(pollSpanMs(now, null)).toBe(24 * 60 * MIN);
  });
  it('half an hour on a normal poll, more after missed ones, never over a day', () => {
    expect(pollSpanMs(now, now - 2 * MIN)).toBe(32 * MIN);
    expect(pollSpanMs(now, now - 40 * MIN)).toBe(70 * MIN);
    expect(pollSpanMs(now, now - 3 * 24 * 60 * MIN)).toBe(24 * 60 * MIN);
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
