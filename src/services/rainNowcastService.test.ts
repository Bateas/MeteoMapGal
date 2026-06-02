/**
 * Tests for rainNowcastService — "¿llueve ahora? / ¿lluvia próxima?" per spot.
 * Observed rain (nearby station precip, real obs) takes priority over forecast.
 * Clock injected via `now`; fixtures built relative to it.
 */
import { describe, it, expect } from 'vitest';
import { assessRainNowcast } from './rainNowcastService';
import type { NormalizedStation, NormalizedReading } from '../types/station';
import type { HourlyForecast } from '../types/forecast';

const NOW = new Date('2026-05-29T15:00:00');
const SPOT: [number, number] = [-8.62, 42.30]; // [lon, lat] (Cesantes-ish)

function station(id: string, lat: number, lon: number): NormalizedStation {
  return { id, name: id, lat, lon, altitude: 10, source: 'meteogalicia', tempOnly: false };
}

function reading(id: string, precipitation: number | null, ageMin = 0): NormalizedReading {
  return {
    stationId: id, timestamp: new Date(NOW.getTime() - ageMin * 60_000),
    windSpeed: null, windGust: null, windDirection: null,
    temperature: null, humidity: null, precipitation,
    solarRadiation: null, pressure: null, dewPoint: null,
  };
}

function fcHour(hOffset: number, precip: number, prob: number): HourlyForecast {
  const t = new Date(NOW.getTime() + hOffset * 3600_000);
  return {
    time: t, temperature: 15, humidity: 70, windSpeed: 3, windDirection: 200, windGusts: 5,
    precipitation: precip, precipProbability: prob, cloudCover: 60, pressure: 1012,
    solarRadiation: null, cape: null, boundaryLayerHeight: null, visibility: null,
    liftedIndex: null, cin: null, snowLevel: null, skyState: null, isDay: true,
  };
}

const opts = (over: Partial<Parameters<typeof assessRainNowcast>[0]> = {}) => ({
  spotCenter: SPOT, radiusKm: 12, stations: [], readings: new Map(), forecast: [], now: NOW,
  ...over,
});

describe('assessRainNowcast — observed (station)', () => {
  it('raining now when a station is wet AND the model corroborates rain this hour', () => {
    const stations = [station('a', 42.31, -8.61)]; // ~1.5km
    const readings = new Map([['a', reading('a', 1.2)]]);
    const forecast = [fcHour(0, 0.6, 70)]; // model confirms rain this hour → corroborated
    const r = assessRainNowcast(opts({ stations, readings, forecast }));
    expect(r.status).toBe('raining');
    expect(r.rainingNow).toBe(true);
    expect(r.intensityMm).toBeCloseTo(1.2, 1);
    expect(r.summary).toMatch(/Lloviendo/);
  });

  it('a LONE wet station with NO corroboration does NOT report raining (accumulated-precip, Vao/Cangas case)', () => {
    const stations = [station('a', 42.31, -8.61)];
    // 0.4mm accumulated from earlier, no solar, no 2nd wet station, no forecast → not enough.
    const readings = new Map([['a', reading('a', 0.4)]]);
    const r = assessRainNowcast(opts({ stations, readings }));
    expect(r.rainingNow).toBe(false);
    expect(r.status).not.toBe('raining');
  });

  it('does NOT report raining when the sun is clearly out (accumulated-precip artifact)', () => {
    const stations = [station('a', 42.31, -8.61)];
    // 0.5mm (likely accumulated from earlier) but solar 600 W/m² → sunny now.
    const readings = new Map([['a', { ...reading('a', 0.5), solarRadiation: 600 }]]);
    const r = assessRainNowcast(opts({ stations, readings }));
    expect(r.rainingNow).toBe(false);
    expect(r.status).not.toBe('raining');
  });

  it('still reports raining under dim/overcast solar when corroborated (real rain, 2 stations)', () => {
    const stations = [station('a', 42.31, -8.61), station('b', 42.30, -8.62)];
    const readings = new Map([
      ['a', { ...reading('a', 1.2), solarRadiation: 90 }],
      ['b', { ...reading('b', 0.8), solarRadiation: 90 }], // 2nd wet station → corroborated
    ]);
    const r = assessRainNowcast(opts({ stations, readings }));
    expect(r.rainingNow).toBe(true);
  });

  it('does NOT report raining when the current-hour forecast is clearly dry (WU area, no solar) — Liméns/Cangas case', () => {
    const stations = [station('a', 42.31, -8.61)];
    // Station reports 0.4mm (accumulated from earlier), reports NO solar (WU),
    // but the model says this hour is dry (0% prob) → not raining now.
    const readings = new Map([['a', reading('a', 0.4)]]);
    const forecast = [fcHour(0, 0, 0)]; // current hour, 0% precip prob
    const r = assessRainNowcast(opts({ stations, readings, forecast }));
    expect(r.rainingNow).toBe(false);
    expect(r.status).not.toBe('raining');
  });

  it('reports raining when the current-hour forecast also shows rain likely', () => {
    const stations = [station('a', 42.31, -8.61)];
    const readings = new Map([['a', reading('a', 1.0)]]);
    const forecast = [fcHour(0, 1.0, 80)]; // current hour, rain likely
    const r = assessRainNowcast(opts({ stations, readings, forecast }));
    expect(r.rainingNow).toBe(true);
  });

  it('picks the WETTEST nearby station for intensity + attribution', () => {
    const stations = [station('a', 42.31, -8.61), station('b', 42.30, -8.62)];
    const readings = new Map([['a', reading('a', 0.4)], ['b', reading('b', 8)]]);
    const r = assessRainNowcast(opts({ stations, readings }));
    expect(r.intensityMm).toBeCloseTo(8, 1);
    expect(r.stationName).toBe('b');
    expect(r.intensityLabel).toMatch(/fuerte/);
  });

  it('ignores stations beyond the radius', () => {
    const stations = [station('far', 42.6, -9.1)]; // ~50km
    const readings = new Map([['far', reading('far', 10)]]);
    const r = assessRainNowcast(opts({ stations, readings, radiusKm: 12 }));
    expect(r.rainingNow).toBe(false);
  });

  it('ignores stale readings (>60min)', () => {
    const stations = [station('a', 42.31, -8.61)];
    const readings = new Map([['a', reading('a', 5, 90)]]); // 90min old
    const r = assessRainNowcast(opts({ stations, readings }));
    expect(r.rainingNow).toBe(false);
  });

  it('precip below threshold (sensor noise) → not raining', () => {
    const stations = [station('a', 42.31, -8.61)];
    const readings = new Map([['a', reading('a', 0.1)]]); // < 0.2
    const r = assessRainNowcast(opts({ stations, readings }));
    expect(r.rainingNow).toBe(false);
    expect(r.status).toBe('dry');
  });

  it('observed rain (corroborated by 2 stations) takes priority over a dry-later forecast', () => {
    const stations = [station('a', 42.31, -8.61), station('b', 42.30, -8.62)];
    const readings = new Map([['a', reading('a', 2)], ['b', reading('b', 1.5)]]); // 2 wet → corroborated
    const forecast = [fcHour(2, 0, 0)]; // forecast says dry later (outside the near-now window)
    const r = assessRainNowcast(opts({ stations, readings, forecast }));
    expect(r.status).toBe('raining');
  });
});

