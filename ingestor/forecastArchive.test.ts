import { describe, it, expect } from 'vitest';
import { buildArchiveRows, MAX_LEAD_H } from './forecastArchive';
import type { HourlyForecast } from '../src/types/forecast';

const H = 3_600_000;
const hour = (iso: string, extra: Partial<HourlyForecast> = {}) =>
  ({ time: new Date(iso), windSpeed: 5, windDirection: 230, cape: 800, skyState: 'SUNNY', ...extra }) as HourlyForecast;

describe('buildArchiveRows', () => {
  it('stamps every row with the issue HOUR, so a second refresh in the same hour collides instead of duplicating', () => {
    const rows = buildArchiveRows('rias', 'wrf+om', new Date('2026-09-24T10:47:12Z'), [hour('2026-09-24T12:00:00Z')]);
    expect(rows).toHaveLength(1);
    expect(rows[0].issuedAt.toISOString()).toBe('2026-09-24T10:00:00.000Z');
    expect(rows[0].validTime.toISOString()).toBe('2026-09-24T12:00:00.000Z');
  });

  it('drops hours before the issue hour: those are already the past, not a forecast', () => {
    const rows = buildArchiveRows('rias', 'om', new Date('2026-09-24T10:30:00Z'), [
      hour('2026-09-24T08:00:00Z'), hour('2026-09-24T10:00:00Z'), hour('2026-09-24T11:00:00Z'),
    ]);
    expect(rows.map((r) => r.validTime.toISOString())).toEqual(['2026-09-24T10:00:00.000Z', '2026-09-24T11:00:00.000Z']);
  });

  it(`drops leads beyond ${MAX_LEAD_H} h`, () => {
    const issued = new Date('2026-09-24T00:00:00Z');
    const rows = buildArchiveRows('embalse', 'om', issued, [
      hour(new Date(issued.getTime() + MAX_LEAD_H * H).toISOString()),
      hour(new Date(issued.getTime() + (MAX_LEAD_H + 1) * H).toISOString()),
    ]);
    expect(rows).toHaveLength(1);
  });

  it('keeps the value order the INSERT expects and turns non-numbers into null', () => {
    const [r] = buildArchiveRows('rias', 'wrf', new Date('2026-09-24T10:00:00Z'),
      [hour('2026-09-24T11:00:00Z', { windSpeed: NaN, cape: null, skyState: null })]);
    expect(r.values).toHaveLength(16);
    expect(r.values[0]).toBeNull();     // wind_ms
    expect(r.values[1]).toBe(230);      // wind_dir
    expect(r.values[10]).toBeNull();    // cape
    expect(r.values[15]).toBeNull();    // sky_state
  });

  it('skips hours with an invalid time instead of throwing', () => {
    const rows = buildArchiveRows('rias', 'om', new Date('2026-09-24T10:00:00Z'), [{ time: new Date('nope') } as HourlyForecast]);
    expect(rows).toEqual([]);
  });
});
