import { describe, it, expect } from 'vitest';
import { MAP_STYLES, useMapStyleStore, resolveStyleId, migrateMapStyle } from './mapStyleStore';

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
    expect(ids).toEqual(['dark', 'ign-ortho', 'ign-topo', 'positron', 'voyager']);
  });

  it('gives each one a label and a swatch for the picker', () => {
    for (const s of MAP_STYLES) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.shortName.length).toBeGreaterThan(0);
      expect(s.swatch).toHaveLength(2);
    }
  });
});

describe('base map default — clean, following the theme', () => {
  it('a new visitor gets "auto", not the street map', () => {
    // The street map (road shields, coloured motorways) competed with the wind
    // data. It stays in the picker as an option.
    expect(useMapStyleStore.getState().activeStyleId).toBe('auto');
  });

  it('"auto" draws the grey canvas of the current theme', () => {
    expect(resolveStyleId('auto', 'dark')).toBe('dark');
    expect(resolveStyleId('auto', 'light')).toBe('positron');
  });

  it('a concrete pick is drawn as picked, whatever the theme', () => {
    expect(resolveStyleId('voyager', 'dark')).toBe('voyager');
    expect(resolveStyleId('ign-topo', 'light')).toBe('ign-topo');
  });

  it('both grey canvases carry place names; the street map does not need them', () => {
    // Esri keeps town names in a separate Reference service. Without it the
    // grey base shows the rías but not Cangas, Moaña or Vigo.
    for (const id of ['positron', 'dark'] as const) {
      const s = MAP_STYLES.find((x) => x.id === id)!;
      expect(s.labelTiles, id).toBeDefined();
      for (const t of s.labelTiles!) {
        expect(t.startsWith('https://')).toBe(true);
        expect(t).toContain('Reference');
        expect(t).toContain('{z}');
        expect(t).toContain('{x}');
        expect(t).toContain('{y}');
      }
    }
    expect(MAP_STYLES.find((x) => x.id === 'voyager')!.labelTiles).toBeUndefined();
  });
});

describe('migrateMapStyle', () => {
  it('moves anyone still on the old default (street map) to "auto"', () => {
    expect(migrateMapStyle({ activeStyleId: 'voyager' }, 0).activeStyleId).toBe('auto');
  });

  it('keeps a pick that is still offered', () => {
    expect(migrateMapStyle({ activeStyleId: 'ign-topo' }, 0).activeStyleId).toBe('ign-topo');
    expect(migrateMapStyle({ activeStyleId: 'voyager' }, 1).activeStyleId).toBe('voyager');
  });

  it('a map no longer offered goes back to Auto', () => {
    for (const id of ['osm', 'ign-grey', 'positron', 'dark']) {
      expect(migrateMapStyle({ activeStyleId: id }, 1).activeStyleId).toBe('auto');
    }
  });

  it('the orthophoto was a layer and is now a base map', () => {
    expect(migrateMapStyle({ activeStyleId: 'auto', showIGNOrtho: true }, 1).activeStyleId).toBe('ign-ortho');
  });

  it('the wave model keeps its switch under its own name, and the rest of the old switches go', () => {
    const out = migrateMapStyle({ showUpwelling: true, showSeamarks: true, showNauticalChart: true }, 1) as unknown as Record<string, unknown>;
    expect(out.showSwan).toBe(true);
    expect(out.showNauticalChart).toBe(true);
    expect('showUpwelling' in out).toBe(false);
    expect('showSeamarks' in out).toBe(false);
  });
});
