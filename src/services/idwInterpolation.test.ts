import { describe, it, expect } from 'vitest';
import type { NormalizedStation, NormalizedReading } from '../types/station';
import {
  extractHumidityData,
  extractWindData,
  interpolateScalar,
  fastDistanceKm,
} from './idwInterpolation';

function mockStation(id: string, lat = 42.2, lon = -8.7): NormalizedStation {
  return {
    id,
    name: `Station ${id}`,
    source: 'meteogalicia',
    lat,
    lon,
    altitude: 100,
  };
}

function mockReading(stationId: string, humidity: number | null, ageMin = 5): NormalizedReading {
  return {
    stationId,
    timestamp: new Date(Date.now() - ageMin * 60_000),
    temperature: 20,
    humidity,
    pressure: 1015,
    windSpeed: 3,
    windGust: 5,
    windDirection: 180,
    precipitation: 0,
  };
}

describe('extractHumidityData', () => {
  it('extracts humidity and coordinates from fresh readings', () => {
    const st1 = mockStation('st1', 42.2, -8.7);
    const r1 = mockReading('st1', 75, 10);

    const result = extractHumidityData([st1], new Map([['st1', r1]]));
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(75);
    expect(result[0].lat).toBe(42.2);
    expect(result[0].lon).toBe(-8.7);
    expect(result[0].freshness).toBeGreaterThan(0.9);
  });

  it('keeps hourly stations up to 90 min old instead of discarding at 30 min', () => {
    const st1 = mockStation('st1', 42.2, -8.7);
    const r1 = mockReading('st1', 65, 50); // 50 min old hourly reading

    const result = extractHumidityData([st1], new Map([['st1', r1]]));
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(65);
    expect(result[0].freshness).toBe(0.7);
  });

  it('discards truly stale readings older than 90 min', () => {
    const st1 = mockStation('st1', 42.2, -8.7);
    const r1 = mockReading('st1', 65, 100); // 100 min old

    const result = extractHumidityData([st1], new Map([['st1', r1]]));
    expect(result).toHaveLength(0);
  });

  it('handles string timestamps gracefully without crashing', () => {
    const st1 = mockStation('st1', 42.2, -8.7);
    const r1 = {
      ...mockReading('st1', 80, 15),
      timestamp: new Date(Date.now() - 15 * 60_000).toISOString() as unknown as Date,
    };

    const result = extractHumidityData([st1], new Map([['st1', r1]]));
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(80);
  });

  it('skips stations with null humidity', () => {
    const st1 = mockStation('st1', 42.2, -8.7);
    const r1 = mockReading('st1', null, 5);

    const result = extractHumidityData([st1], new Map([['st1', r1]]));
    expect(result).toHaveLength(0);
  });
});

describe('interpolateScalar', () => {
  it('interpolates humidity using IDW', () => {
    const stations = [
      { lat: 42.0, lon: -8.0, value: 50 },
      { lat: 42.2, lon: -8.0, value: 80 },
    ];

    // Midpoint between 42.0 (50%) and 42.2 (80%)
    const val = interpolateScalar(42.1, -8.0, stations);
    expect(val).toBeCloseTo(65, 1);
  });

  it('returns exact value if point coincides with station', () => {
    const stations = [
      { lat: 42.0, lon: -8.0, value: 72 },
    ];
    const val = interpolateScalar(42.0, -8.0, stations);
    expect(val).toBe(72);
  });
});
