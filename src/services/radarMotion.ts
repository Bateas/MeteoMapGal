/**
 * Where the rain is going: the shift that best lays one radar frame onto a later one.
 *
 * Block matching on the reflectivity field (least squared difference over the rain), coarse
 * then fine so it stays cheap in a browser. Frames 30 min apart, not 10: at zoom 7 a pixel is
 * ~0.9 km, so ten minutes resolves only ~5 km/h steps. Tried on real frames on 1-oct-2026
 * (northern Germany, 13 frames): every 10-min pair gave 31-38 km/h towards 14-34°, every
 * 30-min pair 31-36 km/h towards 18-27°, under a 700 hPa wind from 176-183° at 47-56 km/h —
 * consistent from pair to pair and with the wind that carries it.
 *
 * Only a motion that repeats over several pairs is called stable; the ETA uses nothing else.
 * Pure: no fetch, no DOM.
 */

import { NO_ECHO, kmPerPx, pxToLonLat, type RadarMosaic } from './radarDecode';

/** Echo weaker than this is left out of the matching (sea clutter sits at 10-15 dBZ). */
const MATCH_MIN_DBZ = 15;
/** Rain (>= 20 dBZ) a frame needs before its motion means anything. */
const MIN_RAIN_PX = 80;
/** Fastest rain considered, km/h. Fronts in Galicia move 30-60. */
const MAX_KMH = 100;
/** Slower than this the arrow would point at noise. */
export const MIN_MOTION_KMH = 5;
/** Pairs whose direction strays more than this from the mean break the stability. */
const MAX_DIR_SPREAD_DEG = 35;
/** Frames between the two ends of a pair (10 min each). */
const PAIR_LAG = 3;

export interface RadarMotion {
  /** Mean shift, pixels per minute (x east, y south) */
  pxPerMinX: number;
  pxPerMinY: number;
  kmh: number;
  /** Direction the rain moves TOWARDS, degrees from north */
  toDeg: number;
  /** Pairs measured */
  pairs: number;
  /** Repeated over at least 2 pairs, same way and speed, and not crawling */
  stable: boolean;
}

/** Matching weight of a pixel: 0 below MATCH_MIN_DBZ, capped at 55 dBZ so one hail core does not rule. */
function weight(v: number): number {
  return v === NO_ECHO || v < MATCH_MIN_DBZ ? 0 : Math.min(v, 55) - MATCH_MIN_DBZ + 1;
}

function rainBox(m: RadarMosaic): { x0: number; y0: number; x1: number; y1: number; n: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (m.dbz[y * m.w + x] < 20) continue;
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return n >= MIN_RAIN_PX ? { x0, y0, x1, y1, n } : null;
}

/** Mean squared difference between a and b shifted by (dx, dy), over pixels with rain in either. */
function score(a: Float32Array, b: Float32Array, w: number, h: number, box: { x0: number; y0: number; x1: number; y1: number }, dx: number, dy: number, step: number): number {
  let s = 0, n = 0;
  for (let y = box.y0; y <= box.y1; y += step) {
    const yb = y + dy;
    if (yb < 0 || yb >= h) continue;
    for (let x = box.x0; x <= box.x1; x += step) {
      const xb = x + dx;
      if (xb < 0 || xb >= w) continue;
      const va = a[y * w + x], vb = b[yb * w + xb];
      if (va === 0 && vb === 0) continue;
      s += (va - vb) * (va - vb);
      n++;
    }
  }
  return n >= 30 ? s / n : Infinity;
}

function downsample(f: Float32Array, w: number, h: number, k: number): { f: Float32Array; w: number; h: number } {
  const W = Math.floor(w / k), H = Math.floor(h / k);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) s += f[(y * k + j) * w + x * k + i];
      out[y * W + x] = s / (k * k);
    }
  }
  return { f: out, w: W, h: H };
}

/**
 * Shift (pixels) that carries frame `a` onto the later frame `b`, or null when either has too
 * little rain to tell. `maxShiftPx` bounds the search.
 */