describe('assessRainNowcast — forecast', () => {
  it('rain-soon when forecast rain within the soon horizon (≤3h)', () => {
    const forecast = [fcHour(1, 0, 0), fcHour(2, 1.5, 80)];
    const r = assessRainNowcast(opts({ forecast }));
    expect(r.status).toBe('rain-soon');
    expect(r.nextRainHours).toBeCloseTo(2, 1);
    expect(r.nextRainProb).toBe(80);
    expect(r.summary).toMatch(/Lluvia prevista/);
  });

  it('dry-with-later-rain when rain is beyond the soon horizon but in window', () => {
    const forecast = [fcHour(5, 2, 70)]; // 5h out → within 6h window, beyond 3h soon
    const r = assessRainNowcast(opts({ forecast }));
    expect(r.status).toBe('dry');
    expect(r.nextRainHours).toBeCloseTo(5, 1);
    expect(r.summary).toMatch(/más tarde/);
  });

  it('forecast rain below precip/prob thresholds does not trigger', () => {
    const forecast = [fcHour(1, 0.3, 90), fcHour(2, 2, 30)]; // low mm / low prob
    const r = assessRainNowcast(opts({ forecast }));
    expect(r.nextRainHours).toBeNull();
    expect(r.status).toBe('dry');
  });

  it('ignores forecast beyond the look-ahead window', () => {
    const forecast = [fcHour(10, 5, 90)];
    const r = assessRainNowcast(opts({ forecast }));
    expect(r.nextRainHours).toBeNull();
  });
});

describe('assessRainNowcast — degenerate', () => {
  it('no stations and no forecast → unknown', () => {
    const r = assessRainNowcast(opts());
    expect(r.status).toBe('unknown');
    expect(r.summary).toMatch(/[Ss]in datos/);
  });

  it('fresh dry station, no forecast → dry', () => {
    const stations = [station('a', 42.31, -8.61)];
    const readings = new Map([['a', reading('a', 0)]]);
    const r = assessRainNowcast(opts({ stations, readings }));
    expect(r.status).toBe('dry');
    expect(r.summary).toMatch(/[Ss]in lluvia próxima/);
  });
});
