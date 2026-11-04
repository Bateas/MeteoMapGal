import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
vi.mock('./db.js', () => ({ getPool: () => ({ query }) }));
vi.mock('./logger.js', () => ({ log: { info: vi.fn(), warn: vi.fn() } }));

import {
  MG_HOURLY_PARAMS,
  mgHourlyDue,
  mgHourlyHoursToAsk,
  mgHourlyInsertParts,
  mgHourlyUrl,
  parseMgHourly,
  runMgHourlyArchive,
  __resetMgHourlyForTests,
} from './mgHourlyArchive';

const NOW = Date.UTC(2026, 10, 4, 4, 0);
const HOUR = 3_600_000;

const medida = (codigoParametro: string, valor: number, lnCodigoValidacion = 1) => ({ codigoParametro, valor, lnCodigoValidacion });
const answer = (idEstacion: number, ...listaInstantes: unknown[]) => ({ listHorarios: [{ idEstacion, estacion: 'X', listaInstantes }] });

describe('parseMgHourly', () => {
  it('maps the published codes to columns, with the station id as in readings', () => {
    const { rows } = parseMgHourly(answer(14005, {
      instanteLecturaUTC: '2026-11-03T08:00:00',
      listaMedidas: [medida('VV_RACHA_10m', 8.52), medida('DV_AVG_10m', 78), medida('TA_AVG_1.5m', 10.11)],
    }), NOW);
    expect(rows).toEqual([{
      time: '2026-11-03T08:00:00.000Z',
      stationId: 'mg_14005',
      values: { wind_gust: 8.52, wind_dir: 78, temp: 10.11 },
      flags: null,
    }]);
  });

  it('-9999 is no value, and a row with nothing left is not stored', () => {
    const { rows } = parseMgHourly(answer(1, {
      instanteLecturaUTC: '2026-11-03T08:00:00', listaMedidas: [medida('VV_RACHA_10m', -9999, 9)],
    }), NOW);
    expect(rows).toEqual([]);
  });

  it('keeps a suspect value next to its code', () => {
    const { rows } = parseMgHourly(answer(1, {
      instanteLecturaUTC: '2026-11-03T08:00:00',
      listaMedidas: [medida('PP_SUM_1.5m', 40, 2), medida('TA_AVG_1.5m', 11)],
    }), NOW);
    expect(rows[0].values).toEqual({ precip: 40, temp: 11 });
    expect(rows[0].flags).toEqual({ 'PP_SUM_1.5m': 2 });
  });

  it('a station stamping hours ahead of now (O Fieitoso, 12 days on 3-nov) leaves them out', () => {
    const { rows, futureHours } = parseMgHourly(answer(10178,
      { instanteLecturaUTC: '2026-11-15T01:00:00', listaMedidas: [medida('TA_AVG_1.5m', 9)] },
      { instanteLecturaUTC: '2026-11-04T03:00:00', listaMedidas: [medida('TA_AVG_1.5m', 9)] },
    ), NOW);
    expect(futureHours).toBe(1);
    expect(rows.map((r) => r.time)).toEqual(['2026-11-04T03:00:00.000Z']);
  });

  it('the same hour twice is one row: an upsert cannot touch a row twice', () => {
    const instant = { instanteLecturaUTC: '2026-11-03T08:00:00', listaMedidas: [medida('TA_AVG_1.5m', 9)] };
    expect(parseMgHourly(answer(1, instant, instant), NOW).rows).toHaveLength(1);
  });

  it('an answer without the list gives nothing', () => {
    expect(parseMgHourly(null, NOW).rows).toEqual([]);
    expect(parseMgHourly({ error: 'x' }, NOW).rows).toEqual([]);
  });
});

