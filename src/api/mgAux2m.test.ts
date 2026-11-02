import { describe, it, expect } from 'vitest';
import { parseMgAux2m, MG_AUX_PARAMS } from './mgAux2m';
import { MG_PARAMS } from '../types/meteogalicia';
import { normalizeMeteoGaliciaObservation } from '../services/normalizer';
import type { MeteoGaliciaObsEntry } from '../types/meteogalicia';

type M = { code: string; valor: number; unidade?: string; val?: number };
const entry = (measures: M[], time = '2026-10-20T10:50:00'): MeteoGaliciaObsEntry => ({
  estacion: 'Prado',
  idEstacion: 19032,
  instanteLecturaUTC: time,
  listaMedidas: measures.map((m) => ({
    codigoParametro: m.code,
    nomeParametro: '',
    unidade: m.unidade ?? '',
    valor: m.valor,
    lnCodigoValidacion: m.val ?? 1,
  })),
});

/** A 19xxx station as it comes: wind only at 2 m, leaf wetness, air at 1.5 m. */
const prado = (over: Partial<Record<string, Partial<M>>> = {}) => entry([
  { code: 'VV_AVG_2m', valor: 2.0, unidade: 'm/s' },
  { code: 'VV_RACHA_2m', valor: 7.3, unidade: 'm/s' },
  { code: 'DV_AVG_2m', valor: 238, unidade: 'º' },
  { code: 'VV_SD_2m', valor: 0.9, unidade: 'm/s' },
  { code: 'DV_SD_2m', valor: 31, unidade: 'º' },
  { code: 'HF_SUM_2m', valor: 0.1667, unidade: 'h' },
  { code: 'TA_AVG_1.5m', valor: 18.2, unidade: 'ºC' },
].map((m) => ({ ...m, ...(over[m.code] ?? {}) })));

describe('parseMgAux2m', () => {
  it('reads the 2 m wind set and leaf wetness of a vineyard station', () => {
    const r = parseMgAux2m(19032, prado());
    expect(r).toEqual({
      stationId: 'mg_19032',
      time: new Date('2026-10-20T10:50:00Z'),
      wind2m: 2.0,
      gust2m: 7.3,
      dir2m: 238,
      windSd2m: 0.9,
      dirSd2m: 31,
      leafWetMin: 10,
      grassTemp: null,
      soilTemp10: null,
      soilMoist20: null,
      sunMin: null,
      windSd10: null,
      dirSd10: null,
    });
  });

  it('keeps grass and soil temperature, sun and the 10 m spread of any station', () => {
    const r = parseMgAux2m(10905, entry([
      { code: 'TA_AVG_0.1m', valor: -1.4 },
      { code: 'TS_AVG_-0.1m', valor: 8.2 },
      { code: 'HS_CV_AVG_-0.2m', valor: 31 },
      { code: 'HSOL_SUM_1.5m', valor: 0.1667, unidade: 'h' },
      { code: 'VV_SD_10m', valor: 1.2 },
      { code: 'DV_SD_10m', valor: 22 },
    ]));
    expect(r).toMatchObject({ grassTemp: -1.4, soilTemp10: 8.2, soilMoist20: 31, sunMin: 10, windSd10: 1.2, dirSd10: 22, wind2m: null });
  });

  it('drops what is impossible in the new fields', () => {
    const r = parseMgAux2m(10905, entry([
      { code: 'TA_AVG_0.1m', valor: 95 },
      { code: 'HSOL_SUM_1.5m', valor: 0.5, unidade: 'h' },
      { code: 'DV_SD_10m', valor: 22 },
    ]));
    expect(r?.grassTemp).toBeNull();
    expect(r?.sunMin).toBeNull();
    expect(r?.dirSd10).toBe(22);
  });

  it('turns the -9999 sentinel into null, field by field', () => {
    const r = parseMgAux2m(19032, prado({ VV_AVG_2m: { valor: -9999 }, HF_SUM_2m: { valor: -9999 } }));
    expect(r?.wind2m).toBeNull();
    expect(r?.leafWetMin).toBeNull();
    expect(r?.gust2m).toBe(7.3);
  });

  it('drops a value MeteoGalicia itself flagged (any validation code but 1)', () => {
    for (const code of [2, 3, 5, 9]) {
      const r = parseMgAux2m(19032, prado({ DV_AVG_2m: { val: code } }));
      expect(r?.dir2m).toBeNull();
      expect(r?.wind2m).toBe(2.0);
    }
  });

  it('leaf wetness in hours becomes minutes of the 10; a minutes unit is taken as is', () => {
    expect(parseMgAux2m(19032, prado({ HF_SUM_2m: { valor: 0.05 } }))?.leafWetMin).toBe(3);
    expect(parseMgAux2m(19032, prado({ HF_SUM_2m: { valor: 4, unidade: 'min' } }))?.leafWetMin).toBe(4);
    // more than the period is not a reading
    expect(parseMgAux2m(19032, prado({ HF_SUM_2m: { valor: 0.5 } }))?.leafWetMin).toBeNull();
  });

  it('converts a km/h unit instead of storing it as m/s', () => {
    expect(parseMgAux2m(19032, prado({ VV_AVG_2m: { valor: 36, unidade: 'km/h' } }))?.wind2m).toBeCloseTo(10, 6);
  });

  it('rejects implausible values', () => {
    const r = parseMgAux2m(19032, prado({
      VV_AVG_2m: { valor: 95 }, DV_AVG_2m: { valor: 400 }, VV_SD_2m: { valor: 25 }, DV_SD_2m: { valor: 200 },
    }));
    expect(r?.wind2m).toBeNull();
    expect(r?.dir2m).toBeNull();
    expect(r?.windSd2m).toBeNull();
    expect(r?.dirSd2m).toBeNull();
    expect(r?.gust2m).toBe(7.3);
  });

  it('gives null for a station that carries none of the kept set', () => {
    const tenMetre = entry([
      { code: 'VV_AVG_10m', valor: 5 },
      { code: 'DV_AVG_10m', valor: 200 },
      { code: 'TA_AVG_1.5m', valor: 17 },
    ]);
    expect(parseMgAux2m(10905, tenMetre)).toBeNull();
  });

  it('gives null when every 2 m value is missing or flagged', () => {
    expect(parseMgAux2m(19032, entry([
      { code: 'VV_AVG_2m', valor: -9999 },
      { code: 'DV_AVG_2m', valor: 200, val: 3 },
    ]))).toBeNull();
  });

  it('gives null for a broken entry or timestamp', () => {
    expect(parseMgAux2m(19032, null)).toBeNull();
    expect(parseMgAux2m(19032, { ...prado(), listaMedidas: undefined as never })).toBeNull();
    expect(parseMgAux2m(19032, { ...prado(), instanteLecturaUTC: 'ayer' })).toBeNull();
  });
});

describe('the 2 m wind is read like any other station (owner decision, 20-oct)', () => {
  it('its wind codes are live codes too', () => {
    const live = new Set<string>(Object.values(MG_PARAMS));
    for (const code of [MG_AUX_PARAMS.WIND_SPEED_2M, MG_AUX_PARAMS.WIND_GUST_2M, MG_AUX_PARAMS.WIND_DIRECTION_2M]) expect(live.has(code)).toBe(true);
  });

  it('a 2 m-only station gets its wind in the normal reading', () => {
    const r = normalizeMeteoGaliciaObservation(19032, prado());
    expect(r?.windSpeed).toBe(2.0);
    expect(r?.windGust).toBe(7.3);
    expect(r?.windDirection).toBe(238);
    expect(r?.temperature).toBe(18.2);
  });
});