export function shiftBetween(a: RadarMosaic, b: RadarMosaic, maxShiftPx: number): { dx: number; dy: number } | null {
  if (a.w !== b.w || a.h !== b.h) return null;
  const boxA = rainBox(a), boxB = rainBox(b);
  if (!boxA || !boxB) return null;
  const { w, h } = a;
  const fa = new Float32Array(w * h), fb = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { fa[i] = weight(a.dbz[i]); fb[i] = weight(b.dbz[i]); }

  // Coarse: a quarter of the resolution, the whole search range.
  const K = 4;
  const ca = downsample(fa, w, h, K), cb = downsample(fb, w, h, K);
  const R = Math.ceil(maxShiftPx / K);
  const cbox = {
    x0: Math.max(0, Math.floor(boxA.x0 / K) - 1), y0: Math.max(0, Math.floor(boxA.y0 / K) - 1),
    x1: Math.min(ca.w - 1, Math.ceil(boxA.x1 / K) + 1), y1: Math.min(ca.h - 1, Math.ceil(boxA.y1 / K) + 1),
  };
  let best = { dx: 0, dy: 0, s: Infinity };
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const s = score(ca.f, cb.f, ca.w, ca.h, cbox, dx, dy, 1);
      if (s < best.s) best = { dx, dy, s };
    }
  }
  if (!Number.isFinite(best.s)) return null;

  // Fine: full resolution around the coarse answer.
  const fbox = { x0: boxA.x0, y0: boxA.y0, x1: boxA.x1, y1: boxA.y1 };
  const step = (boxA.x1 - boxA.x0) * (boxA.y1 - boxA.y0) > 40_000 ? 2 : 1;
  let fine = { dx: best.dx * K, dy: best.dy * K, s: Infinity };
  for (let dy = best.dy * K - K; dy <= best.dy * K + K; dy++) {
    for (let dx = best.dx * K - K; dx <= best.dx * K + K; dx++) {
      if (Math.hypot(dx, dy) > maxShiftPx) continue;
      const s = score(fa, fb, w, h, fbox, dx, dy, step);
      if (s < fine.s) fine = { dx, dy, s };
    }
  }
  return Number.isFinite(fine.s) ? { dx: fine.dx, dy: fine.dy } : null;
}

const toDeg = (x: number, y: number) => ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
const angleGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/**
 * Motion of the rain from frames sorted by time (10 min apart, oldest first). Uses up to three
 * 30-min pairs ending at the newest frame; null when no pair has enough rain.
 */
export function estimateMotion(frames: RadarMosaic[]): RadarMotion | null {
  if (frames.length < PAIR_LAG + 1) return null;
  const last = frames[frames.length - 1];
  const centreLat = pxToLonLat(last, last.w / 2, last.h / 2)[1];
  const kpp = kmPerPx(last, centreLat);
  const vecs: { x: number; y: number }[] = [];
  for (let end = frames.length - 1; end - PAIR_LAG >= 0 && vecs.length < 3; end -= PAIR_LAG) {
    const a = frames[end - PAIR_LAG], b = frames[end];
    const minutes = (b.t - a.t) / 60;
    if (minutes <= 0) continue;
    const maxShift = Math.ceil((MAX_KMH * minutes) / 60 / kpp);
    const s = shiftBetween(a, b, maxShift);
    if (s) vecs.push({ x: s.dx / minutes, y: s.dy / minutes });
  }
  if (vecs.length === 0) return null;

  const mx = vecs.reduce((s, v) => s + v.x, 0) / vecs.length;
  const my = vecs.reduce((s, v) => s + v.y, 0) / vecs.length;
  const kmh = Math.hypot(mx, my) * kpp * 60;
  const dir = toDeg(mx, my);
  const speeds = vecs.map((v) => Math.hypot(v.x, v.y) * kpp * 60).sort((p, q) => p - q);
  const median = speeds[Math.floor(speeds.length / 2)];
  const stable = vecs.length >= 2
    && kmh >= MIN_MOTION_KMH
    && vecs.every((v) => angleGap(toDeg(v.x, v.y), dir) <= MAX_DIR_SPREAD_DEG)
    && speeds.every((s) => s >= 0.6 * median && s <= 1.6 * median);
  return { pxPerMinX: mx, pxPerMinY: my, kmh, toDeg: dir, pairs: vecs.length, stable };
}
