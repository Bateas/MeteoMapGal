import { describe, it, expect } from 'vitest';
import { MAP_STYLES } from './mapStyleStore';

/**
 * These exist because of how the CARTO basemaps stopped working: not with a
 * 403, but with a 200 and a valid PNG that had "API KEY REQUIRED" burned into
 * the image. Nothing in the app could see it. Three of six base maps were
 * watermarked, the default among them, and it took a screenshot to notice.
 *
 * A test cannot see a watermark either. What it can do is hold the two things
 * that were actually checkable: that no tile points at a host known to demand a
 * key, and that the ids people have in localStorage never move.
 */
describe('MAP_STYLES — tiles', () => {
  it('no longer asks CARTO for anything', () => {
    const carto = MAP_STYLES.filter((s) => s.tiles.some((t) => t.includes('cartocdn')));
    expect(carto.map((s) => s.id)).toEqual([]);
  });

  it('every style has at least one tile URL over https', () => {
    for (const s of MAP_STYLES) {
      expect(s.tiles.length).toBeGreaterThan(0);
      for (const t of s.tiles) expect(t.startsWith('https://')).toBe(true);
    }
  });

  it('every tile URL carries the three placeholders MapLibre substitutes', () => {
    // Esri puts row before column (/tile/{z}/{y}/{x}) and IGN passes them as
    // query parameters. Both are fine; what is not fine is dropping one.
    for (const s of MAP_STYLES) {
      for (const t of s.tiles) {
        expect(t, `${s.id} missing {z}`).toContain('{z}');
        expect(t, `${s.id} missing {x}`).toContain('{x}');
        expect(t, `${s.id} missing {y}`).toContain('{y}');
      }
    }
  });

  it('asks IGN for a layer name that exists', () => {
    // IGNBaseGris was renamed to IGNBase-gris and now serves jpeg. The old name
    // answers 400 and the map simply drew nothing: a raster source has no error
    // callback, so a dead base map looks like an empty one.
    const grey = MAP_STYLES.find((s) => s.id === 'ign-grey')!;
    expect(grey.tiles[0]).toContain('layer=IGNBase-gris');
    expect(grey.tiles[0]).toContain('format=image/jpeg');
  });

  it('credits whoever is actually serving the tiles', () => {
    for (const s of MAP_STYLES) {
      expect(s.attribution.length).toBeGreaterThan(0);
      // The provider changed; the credit had to change with it.
      if (s.tiles.some((t) => t.includes('arcgisonline'))) {
        expect(s.attribution).toContain('Esri');
      }
    }
  });
});

describe('MAP_STYLES — ids are a contract with localStorage', () => {
  it('keeps every id that has ever been persisted', () => {
    // Renaming one would silently reset the map for anyone who had chosen it.
    // The tiles behind an id may change; the id may not.
    const ids = MAP_STYLES.map((s) => s.id).sort();
    expect(ids).toEqual(['dark', 'ign-grey', 'ign-topo', 'osm', 'positron', 'voyager']);
  });

  it('gives each one a label and a swatch for the picker', () => {
    for (const s of MAP_STYLES) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.shortName.length).toBeGreaterThan(0);
      expect(s.swatch).toHaveLength(2);
    }
  });
});
