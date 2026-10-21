import { describe, it, expect } from 'vitest';
import { groupRecentRows } from './recentReadings';

const base = { wind_speed: null, wind_gust: null, wind_dir: null, temperature: null, humidity: null, pressure: null, dew_point: null, solar_rad: null, precip: null };

describe('groupRecentRows', () => {
  it('groups by station, sorts by time and rounds to one decimal', () => {
    const out = groupRecentRows([
      { ...base, station_id: 'mg_1', time: '2026-10-21T10:10:00Z', wind_speed: '4.26', temperature: 15 },
      { ...base, station_id: 'mg_1', time: new Date('2026-10-21T10:00:00Z'), wind_speed: 3.04, wind_dir: '270' },
    ]);
    expect(out.mg_1).toEqual([
      [Date.parse('2026-10-21T10:00:00Z'), 3, null, 270, null, null, null, null, null, null],
      [Date.parse('2026-10-21T10:10:00Z'), 4.3, null, null, 15, null, null, null, null, null],
    ]);
  });
  it('drops rows with a bad time, no id or no value at all', () => {
    const out = groupRecentRows([
      { ...base, station_id: 'mg_1', time: 'nope', wind_speed: 2 },
      { ...base, station_id: '', time: '2026-10-21T10:00:00Z', wind_speed: 2 },
      { ...base, station_id: 'mg_2', time: '2026-10-21T10:00:00Z' },
      { ...base, station_id: 'mg_3', time: '2026-10-21T10:00:00Z', humidity: 'x' },
    ]);
    expect(out).toEqual({});
  });
});
