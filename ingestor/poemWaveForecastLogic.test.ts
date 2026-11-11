import { describe, expect, it } from 'vitest';
import { chunk, forecastInsertParts, forecastRows, meshPoints, meshRuns } from './poemWaveForecastLogic';

describe('poemWaveForecastLogic', () => {
  it('reads the last run of each mesh', () => {
    const runs = meshRuns([{ malla: 'S22', fecha_ejec: 1794325500, nombre: 'SAPO Vigo' }, { malla: 'X', fecha_ejec: null }]);
    expect([...runs]).toEqual([['S22', 1794325500]]);
    expect(meshRuns({ error: 'x' }).size).toBe(0);
  });

  it('trims the mesh points and drops the ones without position', () => {
    const pts = meshPoints([
      { codigo: 3013013, tipo: 'POI      ', malla: 'RBAI', latitud: 42.5, longitud: -8.9 },
      { codigo: 1, malla: 'RBAI', latitud: null, longitud: -8.9 },
    ]);
    expect(pts).toEqual([{ code: 3013013, mesh: 'RBAI', lat: 42.5, lon: -8.9, kind: 'POI' }]);
  });

  it('keeps the values as sent and stamps the run of the mesh', () => {
    const rows = forecastRows(
      [
        { codigo: 3011018, fecha: 1794315600, mt_hm0: 211, mt_tp: 1330, mt_tm02: 550, mt_dmd: 217, mf1_hm0: 121, mv_hm0: null, vv_imd: 1012, vv_dmd: 180 },
        { codigo: 999, fecha: 1794315600, mt_hm0: 1 },
        { codigo: 3011018, fecha: null },
      ],
      new Map([[3011018, 'RBAI']]),
      new Map([['RBAI', 1794324660]]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].mtHm0).toBe(211);
    expect(rows[0].mvHm0).toBeNull();
    expect(rows[0].runTime.toISOString()).toBe('2026-11-10T15:31:00.000Z');
    expect(rows[0].time.toISOString()).toBe('2026-11-10T13:00:00.000Z');
    const { tuples, values } = forecastInsertParts(rows);
    expect(tuples).toEqual(['($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)']);
    expect(values).toHaveLength(12);
  });

  it('splits a list in groups', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
