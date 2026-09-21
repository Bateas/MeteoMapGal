import { describe, it, expect } from 'vitest';
import type { NormalizedStation, NormalizedReading } from '../../types/station';
import {
  speedToLevel,
  buildWindFieldGeoJSON,
  SPEED_LEVELS,
} from './WindFieldOverlay';

function mockStation(id: string, lon = -8.7, lat = 42.2, over: Partial<NormalizedStation> = {}): NormalizedStation {
  return {
    id,
    name: `Station ${id}`,
    source: 'meteogalicia',
    lat,
    lon,
    altitude: 100,
    ...over,
  };
}

function mockReading(stationId: string, speed: number | null, dir: number | null, ageMin = 5): NormalizedReading {
  return {
    stationId,
    timestamp: new Date(Date.now() - ageMin * 60_000),
    temperature: 18.5,
    humidity: 75,
    pressure: 1015,
    windSpeed: speed,
    windGust: speed ? speed * 1.3 : null,
    windDirection: dir,
    precipitation: 0,
  };
}

describe('speedToLevel', () => {
  it('maps wind speeds to correct discrete speed levels', () => {
    expect(speedToLevel(0)).toBe(0);     // calm
    expect(speedToLevel(0.4)).toBe(0);   // calm (<0.5)
    expect(speedToLevel(1.5)).toBe(1);   // flojo (0.5-3.0)
    expect(speedToLevel(3.5)).toBe(2);   // gentle (3.0-4.5)
    expect(speedToLevel(5.0)).toBe(3);   // moderate (4.5-6.5)
    expect(speedToLevel(7.5)).toBe(4);   // fresh (6.5-9.0)
    expect(speedToLevel(10.5)).toBe(5);  // strong (9.0-12.0)
    expect(speedToLevel(13.5)).toBe(6);  // gale (12.0-15.0)
    expect(speedToLevel(25.0)).toBe(7);  // extreme (15.0+)
  });

  it('has 8 speed levels matching color palette', () => {
    expect(SPEED_LEVELS.length).toBe(8);
    expect(SPEED_LEVELS[0].id).toBe('wind-arrow-0');
    expect(SPEED_LEVELS[0].color).toBe('#64748b'); // slate calm
  });
});

