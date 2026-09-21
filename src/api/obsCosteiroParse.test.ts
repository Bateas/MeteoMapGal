import { describe, it, expect } from 'vitest';
import { readObsCurrent, OBS_MAX_FIELD_SKEW_MS, type ObsParametro } from './obsCosteiroParse';
import fixture from './observatorioCosteiro.fixture.json';

// Real /ultimo/recente payloads of 2026-09-20/21, in upstream order: every
// window (10Minutal, Horario, Diario, Mensual) and every sensor height kept.
type Id = keyof typeof fixture;
const real = (id: Id): ObsParametro[] => JSON.parse(JSON.stringify(fixture[id])) as ObsParametro[];

const tenMin = (p: ObsParametro) => p.medicions[0].tipoIntervalo === '10Minutal';
const find = (ps: ObsParametro[], code: string, func: string, altura?: number) =>
  ps.find((p) => tenMin(p) && p.codigoParametro === code && p.funcion === func
    && (altura === undefined || p.medicions[0].altura === altura))!;
const entry = (code: string, func: string, data: string, valor: number, altura?: number, tipo = '10Minutal', codigoValidacion?: number): ObsParametro =>
  ({ codigoParametro: code, funcion: func, medicions: [{ data, valor, altura, tipoIntervalo: tipo, codigoValidacion }] });
const SLOT = '2026-09-21T22:50:00Z'; // Cortegada's 10-minute slot in the fixture
const minutesBefore = (iso: string, min: number) => new Date(Date.parse(iso) - min * 60_000).toISOString();

describe('readObsCurrent — real payloads', () => {
  it('Cortegada: the 10-minute values, although the hourly means are listed first', () => {
    const r = readObsCurrent(real('15001'))!;
    expect(r.time).toBe('2026-09-21T22:50:00Z');
    expect([r.windSpeed, r.windDir, r.windGust]).toEqual([3.83, 60, 5.2]); // hourly 7.84 / 55
    expect([r.airTemp, r.humidity, r.dewPoint]).toEqual([21.01, 55, 11.62]); // hourly air 23.39
    expect([r.waterTemp, r.salinity]).toEqual([15.778, 34.758]); // 1 m, not 3 m
  });

  it('A Guarda: the running daily mean is not the wind', () => {
    const r = readObsCurrent(real('15004'))!;
    expect([r.windSpeed, r.windDir, r.windGust]).toEqual([1.38, 83, 3.61]); // daily 6.4
    expect(r.airTemp).toBe(21.31);
  });

  it('Ribeira: already 10-minute first, unchanged', () => {
    const r = readObsCurrent(real('15005'))!;
    expect([r.windSpeed, r.windDir, r.airTemp, r.waterTemp]).toEqual([2.57, 21, 21.48, 17.324]);
  });

  it('Muros: a monthly -9999 listed first does not blank the wind speed', () => {
    const r = readObsCurrent(real('15009'))!;
    expect([r.windSpeed, r.windDir, r.windGust]).toEqual([1.86, 34, 2.71]);
  });

  it('Rande: the 1.5 m surface sensor, not 5.5 m or 14 m; no anemometer', () => {
    const r = readObsCurrent(real('15100'))!;
    expect(r.time).toBe('2026-09-20T19:40:00Z');
    expect([r.waterTemp, r.salinity]).toEqual([17.455, 35.325]); // 5.5 m daily mean is 14.01
    expect([r.windSpeed, r.windDir, r.windGust]).toEqual([null, null, null]);
  });

  it('Rande depth choice does not depend on the order of the entries', () => {
    expect(readObsCurrent(real('15100').reverse())!.waterTemp).toBe(17.455);
  });

  it('wind direction is the AVG entry, not the CONDICION or SD listed before it', () => {
    const ps = real('15001');
    // Live Cortegada lists DV/CONDICION and VV/SD 10-minute entries before the AVG ones
    ps.unshift(entry('DV', 'CONDICION', SLOT, 68, -5), entry('DV', 'SD', SLOT, 8, -5), entry('VV', 'SD', SLOT, 0.4, -5));
    const r = readObsCurrent(ps)!;
    expect([r.windDir, r.windSpeed]).toEqual([60, 3.83]);
  });
});

