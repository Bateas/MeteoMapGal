/**
 * POEM: scaling, units, quality flags and time. The rows are the examples of
 * Puertos del Estado's user guide (27-jun-2025): the Málaga coastal buoy (1514,
 * redcos_tr) and the Sagunto tide gauge (3655, redmar_mir_tr).
 */
import { describe, it, expect } from 'vitest';
import {
  buildStationPlan, planRequestColumns, poemRowToReading, poemRows, poemFechaMs, poemTablePath,
  qcColumnFor, toInternalUnit, jwtExpiryMs, poemIsoUtc,
  type EstacionParamRow, type ParamInfo,
} from './poemLogic.js';

const HOUR = 3_600_000;
const T_GUIDE = 1750550400 * 1000; // "fecha": 1750550400 in both guide examples = 2025-06-22 00:00 UTC

function params(list: [number, string, string][]): Map<number, ParamInfo> {
  return new Map(list.map(([id, descripcion, unidad]) => [id, { id_param: id, descripcion, unidad }]));
}

describe('Málaga buoy (guide appendix 1, redcos_tr)', () => {
  const rows: EstacionParamRow[] = [
    { param: 20, factor: 1, db_column: 'dmd', db_table: 'boyas.redcos_tr' },
    { param: 86, factor: 1, db_column: 'ds', db_table: 'boyas.redcos_tr' },
    { param: 11, factor: 100, db_column: 'h13', db_table: 'boyas.redcos_tr' },
    { param: 13, factor: 100, db_column: 'hm0', db_table: 'boyas.redcos_tr' },
    { param: 17, factor: 100, db_column: 'hmax', db_table: 'boyas.redcos_tr' },
    { param: 34, factor: 100, db_column: 'tp', db_table: 'boyas.redcos_tr' },
    { param: 32, factor: 100, db_column: 'tm02', db_table: 'boyas.redcos_tr' },
    { param: 50, factor: 10, db_column: 'ts', db_table: 'boyas.redcos_tr' },
  ];
  const units = params([
    [20, 'Dirección media de procedencia', 'grados'], [13, 'Altura significante (momento de orden cero)', 'm'],
    [17, 'Altura máxima', 'm'], [34, 'Periodo de pico', 's'], [32, 'Periodo medio', 's'], [50, 'Temperatura del agua', 'ºC'],
  ]);
  // The row of the guide, with the fields it lists.
  const row = {
    h13: 21, tp: 480, qc_pos: 1, h110: 28, dmd: 128, dmd_p: null, hm: 13, ds: 46, fecha: 1750550400, th13: 430,
    qc_e: 1, codigo: 1514, th110: 430, qc_d: 1, ts: 245, tm: 380, bat: 1273, qc_ts: 1, hm0: 21, lon: -4.4411,
    hmax: 50, tm02: 390, lat: 36.6385,
  };

  it('picks the table and the columns we use, with their factor, unit and quality flag', () => {
    const plan = buildStationPlan(1514, rows, units)!;
    expect(plan.table).toBe('boyas/redcos_tr');
    const hm0 = plan.columns.find((c) => c.column === 'hm0')!;
    expect(hm0).toMatchObject({ field: 'waveHeight', factor: 100, unit: 'm', qcColumn: 'qc_e' });
    expect(plan.columns.find((c) => c.column === 'dmd')!.qcColumn).toBe('qc_d');
    // h13 and ds are not fields of ours
    expect(plan.columns.map((c) => c.column).sort()).toEqual(['dmd', 'hm0', 'hmax', 'tm02', 'tp', 'ts']);
  });

  it('h13 / 100 style scaling: 21 → 0.21 m, as the guide works it out', () => {
    const plan = buildStationPlan(1514, rows, units)!;
    const { reading, dropped } = poemRowToReading(plan, 'Málaga', row, T_GUIDE + HOUR, 6 * HOUR);
    expect(dropped).toEqual([]);
    expect(reading).toMatchObject({
      time: '2025-06-22T00:00:00.000Z', stationId: 1514, source: 'portus',
      waveHeight: 0.21, waveHeightMax: 0.5, wavePeriod: 4.8, wavePeriodMean: 3.9, waveDir: 128, waterTemp: 24.5,
    });
    expect(reading!.windSpeed).toBeNull();
  });
});

