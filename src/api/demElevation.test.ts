import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  lngLatToTileXY,
  decodeTerrarium,
  sampleTile,
  tilesForBbox,
  bboxAround,
  loadElevationSampler,
  __clearDemCacheForTests,
  type DemTile,
  type DemTileLoader,
} from './demElevation';

/** Terrarium bytes for an elevation in metres. */
function terrarium(m: number): [number, number, number, number] {
  const v = m + 32768;
  const r = Math.floor(v / 256);
  const g = Math.floor(v - r * 256);
  const b = Math.round((v - r * 256 - g) * 256);
  return [r, g, b, 255];
}

function constantTile(size: number, m: number): DemTile {
  return { size, elev: new Float32Array(size * size).fill(m) };
}

beforeEach(() => __clearDemCacheForTests());

describe('lngLatToTileXY', () => {
  it('puts (0, 0) in the middle of the world tile', () => {
    expect(lngLatToTileXY(0, 0, 0)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('places Ons (42.38 N, 8.93 W) in tile 973/757 at zoom 11', () => {
    const { x, y } = lngLatToTileXY(-8.93, 42.38, 11);
    expect(Math.floor(x)).toBe(973);
    expect(Math.floor(y)).toBe(757);
  });
});

describe('decodeTerrarium', () => {
  it('decodes sea level, land, sea floor and the fractional blue byte', () => {
    const rgba = [...terrarium(0), ...terrarium(100), ...terrarium(-20), ...terrarium(12.5)];
    expect(Array.from(decodeTerrarium(rgba))).toEqual([0, 100, -20, 12.5]);
  });
});

describe('sampleTile', () => {
  // 2×2 tile: 0 10 / 20 30 (north row first)
  const tile: DemTile = { size: 2, elev: new Float32Array([0, 10, 20, 30]) };

  it('returns the pixel value at a pixel centre', () => {
    expect(sampleTile(tile, 0.5, 0.5)).toBe(0);
    expect(sampleTile(tile, 1.5, 0.5)).toBe(10);
    expect(sampleTile(tile, 0.5, 1.5)).toBe(20);
  });

  it('interpolates between pixel centres', () => {
    expect(sampleTile(tile, 1, 0.5)).toBe(5);
    expect(sampleTile(tile, 1, 1)).toBe(15);
  });

  it('clamps past the outer pixel centres instead of reading out of bounds', () => {
    expect(sampleTile(tile, 0, 0)).toBe(0);
    expect(sampleTile(tile, 1.99, 1.99)).toBe(30);
  });
});

describe('tilesForBbox / bboxAround', () => {
  it('lists one tile for a small area inside it', () => {
    expect(tilesForBbox(bboxAround(42.38, -8.93, 1), 11)).toEqual(['11/973/757']);
  });

  it('lists every tile a larger area touches', () => {
    const keys = tilesForBbox({ west: -9.0, east: -8.7, south: 42.2, north: 42.45 }, 11);
    expect(keys.length).toBeGreaterThan(1);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('loadElevationSampler', () => {
  const ons = bboxAround(42.38, -8.93, 4);

  it('answers from the loaded tiles', async () => {
    const loader: DemTileLoader = async () => constantTile(4, 42);
    const at = await loadElevationSampler([ons], loader);
    expect(at(-8.93, 42.38)).toBe(42);
  });

  it('answers null outside the areas it was asked to load', async () => {
    const loader: DemTileLoader = async () => constantTile(4, 42);
    const at = await loadElevationSampler([ons], loader);
    expect(at(-7.9, 43.3)).toBeNull();
  });

  it('answers null (unknown, never water) where the tile failed', async () => {
    const loader: DemTileLoader = async () => { throw new Error('offline'); };
    const at = await loadElevationSampler([ons], loader);
    expect(at(-8.93, 42.38)).toBeNull();
  });

  it('downloads each tile once for concurrent and later callers', async () => {
    const loader = vi.fn<DemTileLoader>(async () => constantTile(4, 7));
    await Promise.all([loadElevationSampler([ons], loader), loadElevationSampler([ons], loader)]);
    await loadElevationSampler([ons], loader);
    expect(loader).toHaveBeenCalledTimes(tilesForBbox(ons, 11).length);
  });

  it('does not remember a failed tile, so a later build can retry', async () => {
    let fail = true;
    const loader = vi.fn<DemTileLoader>(async () => {
      if (fail) throw new Error('offline');
      return constantTile(4, 9);
    });
    const first = await loadElevationSampler([ons], loader);
    expect(first(-8.93, 42.38)).toBeNull();
    fail = false;
    const second = await loadElevationSampler([ons], loader);
    expect(second(-8.93, 42.38)).toBe(9);
  });
});