describe('buildWindFieldGeoJSON', () => {
  it('emits 6 arrow features for a calm station (speed 0, dir null)', () => {
    const station = mockStation('st1');
    const reading = mockReading('st1', 0, null);
    const stations = [station];
    const readings = new Map([['st1', reading]]);

    const fc = buildWindFieldGeoJSON(stations, readings, undefined, false, 11);
    expect(fc.features.length).toBe(6);

    // All 6 should be level 0 (calm) and have finite coordinates and radial rotations
    for (const f of fc.features) {
      expect(f.properties?.speedLevel).toBe(0);
      expect(f.properties?.speed).toBe(0);
      const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
      expect(Number.isFinite(lon)).toBe(true);
      expect(Number.isFinite(lat)).toBe(true);
      expect(Number.isFinite(f.properties?.rotation)).toBe(true);
    }
  });

  it('emits 6 arrow features for a normal wind reading rotated meteorological + 180', () => {
    const station = mockStation('st2', -8.5, 42.4);
    const reading = mockReading('st2', 6.0, 90); // 90° East wind
    const stations = [station];
    const readings = new Map([['st2', reading]]);

    const fc = buildWindFieldGeoJSON(stations, readings, undefined, false, 11);
    expect(fc.features.length).toBe(6);

    for (const f of fc.features) {
      expect(f.properties?.speed).toBe(6.0);
      expect(f.properties?.speedLevel).toBe(3); // 6.0 m/s -> level 3 (lime-500)
      // Rotation: (90 + 180) % 360 = 270 (pointing West, towards where wind blows)
      expect(f.properties?.rotation).toBe(270);
    }
  });

  it('scales geographic offset inversely with zoom to maintain constant pixel distance', () => {
    const station = mockStation('st3', -8.0, 42.0);
    const reading = mockReading('st3', 5.0, 0);
    const stations = [station];
    const readings = new Map([['st3', reading]]);

    const fcZoom11 = buildWindFieldGeoJSON(stations, readings, undefined, false, 11);
    const fcZoom14 = buildWindFieldGeoJSON(stations, readings, undefined, false, 14);
    const fcZoom9 = buildWindFieldGeoJSON(stations, readings, undefined, false, 9);

    // Arrow 0 (offset [0, 1] North)
    const lat11 = (fcZoom11.features[0].geometry as GeoJSON.Point).coordinates[1];
    const lat14 = (fcZoom14.features[0].geometry as GeoJSON.Point).coordinates[1];
    const lat9 = (fcZoom9.features[0].geometry as GeoJSON.Point).coordinates[1];

    const dLat11 = lat11 - 42.0;
    const dLat14 = lat14 - 42.0;
    const dLat9 = lat9 - 42.0;

    // Zoom 14 has scale 2^(11-14) = 1/8 of zoom 11
    expect(dLat14).toBeCloseTo(dLat11 * 0.125, 6);
    // Zoom 9 has scale 2^(11-9) = 4x of zoom 11
    expect(dLat9).toBeCloseTo(dLat11 * 4.0, 6);
  });

  it('preserves hourly stations (50 min old) instead of dropping them at 30 min', () => {
    const station = mockStation('st_hourly');
    const reading = mockReading('st_hourly', 4.0, 180, 50); // 50 min old
    const stations = [station];
    const readings = new Map([['st_hourly', reading]]);

    const fc = buildWindFieldGeoJSON(stations, readings, undefined, false, 11);
    expect(fc.features.length).toBe(6);
    // Freshness alpha is decayed (0.65)
    expect(fc.features[0].properties?.opacity).toBeCloseTo(0.75 * 0.65, 2);
  });

  it('discards genuinely stale stations (>90 min old)', () => {
    const station = mockStation('st_stale');
    const reading = mockReading('st_stale', 4.0, 180, 100); // 100 min old
    const stations = [station];
    const readings = new Map([['st_stale', reading]]);

    const fc = buildWindFieldGeoJSON(stations, readings, undefined, false, 11);
    expect(fc.features.length).toBe(0);
  });

  it('skips tempOnly and blacklisted stations', () => {
    const stationTempOnly = mockStation('st_temp', -8.7, 42.2, { tempOnly: true });
    const readingTemp = mockReading('st_temp', 5.0, 180);

    const stationBlacklisted = mockStation('wu_IVIGO48', -8.7, 42.2); // Known blacklisted
    const readingBlacklisted = mockReading('wu_IVIGO48', 5.0, 180);

    const stations = [stationTempOnly, stationBlacklisted];
    const readings = new Map([
      ['st_temp', readingTemp],
      ['wu_IVIGO48', readingBlacklisted],
    ]);

    const fc = buildWindFieldGeoJSON(stations, readings, undefined, false, 11);
    expect(fc.features.length).toBe(0);
  });

  it('suppresses wind arrows for stations grouped into clusters below zoom 9.5', () => {
    // Two stations very close to each other (<1km)
    const stA = mockStation('st_close_a', -8.70, 42.20);
    const stB = mockStation('st_close_b', -8.705, 42.205);
    const stations = [stA, stB];
    const readings = new Map([
      ['st_close_a', mockReading('st_close_a', 5.0, 180)],
      ['st_close_b', mockReading('st_close_b', 6.0, 190)],
    ]);

    // At zoom 11 (above 9.5 threshold): NO clustering, both stations emit 6 arrows each = 12
    const fcZoom11 = buildWindFieldGeoJSON(stations, readings, undefined, false, 11);
    expect(fcZoom11.features.length).toBe(12);

    // At zoom 9.0 (below 9.5 threshold): clustered together, so 0 standalone arrows emitted
    const fcZoom9 = buildWindFieldGeoJSON(stations, readings, undefined, false, 9.0);
    expect(fcZoom9.features.length).toBe(0);
  });

  it('emits wind arrows for isolated standalone stations even at zoom 9', () => {
    // Single isolated station (no neighbors within cluster radius)
    const st = mockStation('st_isolated', -8.70, 42.20);
    const stations = [st];
    const readings = new Map([['st_isolated', mockReading('st_isolated', 3.5, 90)]]);

    const fcZoom9 = buildWindFieldGeoJSON(stations, readings, undefined, false, 9.0);
    expect(fcZoom9.features.length).toBe(6);
  });
});
