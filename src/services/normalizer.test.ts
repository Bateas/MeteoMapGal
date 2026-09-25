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
    expect(reading.pressure).toBeNull();
  });

  // The field read for months was `plession`, which AEMET never sends: every
  // AEMET reading was stored without pressure. AEMET sends `pres` (station level).
  it('reduces station pressure to sea level, like every other source we store', () => {
    // Real observation, Ourense (aemet_1690A, 143 m): AEMET's own pres_nmar was 1018.9
    const reading = normalizeAemetObservation({
      idema: '1690A', fint: '2026-09-24T17:00:00', alt: 143, ta: 24, pres: 1002.4,
    } as unknown as AemetRawObservation);
    expect(reading.pressure).not.toBeNull();
    expect(reading.pressure!).toBeGreaterThan(1017);
    expect(reading.pressure!).toBeLessThan(1021);
  });

  it('falls back to AEMET sea-level pressure only when station pressure is missing', () => {
    const reading = normalizeAemetObservation({
      idema: '1484C', fint: '2026-09-24T17:00:00', alt: 108, pres_nmar: 1021.3,
    } as unknown as AemetRawObservation);
    expect(reading.pressure).toBe(1021.3);
  });

  it('drops implausible pressure', () => {
    const reading = normalizeAemetObservation({
      idema: 'X', fint: '2026-09-24T17:00:00', alt: 0, pres_nmar: 13.2,
    } as unknown as AemetRawObservation);
    expect(reading.pressure).toBeNull();
  });

  it('keeps the spread of wind and turns minutes of sun in the hour into a share', () => {
    const reading = normalizeAemetObservation({
      idema: '1393', fint: '2026-09-25T08:00:00', alt: 50, stddv: 8, stdvv: 0.6, inso: 34,
    } as unknown as AemetRawObservation);
    expect(reading.windDirSd).toBe(8);
    expect(reading.windSpeedSd).toBe(0.6);
    expect(reading.sunFrac).toBeCloseTo(0.567, 3);
    // AEMET has no 10 cm air or 10 cm soil sensor; its surface and 5/20 cm readings stay out.
    expect(reading.temp10cm ?? null).toBeNull();
    expect(reading.soilTemp ?? null).toBeNull();
  });

  it('leaves the new fields null when a station does not send them', () => {
    const reading = normalizeAemetObservation({
      idema: '1387', fint: '2026-09-25T08:00:00', alt: 57,
    } as unknown as AemetRawObservation);
    expect(reading.windDirSd).toBeNull();
    expect(reading.windSpeedSd).toBeNull();
    expect(reading.sunFrac).toBeNull();
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
  }) as unknown as Parameters<typeof normalizeMeteoGaliciaObservation>[1];

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

  // MeteoGalicia does send pressure (the old comment said it did not): PR_AVG_1.5m at
  // station level and PRED_AVG_1.5m reduced to sea level. We store the sea-level one.
  it('takes the sea-level pressure, not the station-level one', () => {
    const reading = normalizeMeteoGaliciaObservation(10154, makeMG([
      { codigoParametro: 'PR_AVG_1.5m', valor: 991.4 },
      { codigoParametro: 'PRED_AVG_1.5m', valor: 1022 },
    ]));
    expect(reading!.pressure).toBe(1022);
  });

  it('filters the -9999 sentinel from pressure', () => {
    const reading = normalizeMeteoGaliciaObservation(10154, makeMG([
      { codigoParametro: 'PRED_AVG_1.5m', valor: -9999 },
    ]));
    expect(reading!.pressure).toBeNull();
  });

  // Values copied from a live payload (Ons, 25-sep 09:10 UTC).
  it('keeps the spread of wind, the sun, and the near-ground and soil temperatures', () => {
    const reading = normalizeMeteoGaliciaObservation(10126, makeMG([
      { codigoParametro: 'DV_SD_10m', valor: 15 },
      { codigoParametro: 'VV_SD_10m', valor: 0.67 },
      { codigoParametro: 'HSOL_SUM_1.5m', valor: 0.1667 },
      { codigoParametro: 'TA_AVG_0.1m', valor: 18.77 },
      { codigoParametro: 'TS_AVG_-0.1m', valor: 18.18 },
    ]));
    expect(reading!.windDirSd).toBe(15);
    expect(reading!.windSpeedSd).toBe(0.67);
    expect(reading!.sunFrac).toBe(1);          // 0.1667 h = the whole 10 minutes
    expect(reading!.temp10cm).toBe(18.77);
    expect(reading!.soilTemp).toBe(18.18);
  });

  it('reads sunshine in hours, so 0.1 h is 60% of the 10 minutes', () => {
    const reading = normalizeMeteoGaliciaObservation(10126, makeMG([
      { codigoParametro: 'HSOL_SUM_1.5m', valor: 0.1 },
    ]));
    expect(reading!.sunFrac).toBe(0.6);
  });

  it('drops the sentinel and impossible values from the new fields', () => {
    const reading = normalizeMeteoGaliciaObservation(10126, makeMG([
      { codigoParametro: 'DV_SD_10m', valor: -9999 },
      { codigoParametro: 'VV_SD_10m', valor: 45 },
      { codigoParametro: 'HSOL_SUM_1.5m', valor: -9999 },
      { codigoParametro: 'TS_AVG_-0.1m', valor: -9999 },
    ]));
    expect(reading!.windDirSd).toBeNull();
    expect(reading!.windSpeedSd).toBeNull();
    expect(reading!.sunFrac).toBeNull();
    expect(reading!.soilTemp).toBeNull();
    expect(reading!.temp10cm).toBeNull();      // not sent at all
  });
});

