import { describe, it, expect } from 'vitest';
import { parseJsonRaios } from './jsonRaiosShadow';

describe('parseJsonRaios', () => {
  it('reads the day, the counts and each strike with its UTC time (real body of 7-oct-2026)', () => {
    const body = {
      raios: [{
        data: '2026-10-07T00:00:00',
        listaRaios: [
          { fecha: '2026-10-07T01:46:13', lat: 45.127, lon: -1.4622, peakCurrent: -139 },
          { fecha: '2026-10-07T01:51:46', lat: 43.7784, lon: -6.6218, peakCurrent: -14 },
          { fecha: 'mal', lat: 43, lon: -8, peakCurrent: 5 },
        ],
        numRaiosGalicia: 0,
        numRaiosTotal: 3,
      }],
    };
    const d = parseJsonRaios(body);
    expect(d).toMatchObject({ day: '2026-10-07', total: 3, galicia: 0 });
    expect(d.strikes).toHaveLength(2);
    expect(d.strikes[1].time.toISOString()).toBe('2026-10-07T01:51:46.000Z');
    expect(d.strikes[1]).toMatchObject({ lat: 43.7784, lon: -6.6218, peakCurrent: -14 });
  });

  it('an empty or odd body is an empty day, never a throw', () => {
    expect(parseJsonRaios({}).strikes).toEqual([]);
    expect(parseJsonRaios(null).day).toBeNull();
    expect(parseJsonRaios({ raios: [{ data: '2026-10-08T00:00:00', listaRaios: null }] }).strikes).toEqual([]);
  });
});
