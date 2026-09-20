import { describe, it, expect } from 'vitest';
import {
  normalizeAemetStation,
  normalizeAemetObservation,
  normalizeMeteoclimaticObservation,
  normalizeMeteoGaliciaObservation,
  normalizeIpmaStation,
  normalizeIpmaReading,
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

describe('normalizeMeteoGaliciaObservation', () => {
  const makeMG = (measures: Array<{ codigoParametro: string; valor: number }>) => ({
    estacion: 'Test',
    idEstacion: 10165,
    instanteLecturaUTC: '2026-04-01T07:00:00Z',
    listaMedidas: measures.map((m) => ({ ...m, unidade: '', codigoUnidade: '' })),
  });

  it('filters -9999 sentinel values from all fields', () => {
    const reading = normalizeMeteoGaliciaObservation(10165, makeMG([
      { codigoParametro: 'VV_AVG_10m', valor: -9999 },
      { codigoParametro: 'VV_RACHA_10m', valor: -9999 },
      { codigoParametro: 'DV_AVG_10m', valor: -9999 },
      { codigoParametro: 'TA_AVG_1.5m', valor: -9999 },
      { codigoParametro: 'HR_AVG_1.5m', valor: -9999 },
      { codigoParametro: 'RS_AVG_1.5m', valor: -9999 },
    ]));
    expect(reading).not.toBeNull();
    expect(reading!.windSpeed).toBeNull();
    expect(reading!.windGust).toBeNull();
    expect(reading!.windDirection).toBeNull();
    expect(reading!.temperature).toBeNull();
    expect(reading!.humidity).toBeNull();
    expect(reading!.solarRadiation).toBeNull();
  });

  it('passes valid values through', () => {
    const reading = normalizeMeteoGaliciaObservation(10165, makeMG([
      { codigoParametro: 'VV_AVG_10m', valor: 5.2 },
      { codigoParametro: 'TA_AVG_1.5m', valor: 18.5 },
      { codigoParametro: 'HR_AVG_1.5m', valor: 72 },
    ]));
    expect(reading!.windSpeed).toBe(5.2);
    expect(reading!.temperature).toBe(18.5);
    expect(reading!.humidity).toBe(72);
  });
});

describe('normalizeIpmaStation', () => {
  it('normalizes IPMA station with district and coordinates', () => {
    const feat = {
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [-8.83, 41.69] },
      properties: {
        idEstacao: 1200545,
        localEstacao: 'Viana do Castelo (Chafé)',
        time: '2026-09-20T18:00:00',
        temperatura: 21.4,
        humidade: 78,
      },
    };
    const station = normalizeIpmaStation(feat);
    expect(station.id).toBe('ipma_1200545');
    expect(station.source).toBe('ipma');
    expect(station.name).toBe('Viana do Castelo (Chafé)');
    expect(station.lat).toBe(41.69);
    expect(station.lon).toBe(-8.83);
    expect(station.province).toBe('Viana do Castelo (Portugal)');
  });
});

describe('normalizeIpmaReading', () => {
  it('normalizes IPMA properties, converts km/h to m/s, maps wind direction and computes dew point', () => {
    const props = {
      idEstacao: 1200545,
      time: '2026-09-20T18:00:00',
      temperatura: 20.0,
      humidade: 60,
      ventoIntensidadeKm: 18.0, // 18 / 3.6 = 5.0 m/s
      ventoRachamx: 36.0,       // 36 / 3.6 = 10.0 m/s
      idVentoDir: 1,            // 1 = N = 0°
      pressao: 1018.5,
      precAcumulada: 1.2,
      radTotal: 450,
    };
    const reading = normalizeIpmaReading(props);
    expect(reading.stationId).toBe('ipma_1200545');
    expect(reading.temperature).toBe(20.0);
    expect(reading.humidity).toBe(60);
    expect(reading.windSpeed).toBeCloseTo(5.0, 1);
    expect(reading.windGust).toBeCloseTo(10.0, 1);
    expect(reading.windDirection).toBe(0);
    expect(reading.pressure).toBe(1018.5);
    expect(reading.precipitation).toBe(1.2);
    expect(reading.solarRadiation).toBe(450);
    expect(reading.dewPoint).not.toBeNull();
  });

  it('filters -99 and -990 sentinel values', () => {
    const props = {
      idEstacao: 1200545,
      time: '2026-09-20T18:00:00',
      temperatura: -99.0,
      humidade: -99.0,
      ventoIntensidadeKm: -99.0,
      ventoRachamx: -990.0,
      idVentoDir: 0,
      pressao: -990.0,
      precAcumulada: -99.0,
    };
    const reading = normalizeIpmaReading(props);
    expect(reading.temperature).toBeNull();
    expect(reading.humidity).toBeNull();
    expect(reading.windSpeed).toBeNull();
    expect(reading.windGust).toBeNull();
    expect(reading.windDirection).toBeNull();
    expect(reading.pressure).toBeNull();
    expect(reading.precipitation).toBeNull();
    expect(reading.dewPoint).toBeNull();
  });
});

