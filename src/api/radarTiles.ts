/**
 * Radar frames for the rain layer: RainViewer tiles fetched UNSMOOTHED (`0_0`, the only way their
 * colours match the dBZ table) and decoded to reflectivity in the browser.
 *
 * RainViewer allows changing the images it serves (rainviewer.com/api.html: "You can change any
 * image received by this API without any restrictions") and asks for a credit with a link; each
 * visitor's own browser fetches and decodes, nothing is stored on our side. Tiles are immutable
 * per frame path and the CDN sends max-age=172800, so a decoded frame is kept in memory by path
 * and a new frame costs four requests.
 */

import { fetchRainViewerFrames } from './rainviewerClient';
import { RADAR_ZOOM, TILE_PX, assembleMosaic, decodeTile, type RadarMosaic } from '../services/radarDecode';

/** All of Galicia: tiles 60-61 x 46-47 at zoom 7 (40.98-45.08 N, 11.25-5.63 W). */
export const GALICIA_BLOCK = { x0: 60, y0: 46, nx: 2, ny: 2 };
/** Ten frames = 90 min, enough for three 30-min motion pairs. */
export const FRAMES_WANTED = 10;
const TILE_TIMEOUT_MS = 10_000;

const decoded = new Map<string, RadarMosaic>();

async function decodePng(blob: Blob): Promise<Int8Array> {
  const bmp = await createImageBitmap(blob);
  const canvas: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(TILE_PX, TILE_PX)
    : Object.assign(document.createElement('canvas'), { width: TILE_PX, height: TILE_PX });
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  return decodeTile(ctx.getImageData(0, 0, TILE_PX, TILE_PX).data);
}

async function loadFrame(host: string, path: string, t: number): Promise<RadarMosaic | null> {
  const hit = decoded.get(path);
  if (hit) return hit;
  const tiles: { x: number; y: number; dbz: Int8Array }[] = [];
  const b = GALICIA_BLOCK;
  for (let y = b.y0; y < b.y0 + b.ny; y++) {
    for (let x = b.x0; x < b.x0 + b.nx; x++) {
      const res = await fetch(`${host}${path}/256/${RADAR_ZOOM}/${x}/${y}/2/0_0.png`, { signal: AbortSignal.timeout(TILE_TIMEOUT_MS) });
      if (!res.ok) return null;                       // an incomplete frame is worse than none
      tiles.push({ x, y, dbz: await decodePng(await res.blob()) });
    }
  }
  const m = assembleMosaic(tiles, b, t);
  decoded.set(path, m);
  return m;
}

/**
 * The latest `count` frames over Galicia, oldest first, with how old the newest one is. Frames
 * that fail are skipped; null when RainViewer answers nothing usable. `count` 1 is the cheap look
 * the rain layer takes on a dry day (~5 KB a look, one look every 5 min, measured on the night of 1-oct); the
 * history is fetched only when there is rain to follow.
 */
export async function fetchRadarFrames(signal?: AbortSignal, count = FRAMES_WANTED): Promise<{ frames: RadarMosaic[]; newestAgeMin: number } | null> {
  const meta = await fetchRainViewerFrames();
  if (!meta || meta.past.length === 0) return null;
  const want = meta.past.slice(-count);
  const frames: RadarMosaic[] = [];
  for (const f of want) {
    if (signal?.aborted) return null;
    try {
      const m = await loadFrame(meta.host, f.path, f.time);
      if (m) frames.push(m);
    } catch {
      // a frame that fails to load or decode is skipped; motion needs the rest in order
    }
  }
  // keep memory bounded to the frames still offered
  const live = new Set(meta.past.map((p) => p.path));
  for (const k of decoded.keys()) if (!live.has(k)) decoded.delete(k);
  if (frames.length === 0) return null;
  const newest = frames[frames.length - 1];
  return { frames, newestAgeMin: Math.round((Date.now() / 1000 - newest.t) / 60) };
}
