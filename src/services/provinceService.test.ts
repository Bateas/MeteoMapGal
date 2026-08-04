import { describe, it, expect } from 'vitest';
import {
  normalizeProvinceName,
  provinceFromMeteoclimaticId,
  inferProvinceFromNeighbours,
  fillMissingProvinces,
  type LabelledPoint,
} from './provinceService';

describe('normalizeProvinceName — the sources spell it four different ways', () => {
  it('agrees on one spelling whatever the source writes', () => {
    // AEMET shouts, MeteoGalicia uses title case, and plenty of feeds drop the
    // tilde entirely. All three describe the same province.
    expect(normalizeProvinceName('A CORUÑA')).toBe('A Coruña');
    expect(normalizeProvinceName('A Coruña')).toBe('A Coruña');
    expect(normalizeProvinceName('Coruna')).toBe('A Coruña');
    expect(normalizeProvinceName('PONTEVEDRA')).toBe('Pontevedra');
    expect(normalizeProvinceName('Lugo')).toBe('Lugo');
  });

  it('accepts both spellings of Ourense', () => {
    expect(normalizeProvinceName('Ourense')).toBe('Ourense');
    expect(normalizeProvinceName('ORENSE')).toBe('Ourense');
  });

  it('rejects anything that is not one of the four', () => {
    // AEMET covers all of Spain, so this is the common case, not an edge one.
    expect(normalizeProvinceName('MADRID')).toBeNull();
    expect(normalizeProvinceName('Asturias')).toBeNull();
    expect(normalizeProvinceName('')).toBeNull();
    expect(normalizeProvinceName(null)).toBeNull();
    expect(normalizeProvinceName(undefined)).toBeNull();
  });
});

describe('provinceFromMeteoclimaticId — the province is inside the id', () => {
  it('reads all four INE codes', () => {
    expect(provinceFromMeteoclimaticId('ESGAL1500000015702A')).toBe('A Coruña');
    expect(provinceFromMeteoclimaticId('ESGAL2700000027002B')).toBe('Lugo');
    expect(provinceFromMeteoclimaticId('ESGAL3200000032003A')).toBe('Ourense');
    expect(provinceFromMeteoclimaticId('ESGAL3600000036202A')).toBe('Pontevedra');
  });

  it('reads it with our own prefix attached', () => {
    expect(provinceFromMeteoclimaticId('mc_ESGAL2700000027821A')).toBe('Lugo');
  });

  it('covers the two provinces the old version could not', () => {
    // The previous implementation knew only 32 and 36 and answered
    // 'DESCONOCIDA' for the rest. Nobody noticed, because those two feeds
    // were the only ones ever requested — A Coruña was never asked for and
    // Lugo was not requested at all.
    expect(provinceFromMeteoclimaticId('ESGAL1500000015624A')).not.toBeNull();
    expect(provinceFromMeteoclimaticId('ESGAL2700000027678A')).not.toBeNull();
  });

  it('returns null for something that is not a Meteoclimatic id', () => {
    expect(provinceFromMeteoclimaticId('wu_IVIGO48')).toBeNull();
    expect(provinceFromMeteoclimaticId('ESCAT0800000008019A')).toBeNull();
  });
});

describe('inferProvinceFromNeighbours — for the sources that say nothing', () => {
  // Real coordinates of stations whose province is known from their own feed.
  const reference: LabelledPoint[] = [
    { lat: 42.235, lon: -8.720, province: 'Pontevedra' }, // Vigo
    { lat: 43.367, lon: -8.400, province: 'A Coruña' },   // A Coruña
    { lat: 43.012, lon: -7.556, province: 'Lugo' },       // Lugo
    { lat: 42.336, lon: -7.864, province: 'Ourense' },    // Ourense
  ];

  it('takes the province of the closest station that knows', () => {
    expect(inferProvinceFromNeighbours(42.24, -8.73, reference)).toBe('Pontevedra');
    expect(inferProvinceFromNeighbours(43.35, -8.41, reference)).toBe('A Coruña');
  });

  it('handles the border case the rectangles got wrong', () => {
    // Dozón sits at 42.52,-8.15 and belongs to Pontevedra, but a box drawn by
    // hand filed it under Ourense — one of the three misses that sent this
    // whole approach to nearest-neighbour in the first place.
    const withDozonNeighbour: LabelledPoint[] = [
      ...reference,
      { lat: 42.515, lon: -8.155, province: 'Pontevedra' },
    ];
    expect(inferProvinceFromNeighbours(42.52, -8.16, withDozonNeighbour)).toBe('Pontevedra');
  });

  it('returns null with nothing to compare against', () => {
    expect(inferProvinceFromNeighbours(42.2, -8.7, [])).toBeNull();
  });
});

describe('fillMissingProvinces', () => {
  it('keeps what the source said and infers the rest', () => {
    const stations = [
      { lat: 42.235, lon: -8.720, province: 'PONTEVEDRA' },  // shouted by AEMET
      { lat: 43.367, lon: -8.400, province: 'A Coruña' },     // MeteoGalicia
      { lat: 42.240, lon: -8.730 },                            // a WU with no idea
    ];
    const stats = fillMissingProvinces(stations);

    expect(stations[0].province).toBe('Pontevedra'); // normalised in place
    expect(stations[2].province).toBe('Pontevedra'); // inherited from Vigo
    expect(stats).toEqual({ labelled: 2, inferred: 1, unknown: 0 });
  });

  it('leaves a station without coordinates alone instead of guessing', () => {
    // A (0,0) placeholder would otherwise inherit whatever province sits
    // nearest the Gulf of Guinea, which is every one of them equally.
    const stations = [
      { lat: 42.235, lon: -8.720, province: 'Pontevedra' },
      { lat: 0, lon: 0 },
    ];
    const stats = fillMissingProvinces(stations);

    expect(stations[1].province).toBeUndefined();
    expect(stats.unknown).toBe(1);
    expect(stats.inferred).toBe(0);
  });

  it('infers nothing when no station knows its own province', () => {
    const stations: { lat: number; lon: number; province?: string }[] = [
      { lat: 42.2, lon: -8.7 },
      { lat: 43.1, lon: -7.5 },
    ];
    const stats = fillMissingProvinces(stations);

    expect(stats).toEqual({ labelled: 0, inferred: 0, unknown: 2 });
    expect(stations.every((s) => s.province === undefined)).toBe(true);
  });

  it('does not let a coordinate-less station become a reference for others', () => {
    const stations = [
      { lat: 0, lon: 0, province: 'Lugo' },              // claims Lugo, sits nowhere
      { lat: 42.235, lon: -8.720, province: 'Pontevedra' },
      { lat: 42.240, lon: -8.730 },
    ];
    fillMissingProvinces(stations);
    expect(stations[2].province).toBe('Pontevedra');
  });
});
