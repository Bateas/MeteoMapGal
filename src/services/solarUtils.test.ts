/**
 * The forecast now decides day/night from here.
 *
 * It used to come from the provider's sky_state vocabulary, which turned out to
 * be unreachable — apiv5 never emits a NIGHT_* value, so every hour scored as
 * daylight and the app offered night hours as sailable. This file had no tests
 * at all, so these pin the behaviour the ingestor now leans on.
 */
import { describe, it, expect } from 'vitest';
import { isDaylight, getSunTimes } from './solarUtils';

// Rías Baixas, the coordinates the WRF fetcher uses for that sector.
const RIAS: [number, number] = [-8.619, 42.307];

function at(iso: string): Date {
  return new Date(iso);
}

describe('isDaylight', () => {
  it('says NIGHT at 04:00 in August — the hour the app was calling sailable', () => {
    expect(isDaylight(at('2026-08-13T04:00:00+02:00'), RIAS)).toBe(false);
  });

  it('says DAY at 14:00 in August', () => {
    expect(isDaylight(at('2026-08-13T14:00:00+02:00'), RIAS)).toBe(true);
  });

  it('says NIGHT at 23:00 in August', () => {
    expect(isDaylight(at('2026-08-13T23:00:00+02:00'), RIAS)).toBe(false);
  });

  it('tracks the season: 21:00 is daylight in June and dark in December', () => {
    // A fixed hour range would get this wrong twice a year; the sun does not.
    // Hours picked well clear of the boundary on purpose — Galicia sits at the
    // western edge of its time zone, so the sun sets remarkably late for the
    // clock (about 22:05 midsummer, and still past 18:00 at the solstice).
    expect(isDaylight(at('2026-06-21T21:00:00+02:00'), RIAS)).toBe(true);
    expect(isDaylight(at('2026-12-21T19:00:00+01:00'), RIAS)).toBe(false);
  });

  it('gives a longer day in June than in December, by hours not minutes', () => {
    const jun = getSunTimes(at('2026-06-21T12:00:00+02:00'), RIAS);
    const dec = getSunTimes(at('2026-12-21T12:00:00+01:00'), RIAS);
    const hours = (s: { sunrise: Date; sunset: Date }) =>
      (s.sunset.getTime() - s.sunrise.getTime()) / 3_600_000;
    expect(hours(jun)).toBeGreaterThan(hours(dec) + 4);
  });

  it('puts sunrise before sunset, whatever the date', () => {
    for (const iso of ['2026-01-15', '2026-04-15', '2026-08-15', '2026-11-15']) {
      const { sunrise, sunset } = getSunTimes(at(iso + 'T12:00:00Z'), RIAS);
      expect(sunrise.getTime()).toBeLessThan(sunset.getTime());
    }
  });
});
