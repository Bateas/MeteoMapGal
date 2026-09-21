import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseObsResponse } from './buoyFetcher.js';
import { parseObsReading } from '../src/api/observatorioCosteiro';
import fixture from '../src/api/observatorioCosteiro.fixture.json';

// Real /ultimo/recente payloads of 2026-09-21 (about 23:00 UTC), trimmed to
// the parameters the parser reads. Every window (10Minutal, Horario, Diario,
// Mensual) and every depth is kept, in upstream order: that order is the trap.
type Payload = Parameters<typeof parseObsResponse>[1];
const payload = (id: keyof typeof fixture): Payload => fixture[id] as unknown as Payload;

const CORTEGADA = { obsId: 15001, canonicalId: 1250, name: 'Cortegada (Arousa)' };
const A_GUARDA = { obsId: 15004, canonicalId: 1253, name: 'A Guarda' };
const RIBEIRA = { obsId: 15005, canonicalId: 1255, name: 'Ribeira' };
const RANDE = { obsId: 15100, canonicalId: 1251, name: 'Rande (Ría Vigo)' };
const MUROS = { obsId: 15009, canonicalId: 15009, name: 'Muros' };

function at(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

describe('parseObsResponse — 10-minute readings only', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('Cortegada: wind, direction, air temp and humidity are the 10-minute values, not the hourly mean', () => {
    at('2026-09-21T23:00:00Z');
    const r = parseObsResponse(CORTEGADA, payload('15001'))!;
    expect(r.time).toBe('2026-09-21T22:50:00Z');
    expect(r.windSpeed).toBe(3.83);   // the hourly mean listed first is 7.84
    expect(r.windDir).toBe(60);       // hourly 55
    expect(r.windGust).toBe(5.2);
    expect(r.airTemp).toBe(21.01);    // hourly 23.39
    expect(r.humidity).toBe(55);      // hourly 57
    expect(r.dewPoint).toBe(11.62);
    expect(r.waterTemp).toBe(15.778); // 1 m sensor, the shallowest
    expect(r.salinity).toBe(34.758);
  });

  it('A Guarda: the running daily mean is not stored as the wind', () => {
    at('2026-09-21T23:00:00Z');
    const r = parseObsResponse(A_GUARDA, payload('15004'))!;
    expect(r.windSpeed).toBe(1.38);   // daily mean listed first is 6.4
    expect(r.windDir).toBe(83);       // hourly 96
    expect(r.windGust).toBe(3.61);
    // A gust below the mean wind is physically impossible: the old row had 6.48 vs 1.68.
    expect(r.windGust!).toBeGreaterThanOrEqual(r.windSpeed!);
    expect(r.humidity).toBe(50);      // daily 57
    expect(r.dewPoint).toBe(10.45);   // daily 12.01
    expect(r.airTemp).toBe(21.31);
    expect(r.waterTemp).toBe(13.962);
    expect(r.salinity).toBe(34.853);
  });

  it('Muros: a monthly -9999 listed first does not blank the field', () => {
    at('2026-09-21T23:00:00Z');
    const r = parseObsResponse(MUROS, payload('15009'))!;
    expect(r.windSpeed).toBe(1.86);
    expect(r.windDir).toBe(34);       // hourly 56
    expect(r.windGust).toBe(2.71);
    expect(r.airTemp).toBe(19.88);
    expect(r.humidity).toBe(56);
    expect(r.dewPoint).toBe(10.92);
    expect(r.waterTemp).toBe(17.434);
    expect(r.salinity).toBe(35.233);
  });

  it('Ribeira: already 10-minute in every field, unchanged', () => {
    at('2026-09-21T23:00:00Z');
    const r = parseObsResponse(RIBEIRA, payload('15005'))!;
    expect([r.windSpeed, r.windDir, r.windGust]).toEqual([2.57, 21, 3.14]);
    expect([r.airTemp, r.humidity, r.dewPoint]).toEqual([21.48, 57, 12.53]);
    expect([r.waterTemp, r.salinity]).toEqual([17.324, 35.189]);
  });

  it('Rande: surface water sensor, not the 5.5 m daily mean; salinity is read; no anemometer', () => {
    at('2026-09-20T19:50:00Z');
    const r = parseObsResponse(RANDE, payload('15100'))!;
    expect(r.time).toBe('2026-09-20T19:40:00Z');
    expect(r.waterTemp).toBe(17.455); // the 5.5 m daily mean listed first is 14.01
    expect(r.salinity).toBe(35.325);  // a monthly -9999 was listed first
    expect([r.airTemp, r.humidity, r.dewPoint]).toEqual([21.39, 65, 14.48]);
    expect([r.windSpeed, r.windDir, r.windGust]).toEqual([null, null, null]);
  });

  it('Rande a day later: its 10-minute series stopped, so the row is stale and dropped', () => {
    at('2026-09-21T23:00:00Z');
    expect(parseObsResponse(RANDE, payload('15100'))).toBeNull();
  });

  it('a field whose 10-minute series lags the rest by an hour is not stored with the row time', () => {
    at('2026-09-21T23:00:00Z');
    type Entry = { codigoParametro: string; funcion: string; medicions: { tipoIntervalo: string; data: string }[] };
    const ps = JSON.parse(JSON.stringify(fixture['15001'])) as Entry[];
    const vv = ps.find((p) => p.codigoParametro === 'VV' && p.funcion === 'AVG' && p.medicions[0].tipoIntervalo === '10Minutal')!;
    vv.medicions[0].data = '2026-09-21T21:50:00Z';
    const r = parseObsResponse(CORTEGADA, ps as unknown as Payload)!;
    expect(r.time).toBe('2026-09-21T22:50:00Z');
    expect(r.windSpeed).toBeNull();
    expect(r.windDir).toBe(60);
  });

  it('heights decide the layer: a sub-surface entry is not the wind, an above-surface one is not the water', () => {
    at('2026-09-21T23:00:00Z');
    const bogus = [
      { codigoParametro: 'VV', funcion: 'AVG', medicions: [{ data: '2026-09-21T22:50:00Z', valor: 99, altura: 1, tipoIntervalo: '10Minutal' }] },
      { codigoParametro: 'TAU', funcion: 'AVG', medicions: [{ data: '2026-09-21T22:50:00Z', valor: 30, altura: -5, tipoIntervalo: '10Minutal' }] },
    ];
    const r = parseObsResponse(CORTEGADA, [...bogus, ...(fixture['15001'] as unknown[])] as unknown as Payload)!;
    expect(r.windSpeed).toBe(3.83);
    expect(r.waterTemp).toBe(15.778);
  });

  it('a value the Xunta marks as bad is not stored (Cortegada 1 m sensor, 8.3 C with code 4)', () => {
    at('2026-09-21T23:00:00Z');
    type Entry = { codigoParametro: string; funcion: string; medicions: { tipoIntervalo: string; codigoValidacion?: number; valor: number; altura: number }[] };
    const ps = JSON.parse(JSON.stringify(fixture['15001'])) as Entry[];
    const tau1 = ps.find((p) => p.codigoParametro === 'TAU' && p.medicions[0].tipoIntervalo === '10Minutal' && p.medicions[0].altura === 1)!;
    tau1.medicions[0].valor = 8.313;
    tau1.medicions[0].codigoValidacion = 4;
    const r = parseObsResponse(CORTEGADA, ps as unknown as Payload)!;
    expect(r.waterTemp).toBeNull(); // the 3 m sensor is below the surface window
    expect(r.windSpeed).toBe(3.83);
  });

  it('the ingestor row and the map reading agree field by field on every real payload', () => {
    const cases = [
      ['15001', CORTEGADA, '2026-09-21T23:00:00Z'],
      ['15004', A_GUARDA, '2026-09-21T23:00:00Z'],
      ['15005', RIBEIRA, '2026-09-21T23:00:00Z'],
      ['15009', MUROS, '2026-09-21T23:00:00Z'],
      ['15100', RANDE, '2026-09-20T19:50:00Z'],
    ] as const;
    for (const [id, st, now] of cases) {
      at(now);
      const row = parseObsResponse(st, payload(id))!;
      const map = parseObsReading({ ...st, lat: 0, lon: 0 }, payload(id) as never)!;
      expect([row.time, row.windSpeed, row.windDir, row.windGust, row.airTemp, row.humidity, row.dewPoint, row.waterTemp, row.salinity])
        .toEqual([map.timestamp, map.windSpeed, map.windDir, map.windGust, map.airTemp, map.humidity, map.dewPoint, map.waterTemp, map.salinity]);
    }
  });

  it('without a 10-minute gust there is no gust: an hourly or daily maximum is not a current gust', () => {
    at('2026-09-21T23:00:00Z');
    const noRacha = (payload('15001') as { funcion: string }[]).filter((p) => p.funcion !== 'RACHA') as unknown as Payload;
    expect(parseObsResponse(CORTEGADA, noRacha)!.windGust).toBeNull(); // hourly MAX is 10.27
  });
});
