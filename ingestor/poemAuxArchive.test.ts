import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('./db.js', () => ({ getPool: () => ({ query }) }));
vi.mock('./logger.js', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), ok: vi.fn() } }));

import { archivePoemAux, poemAuxInsertParts, __resetPoemAuxForTests } from './poemAuxArchive';
import { buildStationPlan, planRequestColumns, poemAuxRows, type PoemStationPlan } from './poemLogic';

const plan = (): PoemStationPlan => buildStationPlan(
  4272,
  [
    { param: 1, factor: 100, db_column: 'vv_md', db_table: 'meteoro.rempor2_tr' },
    { param: 2, factor: 10, db_column: 'ta', db_table: 'meteoro.rempor2_tr' },
    { param: 3, factor: 10, db_column: 'vs', db_table: 'meteoro.rempor2_tr' },
    { param: 4, factor: 1, db_column: 'ir', db_table: 'meteoro.rempor2_tr' },
    { param: 5, factor: 10, db_column: 'pc', db_table: 'meteoro.rempor2_tr' },
  ],
  new Map([
    [1, { id_param: 1, unidad: 'm/s' }],
    [2, { id_param: 2, unidad: 'grados' }],
    [3, { id_param: 3, unidad: 'km' }],
    [4, { id_param: 4, unidad: 'W/m2' }],
    [5, { id_param: 5, unidad: 'mm' }],
  ]),
)!;

const row = (over: Record<string, unknown> = {}) => ({ fecha: 1793620800, vs: 35, qc_vs: 1, vs_cause: 'bruma', ir: 410, qc_ir: 2, pc: 4, qc_pc: 1, ...over });

beforeEach(() => {
  query.mockReset();
  __resetPoemAuxForTests();
});

describe('POEM aux plan and rows', () => {
  it('asks for the three columns and their flags, without changing the reading fields', () => {
    const p = plan();
    expect(p.columns.map((c) => c.column).sort()).toEqual(['ta', 'vv_md']);
    expect(p.aux.map((c) => c.column)).toEqual(['vs', 'ir', 'pc']);
    expect(planRequestColumns(p)).toEqual(expect.arrayContaining(['vs', 'qc_vs', 'vs_cause', 'ir', 'qc_ir', 'pc', 'qc_pc']));
  });

  it('divides by the factor and keeps the flag: a bad flag is stored, not dropped', () => {
    const [r] = poemAuxRows(plan(), [row({ qc_vs: 4 })]);
    expect(r).toMatchObject({
      stationId: 4272, visibility: 3.5, visibilityQc: 4, visibilityCause: 'bruma', irradiance: 410, irradianceQc: 2,
      precip: 0.4, precipQc: 1, units: 'vs=km;ir=W/m2;pc=mm',
    });
    expect(r.time.toISOString()).toBe(new Date(1793620800 * 1000).toISOString());
  });

  it('skips rows with none of them or no time, and plans without them', () => {
    expect(poemAuxRows(plan(), [{ fecha: 1793620800 }, row({ fecha: null })])).toEqual([]);
    expect(poemAuxRows({ ...plan(), aux: [] }, [row()])).toEqual([]);
  });

  it('a plan without those columns asks for what it asked before', () => {
    const p = buildStationPlan(3221, [{ param: 1, factor: 100, db_column: 'vv_md', db_table: 'mareas.redmar_mir_tr' }], new Map([[1, { id_param: 1, unidad: 'm/s' }]]))!;
    expect(p.aux).toEqual([]);
    expect(planRequestColumns(p)).not.toContain('vs_cause');
  });
});

describe('archivePoemAux', () => {
  it('lines up the 10 columns and writes with parameters', async () => {
    query.mockResolvedValue({ rowCount: 1 });
    const rows = poemAuxRows(plan(), [row()]);
    expect(poemAuxInsertParts(rows).tuples[0]).toBe('($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)');
    await archivePoemAux(rows);
    const [sql, values] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO poem_aux/);
    expect(sql).toMatch(/ON CONFLICT \(station_id, time\) DO NOTHING/);
    expect(sql.match(/\(time,[^)]*\)/)![0].split(',')).toHaveLength(10);
    expect(values).toHaveLength(10);
  });

  it('a missing table stops it, any other failure does not, and it never throws', async () => {
    const rows = poemAuxRows(plan(), [row()]);
    query.mockRejectedValueOnce(new Error('reset')).mockResolvedValue({ rowCount: 1 });
    await expect(archivePoemAux(rows)).resolves.toBeUndefined();
    await archivePoemAux(rows);
    expect(query).toHaveBeenCalledTimes(2);
    query.mockReset();
    query.mockRejectedValue(Object.assign(new Error('no table'), { code: '42P01' }));
    await archivePoemAux(rows);
    await archivePoemAux(rows);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
