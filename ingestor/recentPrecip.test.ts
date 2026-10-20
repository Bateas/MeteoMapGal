import { describe, it, expect } from 'vitest';
import { groupPrecipRows, RECENT_PRECIP_MIN } from './recentPrecip';

describe('groupPrecipRows', () => {
  it('groups by station in time order, as [epoch ms, mm]', () => {
    const out = groupPrecipRows([
      { station_id: 'wu_IBOIRO5', time: '2026-10-20T20:50:00Z', precip: '1.2' },
      { station_id: 'mg_10095', time: new Date('2026-10-20T20:40:00Z'), precip: 0.2 },
      { station_id: 'wu_IBOIRO5', time: '2026-10-20T20:40:00Z', precip: 0.9 },
    ]);
    expect(out['wu_IBOIRO5']).toEqual([
      [Date.parse('2026-10-20T20:40:00Z'), 0.9],
      [Date.parse('2026-10-20T20:50:00Z'), 1.2],
    ]);
    expect(out['mg_10095']).toEqual([[Date.parse('2026-10-20T20:40:00Z'), 0.2]]);
  });

  it('drops what is not a reading: null, negative, absurd, broken time or id', () => {
    const out = groupPrecipRows([
      { station_id: 'mg_1', time: '2026-10-20T20:40:00Z', precip: null },
      { station_id: 'mg_1', time: '2026-10-20T20:40:00Z', precip: -1 },
      { station_id: 'mg_1', time: '2026-10-20T20:40:00Z', precip: 9999 },
      { station_id: 'mg_1', time: 'ayer', precip: 1 },
      { station_id: '', time: '2026-10-20T20:40:00Z', precip: 1 },
    ]);
    expect(out).toEqual({});
  });

  it('covers the 30-min rain window plus a reading before it', () => {
    expect(RECENT_PRECIP_MIN).toBeGreaterThanOrEqual(60 + 5);
  });
});
