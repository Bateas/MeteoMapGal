/**
 * RainViewer radar tiles as numbers: every pixel back to its reflectivity (dBZ), and the
 * geometry to put those pixels on the map.
 *
 * The free API serves one colour scheme only (Universal Blue, scheme 2; asking for another
 * returns the same bytes, checked on 1-oct-2026) and publishes the exact colour of every dBZ
 * value (rainviewer.com/files/rainviewer_api_colors_table.csv). Requested WITHOUT smoothing
 * (`0_0`), every non-transparent pixel matches the table exactly: 0 unknown colours over four
 * z3 tiles of Europe on 1-oct. With smoothing (`1_1`, what the radar layer draws) colours blend
 * and stop matching, so the decoder needs its own unsmoothed tiles.
 *
 * Pure: no fetch, no DOM. The caller decodes the PNG (canvas) and hands over RGBA bytes.
 */

/** Zoom of the mosaic. The free tier stops at 7; at 42° N a pixel is ~0.9 km. */
export const RADAR_ZOOM = 7;
export const TILE_PX = 256;
/** A pixel with no echo (transparent, or a colour outside the table). */
export const NO_ECHO = -128;

// Universal Blue colours, RRGGBBAA, one per dBZ: rain from -10 dBZ, snow from -9 dBZ, both up
// to 95. From the official table; the top saturates (white from 65, green/blue from 75).
const RAIN_FROM = -10;
const RAIN =
  '6361591466635a1969665c1e6c685d246f6b5f29726e612e75706234787364397c75653e7f786744827b6949857d6a4e' +
  '88806c548b826d598e856f5e928871649e93756eaa9e7978b6a97e82c2b4828ccec08796d2c48ba0d6c88faadacc93b4' +
  'ded097be88ddeeff6cd1ebff51c5e8ff36bae5ff1baee2ff00a3e0ff009ad5ff0091caff0088bfff007fb4ff0077aaff' +
  '0070a3ff00699cff006295ff005b8eff005588ff005180ff004e78ff004a70ff004768ffffee00ffffe000ffffd200ff' +
  'ffc500ffffb700ffffaa00ffff9f00ffff9500ffff8b00ffff8100ffff4400fff23600ffe62800ffd91b00ffcd0d00ff' +
  'c10000ffa80000ff8f0000ff760000ff5d0000ffffaaffffff9fffffff95ffffff8bffffff81ffffff77ffffff6cffff' +
  'ff62ffffff58ffffff4effffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' +
  'ffffffff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff' +
  '00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff';
const SNOW_FROM = -9;
const SNOW =
  'ceffff0ccdffff19ccffff26cbffff33cbffff3fcaffff4cc9ffff59c8ffff66c7ffff72c7ffff7fc6ffff8cc5ffff99' +
  'c4ffffa5c3ffffb2c3ffffbfc2ffffccc1ffffd8c0ffffe5bffffff2bfffffffb8f8ffffb2f2ffffabebffffa5e5ffff' +
  '9fdfffff98d8ffff92d2ffff8bcbffff85c5ffff7fbfffff78b8ffff72b2ffff6babffff65a5ffff5f9fffff5b9bffff' +
  '5898ffff5595ffff5292ffff4f8fffff4b8bffff4888ffff4585ffff4282ffff3f7fffff3b7bffff3878ffff3575ffff' +
  '3272ffff2f6fffff2b6bffff2868ffff2565ffff2262ffff1f5fffff1b5bffff1858ffff1555ffff1252ffff0f4fffff' +
  '0c4bffff0948ffff0645ffff0242ffff003fffff003bffff0038ffff0035ffff0032ffff002fffff002bffff0028ffff' +
  '0025ffff0022ffff001fffff001bffff0018ffff0015ffff0012ffff000fffff000cffff0009ffff0006ffff0002ffff' +
  '0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff' +
  '0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff';

let lut: Map<number, number> | null = null;
/** RGBA packed as an unsigned 32-bit number → dBZ. Rain first; a colour repeated at the top keeps its lowest dBZ. */
function palette(): Map<number, number> {
  if (lut) return lut;
  lut = new Map();
  for (const [hex, from] of [[RAIN, RAIN_FROM], [SNOW, SNOW_FROM]] as const) {
    for (let i = 0; i + 8 <= hex.length; i += 8) {
      const key = parseInt(hex.slice(i, i + 8), 16) >>> 0;
      if (!lut.has(key)) lut.set(key, from + i / 8);
    }
  }
  return lut;
}

