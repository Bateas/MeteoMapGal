/**
 * With a POEM token, Puertos del Estado is read ONLY through POEM (they asked
 * on 1-oct-2026 that third parties stop using PORTUSSRV). Pins that PORTUSSRV
 * is never asked, what POEM is asked, and that a rejected token costs one
 * request per cycle, not one per station.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as { path: string; params: Record<string, string> }[],
  rejectData: 0 as number,
}));

vi.mock('./poemClient.js', () => {
  class PoemHttpError extends Error {
    constructor(public readonly status: number, path: string) { super(`POEM ${path}: HTTP ${status}`); }
  }
  const META: Record<string, [string, [number, number, string][]]> = {
    REDMAR: ['mareas.redmar_mir_tr', [[27, 1000, 'nivel'], [1, 100, 'vv_md'], [2, 1, 'dv_md'], [3, 100, 'vv_mx']]],
    REDEXT: ['boyas.redext_tr', [[13, 100, 'hm0'], [34, 100, 'tp'], [50, 100, 'ts1'], [1, 100, 'vv_md'], [2, 1, 'dv_md']]],
    REMPOR: ['meteoro.rempor_tr', [[1, 100, 'vv_md'], [2, 1, 'dv_md'], [3, 100, 'vv_mx'], [4, 10, 'ta']]],
  };
  const typeOf = (id: number) => (id === 2248 ? 'REDEXT' : id >= 4000 ? 'REMPOR' : 'REDMAR');
  return {
    PoemHttpError,
    poemToken: () => 'header.payload.signature',
    poemGet: async (path: string, params: Record<string, string>) => {
      h.calls.push({ path, params });
      if (path === '/doris/doris/estacion_param') {
        const [table, cols] = META[typeOf(Number(params.estacion))];
        return cols.map(([param, factor, db_column]) => ({ param, factor, db_column, db_table: table }));
      }
      if (path === '/doris/doris/param') {
        return [
          { id_param: 27, descripcion: 'Nivel', unidad: 'm' }, { id_param: 1, descripcion: 'Velocidad media', unidad: 'm/s' },
          { id_param: 2, descripcion: 'Dirección media', unidad: 'º' }, { id_param: 3, descripcion: 'Velocidad máxima', unidad: 'm/s' },
          { id_param: 13, descripcion: 'Hm0', unidad: 'm' }, { id_param: 34, descripcion: 'Tp', unidad: 's' },
          { id_param: 50, descripcion: 'Temperatura del agua', unidad: 'ºC' }, { id_param: 4, descripcion: 'Temperatura del aire', unidad: 'ºC' },
        ];
      }
      if (h.rejectData > 0) throw new PoemHttpError(h.rejectData, path);
      // Limit=1 answers an object
      return { codigo: Number(params.codigo), fecha: Math.floor(Date.now() / 1000) - 600,
        nivel: 2602, vv_md: 820, dv_md: 30, vv_mx: 1100, hm0: 150, tp: 1100, ts1: 1650, ta: 160,
        qc_nivel: 1, qc_vv_md: 1, qc_dv_md: 1, qc_vv_mx: 1, qc_e: 1, qc_ts1: 1, qc_ta: 1 };
    },
  };
});

import { fetchBuoyObservations } from './buoyFetcher.js';
import { log } from './logger.js';

let fetchSpy: ReturnType<typeof vi.spyOn>;
const savedObsKey = process.env.OBSCOSTEIRO_API_KEY;

beforeEach(() => {
  h.calls.length = 0;
  h.rejectData = 0;
  delete process.env.OBSCOSTEIRO_API_KEY;
  fetchSpy = vi.spyOn(globalThis, 'fetch');
  vi.spyOn(log, 'info').mockImplementation(() => {});
  vi.spyOn(log, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedObsKey !== undefined) process.env.OBSCOSTEIRO_API_KEY = savedObsKey;
});

describe('Puertos del Estado through POEM', () => {
  it('reads the 7 stations through POEM and never asks PORTUSSRV', async () => {
    const rows = await fetchBuoyObservations();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rows.map((r) => r.stationId).sort()).toEqual([2248, 3220, 3221, 3223, 4271, 4272, 4273]);
    expect(rows.every((r) => r.source === 'portus')).toBe(true);
    const vigo = rows.find((r) => r.stationId === 3221)!;
    expect(vigo).toMatchObject({ seaLevel: 2.602, windSpeed: 8.2, windDir: 30, windGust: 11 });
    expect(rows.find((r) => r.stationId === 2248)).toMatchObject({ waveHeight: 1.5, wavePeriod: 11, waterTemp: 16.5 });

    // The CETMAR moorings come from the Xunta: never asked to Puertos del Estado.
    expect(h.calls.some((c) => ['1250', '1253', '1255', '1251'].includes(c.params.estacion ?? c.params.codigo))).toBe(false);

    // Metadata once: a request per station (POEM's default Limit is 10 rows) and one for all the units.
    const meta = h.calls.filter((c) => c.path === '/doris/doris/estacion_param');
    expect(meta).toHaveLength(7);
    expect(meta.every((c) => c.params.Limit === '500')).toBe(true);
    expect(h.calls.filter((c) => c.path === '/doris/doris/param')).toHaveLength(1);

    // The data: the latest row of each station, its columns and their quality flags.
    const vigoData = h.calls.find((c) => c.path === '/doris/mareas/redmar_mir_tr' && c.params.codigo === '3221')!;
    expect(vigoData.params).toMatchObject({ Limit: '1', OrderBy: 'fecha.desc' });
    expect(vigoData.params['fecha.ge']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);
    expect(vigoData.params.Columns.split(',')).toEqual(expect.arrayContaining(['codigo', 'fecha', 'nivel', 'qc_nivel', 'vv_mx', 'qc_vv_mx']));
  });

  it('the metadata is not asked again on the next cycle', async () => {
    await fetchBuoyObservations();
    expect(h.calls.filter((c) => c.path.startsWith('/doris/doris/'))).toHaveLength(0);
    expect(h.calls).toHaveLength(7);
  });

  it('a rejected token stops the cycle at the first request and is logged as an error', async () => {
    h.rejectData = 401;
    const error = vi.spyOn(log, 'error').mockImplementation(() => {});
    const rows = await fetchBuoyObservations();
    expect(rows).toEqual([]);
    expect(h.calls).toHaveLength(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toMatch(/POEM_TOKEN/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
