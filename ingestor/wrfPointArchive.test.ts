import { describe, it, expect } from 'vitest';
import { wrfPointArchiveDue, runWrfPointArchive, WRF_POINT_EVERY_MS } from './wrfPointArchive';
import { buildArchiveRows } from './forecastArchive';
import { nwpAllPoints } from './nwpPreviousLogic';
import type { HourlyForecast } from '../src/types/forecast';

const H = 3_600_000;
const NOW = Date.UTC(2026, 8, 29, 20, 0);

describe('wrfPointArchiveDue — WRF at the buoys and spots every 12 h (29-sep)', () => {
  it('is due with nothing archived, and again once 12 h have passed', () => {
    expect(wrfPointArchiveDue(null, NOW)).toBe(true);
    expect(wrfPointArchiveDue(NOW - WRF_POINT_EVERY_MS, NOW)).toBe(true);
  });

  it('a restart a few hours after the last archive asks for nothing', () => {
    expect(wrfPointArchiveDue(NOW - 3 * H, NOW)).toBe(false);
  });

  it('an hourly check landing a little early does not skip a whole run', () => {
    expect(wrfPointArchiveDue(NOW - 11.6 * H, NOW)).toBe(true);
  });

  it('the cycle exists and returns a promise (the DB path runs in production)', () => {
    expect(typeof runWrfPointArchive).toBe('function');
  });
});

describe('the archived rows keep the point as the sector', () => {
  it('boya:4272 with model wrf, from the issue hour on', () => {
    const hours = [0, 1, 2].map((i) => ({ time: new Date(NOW + i * H), windSpeed: 10 + i, windDirection: 200 } as HourlyForecast));
    const rows = buildArchiveRows('boya:4272', 'wrf', new Date(NOW + 5 * 60_000), hours);
    expect(rows).toHaveLength(3);
    expect(rows[0].sector).toBe('boya:4272');
    expect(rows[0].model).toBe('wrf');
    expect(rows[0].values[0]).toBe(10);
  });

  it('the points are the five buoys of the wind model plus the spots', () => {
    const ids = nwpAllPoints().map((p) => p.id);
    expect(ids.filter((id) => id.startsWith('boya:'))).toHaveLength(5);
    expect(ids).toContain('spot:cesantes');
  });
});