describe('Sagunto tide gauge (guide appendix 2, redmar_mir_tr)', () => {
  const rows: EstacionParamRow[] = [
    { param: 13, factor: 100, db_column: 'hm0', db_table: 'mareas.redmar_mir_tr' },
    { param: 17, factor: 100, db_column: 'hmax', db_table: 'mareas.redmar_mir_tr' },
    { param: 27, factor: 1000, db_column: 'nivel', db_table: 'mareas.redmar_mir_tr' },
    { param: 32, factor: 100, db_column: 'tm02', db_table: 'mareas.redmar_mir_tr' },
    { param: 87, factor: 10000, db_column: 'ol', db_table: 'mareas.redmar_mir_tr' },
    { param: 34, factor: 100, db_column: 'tp', db_table: 'mareas.redmar_mir_tr' },
  ];
  const units = params([[13, 'Hm0', 'm'], [17, 'Hmax', 'm'], [27, 'Nivel', 'm'], [32, 'Tm02', 's'], [34, 'Tp', 's']]);
  const row = {
    qc_hmax: 1, qc_vv_mx: null, qc_dv_ra: null, qc_vv_ra: null, fecha: 1750550400, qc_hm0: 1, ta: null, nivel: 14,
    qc_tm02: 1, dv_md: null, qc_nivel: 1, qc_tp: 1, dv_mx: null, ps: null, hmax: 60, vv_md: null, dv_ra: null,
    qc_ta: null, hm0: 36, vv_mx: null, qc_dv_md: null, qc_ps: null, tm02: 396, vv_ra: null, qc_dv_mx: null,
    ol: -12, codigo: 3655, tp: 468, qc_vv_md: null, qc_ol: 1,
  };

  it('level and waves scaled; nulls stay null', () => {
    const plan = buildStationPlan(3655, rows, units)!;
    expect(plan.table).toBe('mareas/redmar_mir_tr');
    const { reading } = poemRowToReading(plan, 'Sagunto', row, T_GUIDE + 10 * 60_000, 6 * HOUR);
    expect(reading).toMatchObject({ seaLevel: 0.014, waveHeight: 0.36, waveHeightMax: 0.6, wavePeriodMean: 3.96, wavePeriod: 4.68 });
    expect(reading!.windSpeed).toBeNull();
  });
});

describe('quality, units and bounds — fail closed', () => {
  const rows: EstacionParamRow[] = [
    { param: 1, factor: 100, db_column: 'vv_md', db_table: 'meteoro.rempor_tr' },
    { param: 2, factor: 1, db_column: 'dv_md', db_table: 'meteoro.rempor_tr' },
    { param: 3, factor: 100, db_column: 'vv_mx', db_table: 'meteoro.rempor_tr' },
    { param: 4, factor: 10, db_column: 'ta', db_table: 'meteoro.rempor_tr' },
    { param: 5, factor: 10, db_column: 'ps', db_table: 'meteoro.rempor_tr' },
    { param: 6, factor: 1, db_column: 'hr', db_table: 'meteoro.rempor_tr' },
  ];
  const units = params([[1, 'Velocidad media', 'm/s'], [2, 'Dirección media', 'º'], [3, 'Velocidad máxima', 'm/s'], [4, 'Temp aire', 'ºC'], [5, 'Presión', 'hPa'], [6, 'Humedad', '%']]);
  const plan = buildStationPlan(4272, rows, units)!;
  const now = Date.UTC(2026, 9, 1, 9, 0);
  const base = { codigo: 4272, fecha: now / 1000 - 600, vv_md: 1250, dv_md: 20, vv_mx: 1680, ta: 152, ps: 10184, hr: 81,
    qc_vv_md: 1, qc_dv_md: 1, qc_vv_mx: 2, qc_ta: 1, qc_ps: 1, qc_hr: 1 };

  it('a port weather station: wind, gust, direction, air, pressure, humidity', () => {
    const { reading } = poemRowToReading(plan, 'Ons', base, now, 6 * HOUR);
    expect(reading).toMatchObject({ windSpeed: 12.5, windGust: 16.8, windDir: 20, airTemp: 15.2, airPressure: 1018.4, humidity: 81 });
    expect(planRequestColumns(plan)).toEqual(expect.arrayContaining(['codigo', 'fecha', 'vv_md', 'qc_vv_md', 'qc_hr']));
  });

  it('a value flagged bad (qc 4) is dropped and named; the rest of the row stays', () => {
    const { reading, dropped } = poemRowToReading(plan, 'Ons', { ...base, qc_vv_md: 4 }, now, 6 * HOUR);
    expect(reading!.windSpeed).toBeNull();
    expect(reading!.windDir).toBe(20);
    expect(dropped).toContain('vv_md:qc=4');
  });

  it('a value out of physical bounds (a wrong factor would look like this) is dropped', () => {
    const { reading, dropped } = poemRowToReading(plan, 'Ons', { ...base, vv_md: 900000 }, now, 6 * HOUR);
    expect(reading!.windSpeed).toBeNull();
    expect(dropped).toContain('vv_md:range');
  });

  it('a speed without a unit is never stored (km/h read as m/s passes every bound)', () => {
    expect(toInternalUnit('windSpeed', 36, null)).toBeNull();
    expect(toInternalUnit('windSpeed', 36, 'km/h')).toBe(10);
    expect(toInternalUnit('windSpeed', 10, 'nudos')).toBeCloseTo(5.144, 3);
    expect(toInternalUnit('currentSpeed', 25, 'cm/s')).toBe(0.25);
    expect(toInternalUnit('seaLevel', 260, 'cm')).toBe(2.6);
    expect(toInternalUnit('seaLevel', 2.6, null)).toBe(2.6);
    expect(toInternalUnit('airPressure', 101840, 'Pa')).toBeCloseTo(1018.4, 5);
    expect(toInternalUnit('windDir', 200, 'furlongs')).toBeNull();
  });

  it('old, future, timeless or empty rows give no reading, with the reason', () => {
    expect(poemRowToReading(plan, 'Ons', { ...base, fecha: now / 1000 - 7 * 3600 }, now, 6 * HOUR).skip).toBe('stale');
    expect(poemRowToReading(plan, 'Ons', { ...base, fecha: now / 1000 + 3600 }, now, 6 * HOUR).skip).toBe('future');
    expect(poemRowToReading(plan, 'Ons', { ...base, fecha: null }, now, 6 * HOUR).skip).toBe('no-time');
    expect(poemRowToReading(plan, 'Ons', {}, now, 6 * HOUR).skip).toBe('empty');
    expect(poemRowToReading(plan, 'Ons', { codigo: 4272, fecha: now / 1000 }, now, 6 * HOUR).skip).toBe('no-values');
  });
});