describe('readObsCurrent — the Xunta quality code', () => {
  // 22-sep 23:40Z, live: the 1 m sensor sent 8.313 C and 43.903 with code 4
  // while the 3 m one read 15.11 C and 35.122 with code 1.
  const flagged = () => {
    const ps = real('15001').filter((p) => !['TAU', 'SAL'].includes(p.codigoParametro) || !tenMin(p));
    ps.unshift(
      entry('TAU', 'AVG', SLOT, 8.313, 1, '10Minutal', 4),
      entry('SAL', 'AVG', SLOT, 43.903, 1, '10Minutal', 4),
      entry('TAU', 'AVG', SLOT, 15.11, 3, '10Minutal', 1),
      entry('SAL', 'AVG', SLOT, 35.122, 3, '10Minutal', 1),
    );
    return ps;
  };

  it('does not return a value the platform itself marks as bad', () => {
    const r = readObsCurrent(flagged())!;
    expect(r.waterTemp).toBeNull(); // the only valid sensor is at 3 m, below the surface window
    expect(r.salinity).toBeNull();
    expect(r.windSpeed).toBe(3.83); // the rest of the row stands
  });

  it('a rejected value does not end the search: a valid shallow sensor behind it is read', () => {
    const ps = flagged();
    ps.push(entry('TAU', 'AVG', SLOT, 15.6, 1.5, '10Minutal', 1));
    expect(readObsCurrent(ps)!.waterTemp).toBe(15.6);
  });

  it('rejects codes 3 and 9 too, and accepts 1', () => {
    const cases: [number, number | null][] = [[3, null], [9, null], [1, 3.83]];
    for (const [code, expected] of cases) {
      const ps = real('15001');
      find(ps, 'VV', 'AVG').medicions[0].codigoValidacion = code;
      expect(readObsCurrent(ps)!.windSpeed).toBe(expected);
    }
  });
});

describe('readObsCurrent — sensor height', () => {
  it('ignores an entry stated below the surface for an atmospheric field', () => {
    const ps = real('15001');
    ps.unshift(entry('VV', 'AVG', '2026-09-21T22:50:00Z', 99, 1.5));
    expect(readObsCurrent(ps)!.windSpeed).toBe(3.83);
  });

  it('returns no wind when the only 10-minute wind is stated below the surface', () => {
    const ps = real('15001');
    find(ps, 'VV', 'AVG').medicions[0].altura = 2;
    expect(readObsCurrent(ps)!.windSpeed).toBeNull();
  });

  it('ignores an entry stated above the surface for water temperature', () => {
    const ps = real('15001');
    ps.unshift(entry('TAU', 'AVG', '2026-09-21T22:50:00Z', 30, -5));
    expect(readObsCurrent(ps)!.waterTemp).toBe(15.778);
  });

  it('does not take a sensor deeper than 2 m as the surface', () => {
    const ps = real('15001').filter((p) => !(p.codigoParametro === 'TAU' && p.medicions[0].altura === 1));
    expect(readObsCurrent(ps)!.waterTemp).toBeNull(); // only the 3 m sensor is left
  });

  it('skips a -9999 on the shallowest sensor and takes the next one inside the window', () => {
    const ps = real('15001');
    ps.unshift(entry('TAU', 'AVG', '2026-09-21T22:50:00Z', -9999, 0.5));
    expect(readObsCurrent(ps)!.waterTemp).toBe(15.778);
  });

  it('picks the shallowest of two in-range sensors in either order', () => {
    for (const shallowFirst of [true, false]) {
      const ps = real('15001').filter((p) => !(p.codigoParametro === 'TAU' && tenMin(p)));
      const pair = [entry('TAU', 'AVG', SLOT, 15.9, 0.5), entry('TAU', 'AVG', SLOT, 15.2, 1.8)];
      ps.push(...(shallowFirst ? pair : pair.reverse()));
      expect(readObsCurrent(ps)!.waterTemp).toBe(15.9);
    }
  });

  it('accepts a sensor at exactly 2 m and refuses one just below it', () => {
    const base = () => real('15001').filter((p) => !(p.codigoParametro === 'TAU' && tenMin(p)));
    const at2 = base();
    at2.push(entry('TAU', 'AVG', SLOT, 15.4, 2));
    expect(readObsCurrent(at2)!.waterTemp).toBe(15.4);
    const below = base();
    below.push(entry('TAU', 'AVG', SLOT, 15.4, 2.01));
    expect(readObsCurrent(below)!.waterTemp).toBeNull();
  });

  it('accepts an atmospheric entry that states no height, and refuses one at the surface', () => {
    const noHeight = real('15001');
    delete find(noHeight, 'VV', 'AVG').medicions[0].altura;
    expect(readObsCurrent(noHeight)!.windSpeed).toBe(3.83);
    const atSurface = real('15001');
    find(atSurface, 'VV', 'AVG').medicions[0].altura = 0;
    expect(readObsCurrent(atSurface)!.windSpeed).toBeNull();
  });

  it('accepts a sensor exactly at the surface', () => {
    const ps = real('15001');
    ps.push(entry('TAU', 'AVG', '2026-09-21T22:50:00Z', 15.9, 0));
    expect(readObsCurrent(ps)!.waterTemp).toBe(15.9);
  });
});

