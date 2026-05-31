/**
 * Pins which spots count as beaches for the casual "¿buen día de playa?"
 * verdict. Guards against accidentally tagging open-water ría spots (where a
 * beach verdict is meaningless) as beaches.
 */
import { describe, it, expect } from 'vitest';
import { isBeachSpot, BEACH_SPOT_IDS, ALL_SPOTS } from './spots';

describe('isBeachSpot', () => {
  it('treats sand/launch beaches (incl. surf) as beaches', () => {
    for (const id of ['lourido', 'vao', 'lanzada', 'illa-arousa', 'castineiras', 'surf-patos', 'surf-lanzada', 'surf-corrubedo']) {
      expect(isBeachSpot(id)).toBe(true);
    }
  });

  it('excludes open-water ría spots', () => {
    for (const id of ['centro-ria', 'bocana', 'cies-ria']) {
      expect(isBeachSpot(id)).toBe(false);
    }
  });

  it('excludes the reservoir spot', () => {
    expect(isBeachSpot('castrelo')).toBe(false);
  });

  it('every beach id corresponds to a real spot', () => {
    const ids = new Set(ALL_SPOTS.map((s) => s.id));
    for (const beachId of BEACH_SPOT_IDS) {
      expect(ids.has(beachId as never)).toBe(true);
    }
  });
});