describe('normalizeIpmaStation', () => {
  it('normalizes IPMA station with district and coordinates', () => {
    const feat = {
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [-8.83, 41.69] as [number, number] },
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

  it('never leaves a station without a name', () => {
    // `localEstacao` is optional in the payload and a station popup, a history
    // dropdown and a wind-trend alert all print the name.
    const station = normalizeIpmaStation({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-8.67, 41.97] },
      properties: { idEstacao: 1210604, time: '2026-09-21T16:00:00' },
    });
    expect(station.name).toBe('IPMA 1210604');
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
    expect(reading.solarRadiation).toBe(125); // 450 kJ/m² over the hour
    expect(reading.dewPoint).not.toBeNull();
  });

  it('converts the hourly solar energy (kJ/m²) into the mean irradiance (W/m²) every consumer expects', () => {
    // A real row, Viana do Castelo (Chafé) at 16:00 UTC on 21-Sep, clear sky.
    // IPMA documents `radiacao` as "radiação solar (kJ/m2)": energy over the
    // hour, not a flux. Stored raw it read 1898.7 "W/m²" — above the solar
    // constant — so the quality check nulled every midday value and the
    // morning ones went in 3.6 times too high.
    const reading = normalizeIpmaReading({
      intensidadeVentoKM: 12.6,
      temperatura: 29.4,
      idEstacao: 1200551,
      pressao: 1022.8,
      humidade: 36.0,
      localEstacao: 'Viana Castelo, Chafé',
      precAcumulada: 0.0,
      idDireccVento: 8,
      radiacao: 1898.7,
      time: '2026-09-21T16:00:00',
      intensidadeVento: 3.5,
    });
    expect(reading.solarRadiation).toBeCloseTo(527.4, 1);
    // Clear-sky ballpark for 41.6°N three hours after solar noon at the
    // equinox is ~500 W/m²; the converted value has to be physically possible.
    expect(reading.solarRadiation!).toBeLessThan(1300);
    expect(reading.windSpeed).toBe(3.5);
    expect(reading.windDirection).toBe(315);
    expect(reading.timestamp.toISOString()).toBe('2026-09-21T16:00:00.000Z');
  });

  it('never invents a timestamp for a row that has none', () => {
    // Stamping it "now" would make a reading of unknown age look perfectly
    // fresh to every staleness gate. An invalid date is dropped by the
    // ingestor's timestamp check and by the client instead.
    const reading = normalizeIpmaReading({ idEstacao: 1, time: '' });
    expect(Number.isNaN(reading.timestamp.getTime())).toBe(true);
  });

  it('keeps a missing solar value missing rather than converting the sentinel', () => {
    const reading = normalizeIpmaReading({ idEstacao: 1, time: '2026-09-21T02:00:00', radiacao: -99.0 });
    expect(reading.solarRadiation).toBeNull();
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

