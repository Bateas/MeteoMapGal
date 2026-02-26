import { describe, it, expect } from 'vitest';
import {
  normalizeAemetStation,
  normalizeAemetObservation,
  normalizeMeteoclimaticObservation,
} from './normalizer';
import type { AemetRawStation, AemetRawObservation } from '../types/aemet';
import type { MeteoclimaticRawStation } from '../types/meteoclimatic';

describe('normalizeAemetStation', () => {
  it('prefixes id with aemet_', () => {
    const station = normalizeAemetStation({
      indicativo: '1701X',
      nombre: 'RIBADAVIA',
      latitud: '422404N',
      longitud: '081060W',
      altitud: 105,
      provincia: 'OURENSE',
      indsinop: '',
    } as AemetRawStation);
    expect(station.id).toBe('aemet_1701X');
    expect(station.source).toBe('aemet');
    expect(station.name).toBe('RIBADAVIA');
    expect(station.altitude).toBe(105);
  });

  it('converts DMS coordinates to decimal', () => {
    const station = normalizeAemetStation({
      indicativo: '1701X',
      nombre: 'RIBADAVIA',
      latitud: '422404N',
      longitud: '081060W',
      altitud: 105,
      provincia: 'OURENSE',
      indsinop: '',
    } as AemetRawStation);
    // 42°24'04"N ≈ 42.40°
    expect(station.lat).toBeCloseTo(42.40, 1);
    // 08°10'60"W ≈ -8.18°
    expect(station.lon).toBeLessThan(0);
  });
});

describe('normalizeAemetObservation', () => {
  it('maps raw fields to normalized reading', () => {
    const reading = normalizeAemetObservation({
      idema: '1701X',
      fint: '2025-07-15T17:00:00',
      vv: 4.5,
      dv: 250,
      ta: 32,
      hr: 55,
      prec: 0,
    } as unknown as AemetRawObservation);
    expect(reading.stationId).toBe('aemet_1701X');
    expect(reading.windSpeed).toBe(4.5);
    expect(reading.windDirection).toBe(250);
    expect(reading.temperature).toBe(32);
    expect(reading.humidity).toBe(55);
  });

  it('handles null values gracefully', () => {
    const reading = normalizeAemetObservation({
      idema: '1701X',
      fint: '2025-07-15T17:00:00',
    } as unknown as AemetRawObservation);
    expect(reading.windSpeed).toBeNull();
    expect(reading.windDirection).toBeNull();
    expect(reading.temperature).toBeNull();
    expect(reading.humidity).toBeNull();
  });
});

describe('normalizeMeteoclimaticObservation', () => {
  it('converts wind speed from km/h to m/s', () => {
    const reading = normalizeMeteoclimaticObservation({
      id: 'ESORC3200000032010C',
      location: 'Ribadavia',
      pubDate: 'Wed, 25 Feb 2026 23:32:08 +0000',
      windSpeed: 36,
      windAzimuth: 225,
      temperature: 28,
      humidity: 60,
      rain: 0,
      qos: 3,
      pressure: 1013,
      windGust: 50,
    } as MeteoclimaticRawStation);

    expect(reading.stationId).toBe('mc_ESORC3200000032010C');
    // 36 km/h / 3.6 = 10 m/s
    expect(reading.windSpeed).toBeCloseTo(10, 5);
    expect(reading.windDirection).toBe(225);
    expect(reading.temperature).toBe(28);
  });

  it('handles null wind speed', () => {
    const reading = normalizeMeteoclimaticObservation({
      id: 'test',
      location: 'Test',
      pubDate: 'Wed, 25 Feb 2026 23:32:08 +0000',
      windSpeed: null,
      windAzimuth: null,
      temperature: 20,
      humidity: 50,
      rain: 0,
      qos: 3,
      pressure: null,
      windGust: null,
    } as MeteoclimaticRawStation);
    expect(reading.windSpeed).toBeNull();
    expect(reading.windDirection).toBeNull();
  });
});
