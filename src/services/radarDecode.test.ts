import { describe, it, expect } from 'vitest';
import {
  NO_ECHO, TILE_PX, assembleMosaic, dbzFromRgba, decodeTile, kmPerPx, lonLatToPx, maxDbzNear,
  mosaicCorners, pxToLonLat, rainRateMmH, tilesForBbox,
} from './radarDecode';

const hex = (h: string) => [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number, number];

describe('dbzFromRgba', () => {
  it('reads the official Universal Blue colours', () => {
    expect(dbzFromRgba(...hex('827b6949'))).toBe(0);
    expect(dbzFromRgba(...hex('cec08796'))).toBe(10);
    expect(dbzFromRgba(...hex('00a3e0ff'))).toBe(20);
    expect(dbzFromRgba(...hex('005588ff'))).toBe(30);
    expect(dbzFromRgba(...hex('ffaa00ff'))).toBe(40);
  });

  it('reads snow colours too, and keeps the lowest value where the top saturates', () => {
    expect(dbzFromRgba(...hex('ceffff0c'))).toBe(-9);
    expect(dbzFromRgba(...hex('ffffffff'))).toBe(65);
  });

  it('says nothing for transparent pixels or colours outside the table (smoothed tiles)', () => {
    expect(dbzFromRgba(0, 163, 224, 0)).toBeNull();
    expect(dbzFromRgba(1, 162, 223, 255)).toBeNull();
  });
});

describe('decodeTile', () => {
  it('turns RGBA bytes into dBZ, NO_ECHO where there is none', () => {
    const px = [hex('00a3e0ff'), [0, 0, 0, 0], hex('ffaa00ff')].flat();
    expect(Array.from(decodeTile(px))).toEqual([20, NO_ECHO, 40]);
  });
});

describe('rainRateMmH', () => {
  it('follows Marshall-Palmer', () => {
    expect(rainRateMmH(20)).toBeCloseTo(0.65, 1);
    expect(rainRateMmH(40)).toBeCloseTo(11.5, 0);
  });
});

describe('geometry', () => {
  const galicia: [number, number, number, number] = [-9.4, 41.8, -6.7, 43.8];

  it('covers Galicia with 2 x 2 tiles at zoom 7 (40.98-45.08 N)', () => {
    expect(tilesForBbox(galicia)).toEqual({ x0: 60, y0: 46, nx: 2, ny: 2 });
  });

  it('puts a point back where it came from', () => {
    const m = assembleMosaic([], { x0: 60, y0: 46, nx: 2, ny: 2 }, 0);
    const [px, py] = lonLatToPx(m, -8.68, 42.3);
    const [lon, lat] = pxToLonLat(m, px, py);
    expect(lon).toBeCloseTo(-8.68, 6);
    expect(lat).toBeCloseTo(42.3, 6);
    expect(kmPerPx(m, 42.3)).toBeCloseTo(0.903, 2);
    const [tl, , br] = mosaicCorners(m);
    expect(tl[0]).toBeLessThan(br[0]);
    expect(tl[1]).toBeGreaterThan(br[1]);
  });

  it('places each tile in its slot and leaves missing ones empty', () => {
    const tile = new Int8Array(TILE_PX * TILE_PX).fill(NO_ECHO);
    tile[0] = 33;
    const m = assembleMosaic([{ x: 61, y: 47, dbz: tile }], { x0: 60, y0: 46, nx: 2, ny: 2 }, 100);
    expect(m.w).toBe(512);
    expect(m.dbz[256 * 512 + 256]).toBe(33);
    expect(m.dbz[0]).toBe(NO_ECHO);
  });

  it('finds the strongest echo near a point, and nothing farther than asked', () => {
    const m = assembleMosaic([], { x0: 60, y0: 46, nx: 2, ny: 2 }, 0);
    const [px, py] = lonLatToPx(m, -8.68, 42.3);
    m.dbz[Math.floor(py) * m.w + Math.floor(px) + 1] = 28;      // one pixel east, ~0.9 km
    m.dbz[Math.floor(py) * m.w + Math.floor(px) + 6] = 45;      // ~5.4 km east
    expect(maxDbzNear(m, -8.68, 42.3, 2)).toBe(28);
    expect(maxDbzNear(m, -8.68, 42.3, 6)).toBe(45);
    expect(maxDbzNear(m, -20, 42.3, 2)).toBe(NO_ECHO);
  });
});
