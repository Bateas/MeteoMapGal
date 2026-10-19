import { describe, expect, it } from 'vitest';
import {
  castDaysToFetch, castRefs, ctdRows, dedupeCtdRows, dedupePlatformRows, nextDay, platformPlan, platformRows,
  platformWindow, tokenExpiryMs,
} from './intecmarLogic';

// Shapes copied from real answers of api.intecmar.gal (19-oct-2026), trimmed.
const series = (depth: number, samples: Array<[string, number, number]>) => ({
  StationCode: 15100, ParameterId: 20003, ParameterCode: 'TAU', Function: 'AVG', Depth: depth, UnitDepth: 'm',
  Frequency: '10minutal', Samples: samples.map(([Date, Value, QualityCode]) => ({ Date, Value, QualityCode })),
});

describe('platformPlan', () => {
  it('asks 39 series of the five live platforms, none of Cíes', () => {
    const plan = platformPlan();
    expect(plan).toHaveLength(39);
    expect(new Set(plan.map((p) => p.station))).toEqual(new Set([15001, 15004, 15005, 15009, 15100]));
  });

  it('never asks Rande for wind (it has no anemometer)', () => {
    const rande = platformPlan().filter((p) => p.station === 15100).map((p) => p.parameterId);
    expect(rande).not.toContain(81);
    expect(rande).not.toContain(82);
    expect(rande).toContain(20003);
  });

  it('asks the gust as its own function of the wind speed', () => {
    const cortegada = platformPlan().filter((p) => p.station === 15001 && p.parameterId === 81).map((p) => p.func);
    expect(cortegada.sort()).toEqual(['AVG', 'RACHA']);
  });
});

describe('platformWindow / nextDay', () => {
  it('covers the two whole UTC days before now, ending on today (end_date stops at its 00:00)', () => {
    expect(platformWindow(Date.parse('2026-10-19T02:00:00Z'))).toEqual({ begin: '2026-10-17', end: '2026-10-19' });
    expect(platformWindow(Date.parse('2026-11-01T23:59:00Z'))).toEqual({ begin: '2026-10-30', end: '2026-11-01' });
  });

  it('gives the next day across a month end', () => {
    expect(nextDay('2026-10-31')).toBe('2026-11-01');
  });
});

describe('platformRows', () => {
  it('turns one series per depth into rows with their depth and quality code', () => {
    const rows = platformRows([
      series(1.5, [['2026-10-14T00:00:00Z', 16.33, 1], ['2026-10-14T00:10:00Z', 16.3, 1]]),
      series(14, [['2026-10-14T00:00:00Z', 15.49, 1]]),
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ station: 15100, parameterId: 20003, parameterCode: 'TAU', func: 'AVG', depthM: 1.5, value: 16.33, qualityCode: 1 });
    expect(rows[0].time.toISOString()).toBe('2026-10-14T00:00:00.000Z');
    expect(rows[2].depthM).toBe(14);
  });

  it('keeps a -9999 as NULL with its code, and every quality code (nothing filtered before storing)', () => {
    const rows = platformRows([series(1, [['2026-10-18T18:00:00Z', -9999, 9], ['2026-10-18T18:10:00Z', 8.3, 4]])]);
    expect(rows.map((r) => [r.value, r.qualityCode])).toEqual([[null, 9], [8.3, 4]]);
  });

  it('drops only samples without a readable date, and survives junk', () => {
    expect(platformRows([series(1, [['not a date', 1, 1]])])).toEqual([]);
    expect(platformRows(null)).toEqual([]);
    expect(platformRows({ detail: 'Not authenticated' })).toEqual([]);
  });
});

describe('dedupePlatformRows', () => {
  it('removes the repeated series the catalogue lists twice', () => {
    const one = series(4, [['2026-10-14T00:00:00Z', 12, 1]]);
    const { rows, repeated } = dedupePlatformRows(platformRows([one, one]));
    expect(rows).toHaveLength(1);
    expect(repeated).toBe(1);
  });
});

describe('CTD', () => {
  const lasts = [
    { IdCast: 43392, StationCode: 'P0', CastDate: '2026-10-15T15:05:52', ConfigCTDName: '1279_048' },
    { IdCast: 43383, StationCode: 'V3', CastDate: '2026-10-15T09:58:55', ConfigCTDName: '1279_048' },
    { IdCast: 43384, StationCode: 'V3', CastDate: '2026-10-15T10:30:00', ConfigCTDName: '1279_048' },
    { IdCast: 43300, StationCode: 'V4', CastDate: '2026-10-08T10:00:00', ConfigCTDName: '1279_048' },
  ];

  it('asks once per station and day, and only for casts not stored', () => {
    const todo = castDaysToFetch(castRefs(lasts), new Set([43300]));
    expect(todo).toEqual([{ station: 'P0', day: '2026-10-15' }, { station: 'V3', day: '2026-10-15' }]);
  });

  it('turns scans into one row per parameter, keeping the flag and the out-of-water scans', () => {
    const rows = ctdRows([{
      IdCast: 43383, StationCode: 'V3', CastDate: '2026-10-15T09:58:55', ConfigCTDName: '1279_048',
      Scans: [{ Scan: 35, Parameters: {
        Temperatura: { Value: 16.48, QualityFlag: 0, Units: '°C' },
        Salinidad: { Value: 1.19, QualityFlag: 0, Units: '' },
        pH: { Value: -2.35, QualityFlag: 4, Units: '' },
      } }],
    }]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ castId: 43383, station: 'V3', castDate: '2026-10-15T09:58:55', scan: 35, parameter: 'Temperatura', value: 16.48, qualityFlag: 0, units: '°C' });
    expect(rows[1].units).toBeNull();
    expect(dedupeCtdRows([...rows, rows[0]])).toHaveLength(3);
  });
});

describe('tokenExpiryMs', () => {
  const jwt = (payload: object) => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`;

  it('reads exp and keeps a 5-minute margin', () => {
    expect(tokenExpiryMs(jwt({ exp: 2_000_000_000, type: 'ACCESS_TOKEN' }), 0)).toBe(2_000_000_000_000 - 300_000);
  });

  it('falls back to one hour when the token cannot be read', () => {
    expect(tokenExpiryMs('garbage', 1_000)).toBe(1_000 + 3_600_000);
    expect(tokenExpiryMs(jwt({ sub: 'x' }), 1_000)).toBe(1_000 + 3_600_000);
  });
});