/** dBZ of one pixel, or null when it is transparent or not a radar colour. */
export function dbzFromRgba(r: number, g: number, b: number, a: number): number | null {
  if (a === 0) return null;
  const key = (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
  return palette().get(key) ?? null;
}

/** One tile's RGBA bytes (row-major, 4 per pixel) → dBZ per pixel, NO_ECHO where there is none. */
export function decodeTile(rgba: ArrayLike<number>): Int8Array {
  const n = Math.floor(rgba.length / 4);
  const out = new Int8Array(n).fill(NO_ECHO);
  for (let i = 0; i < n; i++) {
    const z = dbzFromRgba(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], rgba[i * 4 + 3]);
    if (z != null) out[i] = Math.max(-127, Math.min(127, z));
  }
  return out;
}

/** Rain rate (mm/h) for a reflectivity, Marshall-Palmer Z = 200 R^1.6. Indicative only:
 *  drizzle and showers follow other laws, and the beam can pass over low rain. */
export function rainRateMmH(dbz: number): number {
  return Math.pow(Math.pow(10, dbz / 10) / 200, 1 / 1.6);
}

// ── Geometry ─────────────────────────────────────────────

/** A block of nx × ny tiles at zoom z, starting at tile (x0, y0), decoded into one grid. */
export interface RadarMosaic {
  z: number;
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  /** Width and height in pixels */
  w: number;
  h: number;
  /** dBZ per pixel, row-major, NO_ECHO where there is none */
  dbz: Int8Array;
  /** Frame time, epoch seconds (RainViewer's own) */
  t: number;
}

const lonToX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const latToY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const xToLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const yToLat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

/** The tiles at zoom z that cover a box [west, south, east, north]. */
export function tilesForBbox(bbox: [number, number, number, number], z = RADAR_ZOOM): { x0: number; y0: number; nx: number; ny: number } {
  const [w, s, e, n] = bbox;
  const x0 = Math.floor(lonToX(w, z)), x1 = Math.floor(lonToX(e, z));
  const y0 = Math.floor(latToY(n, z)), y1 = Math.floor(latToY(s, z));
  return { x0, y0, nx: x1 - x0 + 1, ny: y1 - y0 + 1 };
}

/** Joins decoded tiles into one mosaic. A missing tile stays NO_ECHO. */
export function assembleMosaic(
  tiles: { x: number; y: number; dbz: Int8Array }[],
  block: { x0: number; y0: number; nx: number; ny: number },
  t: number,
  z = RADAR_ZOOM,
): RadarMosaic {
  const w = block.nx * TILE_PX, h = block.ny * TILE_PX;
  const dbz = new Int8Array(w * h).fill(NO_ECHO);
  for (const tile of tiles) {
    const ox = (tile.x - block.x0) * TILE_PX, oy = (tile.y - block.y0) * TILE_PX;
    if (ox < 0 || oy < 0 || ox >= w || oy >= h || tile.dbz.length !== TILE_PX * TILE_PX) continue;
    for (let row = 0; row < TILE_PX; row++) {
      dbz.set(tile.dbz.subarray(row * TILE_PX, (row + 1) * TILE_PX), (oy + row) * w + ox);
    }
  }
  return { z, ...block, w, h, dbz, t };
}

/** Pixel coordinates (fractional) of a point in the mosaic. */
export function lonLatToPx(m: RadarMosaic, lon: number, lat: number): [number, number] {
  return [(lonToX(lon, m.z) - m.x0) * TILE_PX, (latToY(lat, m.z) - m.y0) * TILE_PX];
}

/** Longitude and latitude of a pixel position (fractional pixels allowed). */
export function pxToLonLat(m: RadarMosaic, px: number, py: number): [number, number] {
  return [xToLon(m.x0 + px / TILE_PX, m.z), yToLat(m.y0 + py / TILE_PX, m.z)];
}

/** The mosaic's four corners [top-left, top-right, bottom-right, bottom-left] as [lon, lat],
 *  the order a MapLibre image source wants. */
export function mosaicCorners(m: RadarMosaic): [[number, number], [number, number], [number, number], [number, number]] {
  return [pxToLonLat(m, 0, 0), pxToLonLat(m, m.w, 0), pxToLonLat(m, m.w, m.h), pxToLonLat(m, 0, m.h)];
}

/** Ground size of a pixel (km) at a latitude. */
export function kmPerPx(m: RadarMosaic, lat: number): number {
  return (40075.017 * Math.cos((lat * Math.PI) / 180)) / (TILE_PX * 2 ** m.z);
}

/** Strongest echo (dBZ) within radiusKm of a point; NO_ECHO when there is none or the point is off the mosaic. */
export function maxDbzNear(m: RadarMosaic, lon: number, lat: number, radiusKm: number): number {
  const [cx, cy] = lonLatToPx(m, lon, lat);
  const r = Math.max(0, radiusKm / kmPerPx(m, lat));
  let best = NO_ECHO;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    if (y < 0 || y >= m.h) continue;
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (x < 0 || x >= m.w) continue;
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r + 0.71) continue;
      const v = m.dbz[y * m.w + x];
      if (v > best) best = v;
    }
  }
  return best;
}