describe('readObsCurrent — time', () => {
  it('drops a field whose 10-minute series lags the row by an hour', () => {
    const ps = real('15001');
    find(ps, 'VV', 'AVG').medicions[0].data = minutesBefore('2026-09-21T22:50:00Z', 60);
    const r = readObsCurrent(ps)!;
    expect(r.time).toBe('2026-09-21T22:50:00Z');
    expect(r.windSpeed).toBeNull();
    expect(r.windDir).toBe(60); // the others are untouched
  });

  it('keeps a field one slot behind the rest', () => {
    const ps = real('15001');
    find(ps, 'VV', 'AVG').medicions[0].data = minutesBefore('2026-09-21T22:50:00Z', 10);
    expect(readObsCurrent(ps)!.windSpeed).toBe(3.83);
    expect(OBS_MAX_FIELD_SKEW_MS).toBeGreaterThanOrEqual(10 * 60_000);
  });

  it('keeps a field exactly 20 minutes behind, drops one 21 minutes behind', () => {
    const kept = real('15001');
    find(kept, 'VV', 'AVG').medicions[0].data = minutesBefore(SLOT, 20);
    expect(readObsCurrent(kept)!.windSpeed).toBe(3.83);
    const dropped = real('15001');
    find(dropped, 'VV', 'AVG').medicions[0].data = minutesBefore(SLOT, 21);
    expect(readObsCurrent(dropped)!.windSpeed).toBeNull();
  });

  it('the row time is the NEWEST 10-minute reading, not the first one listed', () => {
    const ps = real('15001');
    const first = ps.find(tenMin)!; // TAU 1 m in the fixture
    first.medicions[0].data = minutesBefore(SLOT, 10);
    expect(readObsCurrent(ps)!.time).toBe(SLOT);
  });

  it('a parameter it does not read never sets the row time', () => {
    const ps = real('15001');
    ps.unshift(entry('VC', 'AVG', '2026-09-22T00:50:00Z', 0.3, 4)); // current profiler, two hours ahead
    const r = readObsCurrent(ps)!;
    expect(r.time).toBe(SLOT);
    expect(r.windSpeed).toBe(3.83);
  });

  it('is null when every field it reads is missing, so it cannot blank a merged row', () => {
    const ps = real('15001').map((p) => {
      if (tenMin(p)) p.medicions[0].valor = -9999;
      return p;
    });
    ps.push(entry('VC', 'AVG', SLOT, 0.3, 4));
    expect(readObsCurrent(ps)).toBeNull();
  });

  it('falls back to a 10-minute MAX when there is no RACHA', () => {
    const ps = real('15001').filter((p) => p.funcion !== 'RACHA');
    ps.push(entry('VV', 'MAX', SLOT, 6.1, -5));
    expect(readObsCurrent(ps)!.windGust).toBe(6.1);
  });

  it('never takes the row time from an hourly, daily or monthly entry', () => {
    const ps = real('15001');
    ps.unshift(entry('VV', 'AVG', '2026-09-22T12:00:00Z', 7.84, -5, 'Horario'));
    expect(readObsCurrent(ps)!.time).toBe('2026-09-21T22:50:00Z');
  });

  it('is null when the payload has no 10-minute reading at all', () => {
    const aggregatesOnly = real('15001').filter((p) => !tenMin(p));
    expect(readObsCurrent(aggregatesOnly)).toBeNull();
  });
});

describe('readObsCurrent — payload shape', () => {
  it('accepts the wrapped form', () => {
    expect(readObsCurrent({ parametros: real('15005') })!.windSpeed).toBe(2.57);
  });

  it('is null for empty or missing payloads', () => {
    expect(readObsCurrent([])).toBeNull();
    expect(readObsCurrent({})).toBeNull();
    expect(readObsCurrent(null)).toBeNull();
  });
});