describe('how much and when', () => {
  it('asks by name, all stations in one request, mean wind included', () => {
    const url = mgHourlyUrl(26);
    expect(url).toContain('ultimosHorariosEstacions.action?numHoras=26&idParam=');
    expect(url).toContain('VV_AVG_10m');
    expect(url).not.toContain('idEst=');
  });

  it('a normal night asks a bit over a day, a missed one fills itself in, and it is capped', () => {
    expect(mgHourlyHoursToAsk(NOW - 24 * HOUR, NOW)).toBe(26);
    expect(mgHourlyHoursToAsk(NOW - 48 * HOUR, NOW)).toBe(50);
    expect(mgHourlyHoursToAsk(NOW - 900 * HOUR, NOW)).toBe(72);
  });

  it('an empty table asks all the service gives', () => {
    expect(mgHourlyHoursToAsk(null, NOW)).toBe(72);
  });

  it('a restart by day does not launch it, not even the first run', () => {
    expect(mgHourlyDue(null, Date.UTC(2026, 10, 3, 18, 30))).toBe(false);
    expect(mgHourlyDue(NOW - 30 * HOUR, Date.UTC(2026, 10, 4, 7, 0))).toBe(false);
  });

  it('due once a night, from 03 UTC', () => {
    expect(mgHourlyDue(NOW - 24 * HOUR, Date.UTC(2026, 10, 4, 2, 59))).toBe(false);
    expect(mgHourlyDue(NOW - 24 * HOUR, NOW)).toBe(true);
    expect(mgHourlyDue(NOW - 2 * HOUR, NOW)).toBe(false);
    expect(mgHourlyDue(null, NOW)).toBe(true);
  });
});

describe('mgHourlyInsertParts', () => {
  it('one tuple per row, every column in place, flags as JSON', () => {
    const width = Object.keys(MG_HOURLY_PARAMS).length + 3;
    const { tuples, values } = mgHourlyInsertParts([
      { time: 't1', stationId: 'mg_1', values: { temp: 9 }, flags: { 'TA_AVG_1.5m': 2 } },
      { time: 't2', stationId: 'mg_2', values: {}, flags: null },
    ]);
    expect(tuples).toHaveLength(2);
    expect(values).toHaveLength(width * 2);
    expect(tuples[1].startsWith(`($${width + 1},`)).toBe(true);
    expect(values[width - 1]).toBe('{"TA_AVG_1.5m":2}');
    expect(values[width * 2 - 1]).toBeNull();
  });
});

describe('runMgHourlyArchive', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    __resetMgHourlyForTests();
    query.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  const ok = () => ({ ok: true, json: async () => answer(1, { instanteLecturaUTC: '2026-11-04T03:00:00', listaMedidas: [medida('TA_AVG_1.5m', 9)] }) });

  it('does not ask when tonight is already stored', async () => {
    query.mockResolvedValueOnce({ rows: [{ last: new Date(NOW - 2 * HOUR) }] });
    await runMgHourlyArchive(NOW);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks once and writes, never emptying what a later answer lacks', async () => {
    query.mockResolvedValueOnce({ rows: [{ last: new Date(NOW - 24 * HOUR) }] }).mockResolvedValueOnce({ rowCount: 1 });
    fetchMock.mockResolvedValueOnce(ok());
    await runMgHourlyArchive(NOW);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[1][0]).toContain('wind_avg = COALESCE(EXCLUDED.wind_avg, mg_hourly.wind_avg)');
  });

  it('gives up for the day after 3 failures: no hammering a service that is down', async () => {
    query.mockResolvedValue({ rows: [{ last: new Date(NOW - 24 * HOUR) }] });
    fetchMock.mockRejectedValue(new Error('down'));
    for (let i = 0; i < 5; i++) await runMgHourlyArchive(NOW);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('a missing table stops the archive and asks nothing', async () => {
    query.mockRejectedValueOnce(Object.assign(new Error('no table'), { code: '42P01' }));
    await runMgHourlyArchive(NOW);
    await runMgHourlyArchive(NOW);
    expect(query).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