describe('which table, which gust', () => {
  it('the table with more columns of ours wins', () => {
    const plan = buildStationPlan(3221, [
      { param: 1, factor: 100, db_column: 'vv_md', db_table: 'meteoro.rempor_tr' },
      { param: 2, factor: 1000, db_column: 'nivel', db_table: 'mareas.redmar_mir_tr' },
      { param: 1, factor: 100, db_column: 'vv_md', db_table: 'mareas.redmar_mir_tr' },
    ], new Map())!;
    expect(plan.table).toBe('mareas/redmar_mir_tr');
  });

  it('the gust is vv_mx when there is one, vv_ra otherwise', () => {
    const both = buildStationPlan(3221, [
      { param: 3, factor: 100, db_column: 'vv_ra', db_table: 'mareas.redmar_mir_tr' },
      { param: 4, factor: 100, db_column: 'vv_mx', db_table: 'mareas.redmar_mir_tr' },
    ], new Map())!;
    expect(both.columns.filter((c) => c.field === 'windGust').map((c) => c.column)).toEqual(['vv_mx']);
    const onlyRa = buildStationPlan(3221, [{ param: 3, factor: 100, db_column: 'vv_ra', db_table: 'mareas.redmar_mir_tr' }], new Map())!;
    expect(onlyRa.columns.map((c) => c.column)).toEqual(['vv_ra']);
  });

  it('a table name outside the allowlist never becomes a path; no factor, no column', () => {
    expect(poemTablePath('boyas.redext_tr')).toBe('boyas/redext_tr');
    expect(poemTablePath('rempor_tr')).toBe('meteoro/rempor_tr');
    expect(poemTablePath('../../admin')).toBeNull();
    expect(buildStationPlan(1, [{ param: 1, factor: null, db_column: 'vv_md', db_table: 'meteoro.rempor_tr' }], new Map())).toBeNull();
  });

  it('quality flags: per column, or the shared wave and direction flags of the moored buoys', () => {
    expect(qcColumnFor('boyas/redext_tr', 'hm0')).toBe('qc_e');
    expect(qcColumnFor('boyas/redext_tr', 'dmd')).toBe('qc_d');
    expect(qcColumnFor('boyas/redext_tr', 'vv_md')).toBe('qc_vv_md');
    expect(qcColumnFor('mareas/redmar_mir_tr', 'hm0')).toBe('qc_hm0');
  });
});

describe('answers, time and token', () => {
  it('Limit=1 answers an object; any other an array; an empty one {} or null', () => {
    expect(poemRows({ codigo: 1 })).toEqual([{ codigo: 1 }]);
    expect(poemRows([{ codigo: 1 }, { codigo: 2 }])).toHaveLength(2);
    expect(poemRows({})).toEqual([]);
    expect(poemRows(null)).toEqual([]);
  });

  it('fecha in seconds, milliseconds, as a numeric string or as a UTC wall clock: the same instant', () => {
    expect(poemFechaMs(1750550400)).toBe(T_GUIDE);
    expect(poemFechaMs(T_GUIDE)).toBe(T_GUIDE);
    expect(poemFechaMs('1750550400')).toBe(T_GUIDE);
    expect(poemFechaMs('2025-06-22 00:00:00')).toBe(T_GUIDE);
    expect(poemFechaMs('mañana')).toBeNull();
  });

  it('date filters in the form the guide uses', () => {
    expect(poemIsoUtc(Date.UTC(2026, 9, 1, 6, 0, 0, 123))).toBe('2026-10-01T06:00:00+00:00');
  });

  it('the token expiry is read from its exp claim, and a broken token gives null', () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    expect(jwtExpiryMs(`${b64({ alg: 'RS256' })}.${b64({ exp: 1760000000 })}.firma`)).toBe(1760000000 * 1000);
    expect(jwtExpiryMs('no-es-un-token')).toBeNull();
    expect(jwtExpiryMs('a.%%%.c')).toBeNull();
  });
});
