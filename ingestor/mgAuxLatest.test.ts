import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('./db.js', () => ({ getPool: () => ({ query }) }));
vi.mock('./logger.js', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), ok: vi.fn() } }));

import {
  parseMgAuxStationId,
  rowToMgAuxLatest,
  queryMgAuxLatestUncached,
  MG_AUX_MAX_AGE_MIN,
  __resetMgAuxLatestForTests,
} from './mgAuxLatest';

beforeEach(() => {
  query.mockReset();
  __resetMgAuxLatestForTests();
});

describe('parseMgAuxStationId', () => {
  it('accepts only mg_<digits>', () => {
    expect(parseMgAuxStationId('mg_19032')).toBe('mg_19032');
    expect(parseMgAuxStationId(' mg_10905 ')).toBe('mg_10905');
    expect(parseMgAuxStationId('19032')).toBeNull();
    expect(parseMgAuxStationId('aemet_1690A')).toBeNull();
    expect(parseMgAuxStationId("mg_1' OR 1=1")).toBeNull();
    expect(parseMgAuxStationId(undefined)).toBeNull();
  });
});

describe('rowToMgAuxLatest', () => {
  it('maps a row with gust and direction but no mean', () => {
    const r = rowToMgAuxLatest('mg_19032', { time: new Date('2026-10-20T10:50:00Z'), wind_2m: null, gust_2m: '4.2', dir_2m: 238 });
    expect(r).toEqual({ stationId: 'mg_19032', time: '2026-10-20T10:50:00.000Z', wind2m: null, gust2m: 4.2, dir2m: 238 });
  });

  it('gives null when there is no speed at all, or no row', () => {
    expect(rowToMgAuxLatest('mg_1', { time: new Date(), wind_2m: null, gust_2m: null, dir_2m: 200 })).toBeNull();
    expect(rowToMgAuxLatest('mg_1', undefined)).toBeNull();
  });

  it('drops out-of-range values', () => {
    const r = rowToMgAuxLatest('mg_1', { time: new Date(), wind_2m: -3, gust_2m: 5, dir_2m: 400 });
    expect(r?.wind2m).toBeNull();
    expect(r?.dir2m).toBeNull();
  });
});

describe('queryMgAuxLatestUncached', () => {
  it('reads the last row within the freshness window with parameters only', async () => {
    query.mockResolvedValue({ rows: [{ time: new Date('2026-10-20T10:50:00Z'), wind_2m: 1.1, gust_2m: 3.9, dir_2m: 240 }] });
    const r = await queryMgAuxLatestUncached('mg_19032');
    expect(r?.gust2m).toBe(3.9);
    const [sql, values] = query.mock.calls[0];
    expect(sql).toMatch(/FROM mg_aux_readings/);
    expect(sql).toMatch(/station_id = \$1/);
    expect(sql).toMatch(/ORDER BY time DESC/);
    expect(sql).not.toMatch(/mg_19032/);
    expect(values).toEqual(['mg_19032', String(MG_AUX_MAX_AGE_MIN)]);
  });

  it('answers null when nothing is fresh', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await queryMgAuxLatestUncached('mg_19032')).toBeNull();
  });

  it('answers null (not an error) when the table does not exist', async () => {
    query.mockRejectedValue(Object.assign(new Error('relation "mg_aux_readings" does not exist'), { code: '42P01' }));
    await expect(queryMgAuxLatestUncached('mg_19032')).resolves.toBeNull();
  });

  it('lets any other database error through', async () => {
    query.mockRejectedValue(Object.assign(new Error('boom'), { code: '57P01' }));
    await expect(queryMgAuxLatestUncached('mg_19032')).rejects.toThrow('boom');
  });
});
