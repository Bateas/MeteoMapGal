import { describe, it, expect } from 'vitest';
import { parseRecentReadings } from './recentReadingsClient';

describe('parseRecentReadings', () => {
  const t = Date.parse('2026-10-21T10:00:00Z');
  const payload = {
    stations: {
      mg_1: [[t, 3, 5.1, 270, 15, 80, 1015, 11.6, 120, 0.2]],
      wu_X: [[t, null, null, null, 14, null, null, null, null, null]],
      bad: [['x', 1, 1, 1, 1, 1, 1, 1, 1, 1], [t, 1]],
    },
  };

  it('maps each compact row to a reading', () => {
    const [r] = parseRecentReadings(payload, new Set(['mg_1']));
    expect(r).toEqual({
      stationId: 'mg_1', timestamp: new Date(t), windSpeed: 3, windGust: 5.1, windDirection: 270,
      temperature: 15, humidity: 80, pressure: 1015, dewPoint: 11.6, solarRadiation: 120, precipitation: 0.2,
    });
  });

  it('keeps only the stations asked and skips malformed rows', () => {
    const all = parseRecentReadings(payload);
    expect(all.map((r) => r.stationId)).toEqual(['mg_1', 'wu_X']);
    expect(parseRecentReadings(payload, new Set(['wu_X']))[0].windSpeed).toBeNull();
    expect(parseRecentReadings(null)).toEqual([]);
  });
});
