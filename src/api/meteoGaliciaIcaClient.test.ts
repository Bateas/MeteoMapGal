/**
 * Tests for meteoGaliciaIcaClient — pure helper coverage.
 *
 * The fetcher itself is network-bound (skipped in CI). Here we test the
 * `icaCategory` bucketing only — that's the part that affects UI display
 * and could silently misclassify air quality.
 */

import { describe, it, expect } from 'vitest';
import { icaCategory, icaEndpoint, parseIcaActual } from './meteoGaliciaIcaClient';

describe('icaCategory — ICA value bucketing', () => {
  it('returns unknown for NaN', () => {
    expect(icaCategory(NaN)).toBe('unknown');
  });

  it('returns unknown for Infinity', () => {
    expect(icaCategory(Infinity)).toBe('unknown');
  });

  it('buena for <1.5', () => {
    expect(icaCategory(1)).toBe('buena');
    expect(icaCategory(1.49)).toBe('buena');
  });

  it('aceptable for 1.5-2.49', () => {
    expect(icaCategory(1.5)).toBe('aceptable');
    expect(icaCategory(2)).toBe('aceptable');
    expect(icaCategory(2.49)).toBe('aceptable');
  });

  it('deficiente for 2.5-3.49', () => {
    expect(icaCategory(2.5)).toBe('deficiente');
    expect(icaCategory(3)).toBe('deficiente');
    expect(icaCategory(3.49)).toBe('deficiente');
  });

  it('mala for 3.5-4.49', () => {
    expect(icaCategory(3.5)).toBe('mala');
    expect(icaCategory(4)).toBe('mala');
    expect(icaCategory(4.49)).toBe('mala');
  });

  it('muy_mala for ≥4.5', () => {
    expect(icaCategory(4.5)).toBe('muy_mala');
    expect(icaCategory(5)).toBe('muy_mala');
  });

  it('handles real-world live values from ICA API', () => {
    // From the ICA REST endpoint at the time of writing
    expect(icaCategory(1.5866)).toBe('aceptable');
    expect(icaCategory(1.7634)).toBe('aceptable');
    expect(icaCategory(1.83)).toBe('aceptable');
    expect(icaCategory(1.35)).toBe('buena');
  });
});

describe('icaEndpoint', () => {
  it('goes through our own MeteoGalicia path in the browser, so one request serves everyone', () => {
    expect(icaEndpoint(true)).toBe('/meteogalicia-api/mgrss/caire/jsonICAActual.action');
  });

  it('keeps the provider url for the service that stores the readings', () => {
    // ingestor/icaFetcher.ts imports this same function, and there a relative
    // url does not even parse.
    expect(icaEndpoint(false)).toBe('https://servizos.meteogalicia.gal/mgrss/caire/jsonICAActual.action');
  });

  it('never the map layer of their web viewer (IDEG), which is not for third parties', () => {
    expect(icaEndpoint(false)).not.toMatch(/ideg|MapServer/);
    expect(icaEndpoint(true)).not.toMatch(/ideg|MapServer|ica-api/);
  });
});

describe('parseIcaActual', () => {
  // Two records of the real answer of 12-oct-2026, 23:00 Madrid time.
  const real = {
    icas: [
      { color: '#00FFFF', estacion: 'Campus', fecha: '2026-10-12 23:00', ica: 0.91, icaEn: 'Good', icaEs: 'Buena', icaGl: 'Boa', idEstacion: 2, idParametro: 14, latitud: '42.875971', longitud: '-8.559157', maximo: 'O3', utmx: '536007', utmy: '4747140', valor: 46 },
      { color: '#00FFFF', estacion: 'Coia', fecha: '2026-10-12 23:00', ica: 0.65, icaEn: 'Good', icaEs: 'Buena', icaGl: 'Boa', idEstacion: 4, idParametro: 14, latitud: '42.219014', longitud: '-8.742082', maximo: 'O3', utmx: '521289', utmy: '4674124', valor: 33 },
    ],
  };

  it('reads station, index, category, colour, pollutant and position', () => {
    const [campus] = parseIcaActual(real);
    expect(campus).toMatchObject({ station: 'Campus', ica: 0.91, categoryEs: 'Buena', color: '#00FFFF', dominantPollutant: 'O3', lat: 42.875971, lon: -8.559157 });
  });

  it('reads the local time as Madrid time: 23:00 in October is 21:00 UTC, as the old layer gave it', () => {
    expect(parseIcaActual(real)[0].timestamp.toISOString()).toBe('2026-10-12T21:00:00.000Z');
  });

  it('keeps the freshest record per station', () => {
    const body = { icas: [
      { ...real.icas[0], fecha: '2026-10-12 21:00', ica: 1.5 },
      { ...real.icas[0] },
      { ...real.icas[0], fecha: '2026-10-12 22:00', ica: 1.2 },
    ] };
    const out = parseIcaActual(body);
    expect(out).toHaveLength(1);
    expect(out[0].ica).toBe(0.91);
  });

  it('drops records without index, position or time; odd bodies give nothing', () => {
    const body = { icas: [
      { ...real.icas[0], ica: null },
      { ...real.icas[0], estacion: 'B', latitud: 'x' },
      { ...real.icas[0], estacion: 'C', fecha: 'ayer' },
      null,
      real.icas[1],
    ] };
    expect(parseIcaActual(body).map((r) => r.station)).toEqual(['Coia']);
    expect(parseIcaActual(null)).toEqual([]);
    expect(parseIcaActual({ icas: 'x' })).toEqual([]);
  });
});
