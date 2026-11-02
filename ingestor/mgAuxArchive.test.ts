import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('./db.js', () => ({ getPool: () => ({ query }) }));
vi.mock('./logger.js', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), ok: vi.fn() } }));

import { archiveMgAux, mgAuxInsertParts, __resetMgAuxArchiveForTests } from './mgAuxArchive';
import type { MgAuxReading } from '../src/api/mgAux2m';

const row = (id: string, min = 50): MgAuxReading => ({
  stationId: id,
  time: new Date(`2026-10-20T10:${min}:00Z`),
  wind2m: 2, gust2m: 7.3, dir2m: 238, windSd2m: 0.9, dirSd2m: 31, leafWetMin: null,
  grassTemp: 3.1, soilTemp10: 9, soilMoist20: null, sunMin: 10, windSd10: 0.4, dirSd10: 12,
});

beforeEach(() => {
  query.mockReset();
  __resetMgAuxArchiveForTests();
});

describe('mgAuxInsertParts', () => {
  it('lines up placeholders, values and the 14 columns', () => {
    const { tuples, values } = mgAuxInsertParts([row('mg_19032'), row('mg_19026')]);
    expect(tuples[0]).toBe('($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)');
    expect(tuples[1].startsWith('($15,')).toBe(true);
    expect(values).toHaveLength(28);
    expect(values[1]).toBe('mg_19032');
    expect(values[8]).toBe(3.1);
    expect(values[10]).toBeNull();
    expect(values[13]).toBe(12);
  });
});

describe('archiveMgAux', () => {
  it('writes with ON CONFLICT DO NOTHING and parameters only', async () => {
    query.mockResolvedValue({ rowCount: 2 });
    await archiveMgAux([row('mg_19032'), row('mg_19026')]);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO mg_aux_readings/);
    expect(sql).toMatch(/ON CONFLICT \(station_id, time\) DO NOTHING/);
    expect(sql).not.toMatch(/mg_19032/);
    expect(values).toHaveLength(28);
    const cols = sql.match(/\(time,[^)]*\)/s)![0].split(',');
    expect(cols).toHaveLength(14);
  });

  it('does nothing with no rows', async () => {
    await archiveMgAux([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('a missing table stops the archive until restart instead of failing every cycle', async () => {
    query.mockRejectedValue(Object.assign(new Error('relation "mg_aux_readings" does not exist'), { code: '42P01' }));
    await archiveMgAux([row('mg_19032')]);
    await archiveMgAux([row('mg_19032', 40)]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('a missing column stops it too (schema first, then the code)', async () => {
    query.mockRejectedValue(Object.assign(new Error('column "grass_temp" does not exist'), { code: '42703' }));
    await archiveMgAux([row('mg_19032')]);
    await archiveMgAux([row('mg_19032', 40)]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('any other failure does not stop it and never throws', async () => {
    query.mockRejectedValueOnce(new Error('connection reset')).mockResolvedValue({ rowCount: 1 });
    await expect(archiveMgAux([row('mg_19032')])).resolves.toBeUndefined();
    await archiveMgAux([row('mg_19032', 40)]);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
