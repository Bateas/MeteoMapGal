import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('./db.js', () => ({ getPool: () => ({ query }) }));
vi.mock('./logger.js', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), ok: vi.fn() } }));

import { aemetAuxRow, aemetAuxInsertParts, archiveAemetAux, __resetAemetAuxForTests } from './aemetAuxArchive';
import type { AemetRawObservation } from '../src/types/aemet';

const obs = (over: Record<string, unknown> = {}) =>
  ({ idema: '1690A', fint: '2026-11-02T10:00:00+0000', tamin: 3.1, tamax: 5.2, ts: -0.4, tss5cm: 8, tss20cm: 10.5, stdvv: 0.6, stddv: 14, ...over }) as unknown as AemetRawObservation;

beforeEach(() => {
  query.mockReset();
  __resetAemetAuxForTests();
});

describe('aemetAuxRow', () => {
  it('reads the fields readings does not keep', () => {
    expect(aemetAuxRow(obs())).toEqual({
      time: new Date('2026-11-02T10:00:00Z'), stationId: 'aemet_1690A', taMin: 3.1, taMax: 5.2, groundTemp: -0.4,
      soil5: 8, soil20: 10.5, windSd: 0.6, dirSd: 14, geo925: null,
    });
  });

  it('leaves out what is impossible, and a row with nothing or a bad time', () => {
    expect(aemetAuxRow(obs({ ts: 300 }))?.groundTemp).toBeNull();
    expect(aemetAuxRow({ idema: 'X', fint: '2026-11-02T10:00:00+0000' } as unknown as AemetRawObservation)).toBeNull();
    expect(aemetAuxRow(obs({ fint: 'no' }))).toBeNull();
  });
});

describe('aemetAuxInsertParts', () => {
  it('lines up placeholders, values and the 10 columns', () => {
    const { tuples, values } = aemetAuxInsertParts([aemetAuxRow(obs())!, aemetAuxRow(obs({ idema: '1428' }))!]);
    expect(tuples[0]).toBe('($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)');
    expect(tuples[1].startsWith('($11,')).toBe(true);
    expect(values).toHaveLength(20);
  });
});

describe('archiveAemetAux', () => {
  it('keeps only the stations we follow, with parameters', async () => {
    query.mockResolvedValue({ rowCount: 1 });
    await archiveAemetAux([obs(), obs({ idema: '9999' })], new Set(['aemet_1690A']));
    const [sql, values] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO aemet_aux/);
    expect(sql).toMatch(/ON CONFLICT \(station_id, time\) DO NOTHING/);
    expect(sql.match(/\(time,[^)]*\)/)![0].split(',')).toHaveLength(10);
    expect(values).toHaveLength(10);
  });

  it('a missing table stops it, any other failure does not, and it never throws', async () => {
    query.mockRejectedValueOnce(new Error('reset')).mockResolvedValue({ rowCount: 1 });
    await expect(archiveAemetAux([obs()], new Set(['aemet_1690A']))).resolves.toBeUndefined();
    await archiveAemetAux([obs()], new Set(['aemet_1690A']));
    expect(query).toHaveBeenCalledTimes(2);
    query.mockReset();
    query.mockRejectedValue(Object.assign(new Error('no table'), { code: '42P01' }));
    await archiveAemetAux([obs()], new Set(['aemet_1690A']));
    await archiveAemetAux([obs()], new Set(['aemet_1690A']));
    expect(query).toHaveBeenCalledTimes(1);
  });
});
