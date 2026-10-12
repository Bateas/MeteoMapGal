import { describe, it, expect } from 'vitest';
import { latestObservationUrls, indexLatestById, MG_IDS_PER_REQUEST } from './mgLatestBatch';

const BASE = 'https://servizos.meteogalicia.gal';
const entry = (id: number, t: string, n = 3) => ({
  estacion: `E${id}`,
  idEstacion: id,
  instanteLecturaUTC: t,
  listaMedidas: Array.from({ length: n }, () => ({ codigoParametro: 'VV_AVG_10m', valor: 1 })),
});

describe('latestObservationUrls', () => {
  it('asks for every station in one request', () => {
    const urls = latestObservationUrls(BASE, [14001, 10124, 10905]);
    expect(urls).toEqual([`${BASE}/mgrss/observacion/ultimos10minEstacionsMeteo.action?idEst=10124,10905,14001`]);
  });

  it('gives the same url for the same set, in any order and with repeats', () => {
    expect(latestObservationUrls(BASE, [3, 1, 2, 2])).toEqual(latestObservationUrls(BASE, [2, 3, 1]));
  });

  it('drops ids that are not positive integers', () => {
    const [url] = latestObservationUrls(BASE, [NaN, -1, 0, 1.5, 7]);
    expect(url.endsWith('idEst=7')).toBe(true);
  });

  it('splits only past the cap', () => {
    const ids = Array.from({ length: MG_IDS_PER_REQUEST + 1 }, (_, i) => 10000 + i);
    const urls = latestObservationUrls(BASE, ids);
    expect(urls).toHaveLength(2);
    expect(urls[1].endsWith(`idEst=${10000 + MG_IDS_PER_REQUEST}`)).toBe(true);
    expect(latestObservationUrls(BASE, ids.slice(0, 50))).toHaveLength(1);
  });

  it('asks for nothing when there are no stations', () => {
    expect(latestObservationUrls(BASE, [])).toEqual([]);
  });
});

describe('indexLatestById', () => {
  it('indexes the answer by station id (shape of a real 3-station answer, 12-oct)', () => {
    const body = { listUltimos10min: [entry(10124, '2026-10-12T20:50:00'), entry(10905, '2026-10-12T20:50:00'), entry(14001, '2026-10-12T20:50:00')] };
    const byId = indexLatestById(body);
    expect([...byId.keys()].sort()).toEqual([10124, 10905, 14001]);
    expect(byId.get(14001)?.estacion).toBe('E14001');
  });

  it('keeps the newest entry when a station appears twice', () => {
    const body = { listUltimos10min: [entry(1, '2026-10-12T20:40:00'), entry(1, '2026-10-12T20:50:00'), entry(1, '2026-10-12T20:30:00')] };
    expect(indexLatestById(body).get(1)?.instanteLecturaUTC).toBe('2026-10-12T20:50:00');
  });

  it('drops entries without an id or without measures', () => {
    const body = { listUltimos10min: [{ estacion: 'x', listaMedidas: [] }, { idEstacion: 5, estacion: 'y' }, null, entry(6, '2026-10-12T20:50:00')] };
    expect([...indexLatestById(body).keys()]).toEqual([6]);
  });

  it('returns nothing for an answer that is not the expected shape', () => {
    expect(indexLatestById(null).size).toBe(0);
    expect(indexLatestById({}).size).toBe(0);
    expect(indexLatestById({ listUltimos10min: 'error' }).size).toBe(0);
  });
});
