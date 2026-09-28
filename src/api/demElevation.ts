/**
 * Ground elevation read straight from the Terrarium DEM tiles, without
 * MapLibre terrain.
 *
 * The fog overlay and the AEMET visibility halo need the altitude of the
 * ground under each cell (fog is a low-lying phenomenon). They used to get it
 * from `map.queryTerrainElevation()`, which only answers while MapLibre
 * terrain is ON — and terrain on a flat map is ruinous: MapLibre reads pixels
 * back from the GPU (`readPixels`, synchronous) on every pointer move and for
 * every DOM marker on every frame. Trace of 27-Sep with fog active: 29.8 s of
 * 40 s of the main thread in `readPixels`, ~95 ms per mouse move.
 *
 * Here the same tiles the hillshade already downloads (and the service worker
 * caches) are fetched and decoded once, and elevation is a plain array lookup.
 * Two side benefits over the terrain route:
 *   - the answer no longer depends on the view: terrain only held tiles for
 *     what was on screen, and a tile not loaded answered 0 m (so off-screen
 *     cells looked like sea-level land and got fog painted on them);
 *   - values are real metres. Terrain returned them multiplied by its
 *     exaggeration (1.2), so the thresholds written as "valley < 185 m" or
 *     "50 m above the station" were silently acting as 154 m / 42 m.
 *
 * A tile that fails to load answers `null` (unknown). Callers must treat
 * unknown as "do not paint", never as water.
 */

export const TERRARIUM_TILE_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

/** Highest zoom the style's DEM source uses (~57 m per pixel at 42° N). */
export const DEM_ZOOM = 11;

/** Decoded tiles kept in memory (256×256 Float32 = 256 KB each). */
const MAX_CACHED_TILES = 48;

export interface Bbox { west: number; east: number; south: number; north: number }

/** A decoded tile: `size`×`size` elevations in metres, row-major, north first. */
export interface DemTile { size: number; elev: Float32Array }

export type DemTileLoader = (z: number, x: number, y: number) => Promise<DemTile>;

/** Elevation in metres at a point, or null when its tile could not be loaded. */
export type ElevationAt = (lng: number, lat: number) => number | null;

// ── Pure helpers ────────────────────────────────────────────

/** Fractional Web Mercator tile coordinates of a point at zoom `z`. */
export function lngLatToTileXY(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  };
}

/** Terrarium encoding: elevation = R·256 + G + B/256 − 32768 (metres). */
export function decodeTerrarium(rgba: ArrayLike<number>): Float32Array {
  const out = new Float32Array(Math.floor(rgba.length / 4));
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = rgba[p] * 256 + rgba[p + 1] + rgba[p + 2] / 256 - 32768;
  }
  return out;
}

/**
 * Bilinear sample at a position given in pixel units inside the tile
 * (`px`, `py` in [0, size)). Pixel i covers [i, i+1), so its value sits at
 * i + 0.5; positions past the outer pixel centres clamp to the edge.
 */
export function sampleTile(tile: DemTile, px: number, py: number): number {
  const { size, elev } = tile;
  const max = size - 1;
  const u = Math.min(max, Math.max(0, px - 0.5));
  const v = Math.min(max, Math.max(0, py - 0.5));
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const x1 = Math.min(max, x0 + 1);
  const y1 = Math.min(max, y0 + 1);
  const tx = u - x0;
  const ty = v - y0;
  const a = elev[y0 * size + x0];
  const b = elev[y0 * size + x1];
  const c = elev[y1 * size + x0];
  const d = elev[y1 * size + x1];
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

/** Keys (`z/x/y`) of every tile at zoom `z` that a bbox touches. */
export function tilesForBbox(bbox: Bbox, z: number): string[] {
  const nw = lngLatToTileXY(bbox.west, bbox.north, z);
  const se = lngLatToTileXY(bbox.east, bbox.south, z);
  const keys: string[] = [];
  for (let x = Math.floor(nw.x); x <= Math.floor(se.x); x++) {
    for (let y = Math.floor(nw.y); y <= Math.floor(se.y); y++) {
      keys.push(`${z}/${x}/${y}`);
    }
  }
  return keys;
}

/** Bbox of a circle of `radiusKm` around a point (equirectangular, fine < 20 km). */
export function bboxAround(lat: number, lon: number, radiusKm: number): Bbox {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  return { west: lon - dLon, east: lon + dLon, south: lat - dLat, north: lat + dLat };
}

// ── Browser loader ──────────────────────────────────────────

const TILE_TIMEOUT_MS = 15_000;

export const fetchDemTile: DemTileLoader = async (z, x, y) => {
  const url = TERRARIUM_TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
    ? AbortSignal.timeout(TILE_TIMEOUT_MS)
    : undefined;
  const res = await fetch(url, { mode: 'cors', signal });
  if (!res.ok) throw new Error(`DEM tile ${z}/${x}/${y}: HTTP ${res.status}`);
  // No colour-space conversion: the RGB bytes ARE the data.
  const bmp = await createImageBitmap(await res.blob(), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
  try {
    const size = bmp.width;
    const canvas: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(size, bmp.height)
      : Object.assign(document.createElement('canvas'), { width: size, height: bmp.height });
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('DEM tile: no 2d context');
    ctx.drawImage(bmp, 0, 0);
    return { size, elev: decodeTerrarium(ctx.getImageData(0, 0, size, bmp.height).data) };
  } finally {
    bmp.close();
  }
};

// ── Cache + sampler ─────────────────────────────────────────

/**
 * One promise per tile, shared by concurrent callers. A failed tile is
 * dropped so a later build can try again (builds are throttled, so this
 * cannot turn into a retry storm).
 */
const tileCache = new Map<string, Promise<DemTile>>();

function getTile(key: string, loader: DemTileLoader): Promise<DemTile> {
  const hit = tileCache.get(key);
  if (hit) {
    // Refresh recency: Map iteration order is insertion order.
    tileCache.delete(key);
    tileCache.set(key, hit);
    return hit;
  }
  const [z, x, y] = key.split('/').map(Number);
  const p = loader(z, x, y);
  tileCache.set(key, p);
  p.catch(() => { if (tileCache.get(key) === p) tileCache.delete(key); });
  while (tileCache.size > MAX_CACHED_TILES) {
    const oldest = tileCache.keys().next().value;
    if (oldest === undefined) break;
    tileCache.delete(oldest);
  }
  return p;
}

/**
 * Load the DEM tiles covering `areas` and return a synchronous sampler.
 * Points outside the loaded tiles (or in a tile that failed) answer null.
 */
export async function loadElevationSampler(
  areas: Bbox[],
  loader: DemTileLoader = fetchDemTile,
  z: number = DEM_ZOOM,
): Promise<ElevationAt> {
  const keys = [...new Set(areas.flatMap((b) => tilesForBbox(b, z)))];
  const loaded = new Map<string, DemTile>();
  await Promise.all(keys.map(async (key) => {
    try { loaded.set(key, await getTile(key, loader)); }
    catch { /* unknown elevation there — the sampler answers null */ }
  }));

  return (lng, lat) => {
    const { x, y } = lngLatToTileXY(lng, lat, z);
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    const tile = loaded.get(`${z}/${tx}/${ty}`);
    if (!tile) return null;
    return sampleTile(tile, (x - tx) * tile.size, (y - ty) * tile.size);
  };
}

/** Test hook: forget every cached tile (the cache outlives a test otherwise). */
export function __clearDemCacheForTests(): void {
  tileCache.clear();
}
