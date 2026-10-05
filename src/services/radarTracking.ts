/**
 * Each rain cell followed back through its own past radar frames, so the rain layer can tell
 * apart three things that look the same in a single picture:
 *  - rain that MOVES (it was somewhere else 30 min ago): the only echo an arrival is announced
 *    from, with its OWN speed and heading, not one arrow for the whole radar;
 *  - echo that STAYS (the radar's fixed echoes over hills and sea, or rain stuck on a mountain):
 *    never announced as coming;
 *  - a core BORN in the last 30 min where there was nothing (showers and storms that come out of
 *    nowhere). A fixed echo that blinks on and off is not one: its place had echo before.
 *
 * Matching is per cell, on its own pixels: the shift that best lays the cell onto the frame
 * 30 min earlier (least squared difference of reflectivity), coarse then fine, as radarMotion
 * does for the whole picture. A heading is called steady when two consecutive 30-min pairs agree,
 * or when its one pair agrees with a stable motion of the whole radar.
 * Pure: no fetch, no DOM.
 */

import { NO_ECHO, kmPerPx, pxToLonLat, type RadarMosaic } from './radarDecode';
import type { RadarMotion } from './radarMotion';

/** Frames between the two ends of a pair (10 min each): 30 min, see radarMotion. */
const PAIR_LAG = 3;
/** Fastest rain considered, km/h. */
const MAX_KMH = 100;
/** Slower than this a cell stays where it is (one pixel in 30 min is ~2 km/h at zoom 7). */
export const MIN_MOVE_KMH = 5;
/** The match must explain at least this share of the cell's echo, or the cell has no clear past. */
const MIN_FIT = 0.5;
/** Echo that counts as "something was there" in a past frame (the rain-cell threshold). */
const PRESENT_DBZ = 20;
/** Share of a "new" cell's place that must have had echo in some earlier frame to call it a blinking fixed echo. */
const BLINK_SHARE = 0.3;
/** Echo that counts for that test: lower than PRESENT_DBZ, a fixed echo flickers around the rain threshold
 *  (one near Melgaço on 1-oct read 20 dBZ in one frame and 15-19 in the ones before). */
const BLINK_DBZ = 15;
/** Earlier frames searched for echo in the same place before a cell is called new (all of them, up to 90 min). */
const BLINK_FRAMES = 9;
const STEADY_DIR_DEG = 35;
const STEADY_SPEED_LO = 0.6;
const STEADY_SPEED_HI = 1.6;
/** Pixels used in the coarse search: big bands are subsampled, the fine search uses them all. */
const COARSE_PIXELS = 400;

export type CellKind = 'moving' | 'static' | 'new' | 'unclear';

export interface CellTrack {
  kind: CellKind;
  /** Velocity, pixels per minute (x east, y south); 0 unless moving */
  vx: number;
  vy: number;
  kmh: number;
  /** Heading it moves TOWARDS, degrees from north */
  toDeg: number;
  /** Two pairs agree, or one pair agrees with a stable motion of the whole radar */
  steady: boolean;
  /** dBZ gained in 30 min at its matched past place; null without a past */
  growthDbz: number | null;
  /** Share of the cell's echo explained by the match, 0-1 */
  fit: number;
}

/** Matching weight of a pixel: as radarMotion (nothing under 15 dBZ, capped at 55). */
function weight(v: number): number {
  return v === NO_ECHO || v < 15 ? 0 : Math.min(v, 55) - 14;
}

const toDeg = (x: number, y: number) => ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
const angleGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/**
 * The shift (dx, dy) such that the echo at pixel p of `cur` was at p - (dx, dy) in `prev`, with
 * the share of echo it explains. Among near-equal answers, the one closest to `prior` (the whole
 * radar's shift, or none) wins, so a cell in a train of bands is not matched to its neighbour.
 */
export function matchBack(
  pixels: number[], cur: RadarMosaic, prev: RadarMosaic, maxShiftPx: number,
  prior: { dx: number; dy: number } = { dx: 0, dy: 0 },
): { dx: number; dy: number; fit: number } | null {
  const { w, h } = cur;
  const n = pixels.length;
  if (n === 0 || prev.w !== w || prev.h !== h) return null;
  const xs = new Int32Array(n), ys = new Int32Array(n), wc = new Float32Array(n);
  let e0 = 0;
  for (let k = 0; k < n; k++) {
    const p = pixels[k];
    xs[k] = p % w; ys[k] = (p - xs[k]) / w;
    wc[k] = weight(cur.dbz[p]);
    e0 += wc[k] * wc[k];
  }
  if (e0 === 0) return null;
  const err = (dx: number, dy: number, step: number) => {
    let s = 0, m = 0;
    for (let k = 0; k < n; k += step) {
      const qx = xs[k] - dx, qy = ys[k] - dy;
      const wp = qx < 0 || qy < 0 || qx >= w || qy >= h ? 0 : weight(prev.dbz[qy * w + qx]);
      const d = wc[k] - wp;
      s += d * d; m++;
    }
    return s / m;
  };
  const mean0 = e0 / n;
  const pick = (cands: { dx: number; dy: number; e: number }[]) => {
    const best = Math.min(...cands.map((c) => c.e));
    let out = cands[0], outGap = Infinity;
    for (const c of cands) {
      if (c.e > best * 1.02 + 1e-9) continue;
      const gap = Math.hypot(c.dx - prior.dx, c.dy - prior.dy);
      if (gap < outGap) { out = c; outGap = gap; }
    }
    return out;
  };

  const step = Math.max(1, Math.ceil(n / COARSE_PIXELS));
  const R = Math.ceil(maxShiftPx);
  const coarse: { dx: number; dy: number; e: number }[] = [];
  for (let dy = -R; dy <= R; dy += 2) {
    for (let dx = -R; dx <= R; dx += 2) {
      if (Math.hypot(dx, dy) > maxShiftPx + 1) continue;
      coarse.push({ dx, dy, e: err(dx, dy, step) });
    }
  }
  const c = pick(coarse);
  const fine: { dx: number; dy: number; e: number }[] = [];
  for (let dy = c.dy - 1; dy <= c.dy + 1; dy++) {
    for (let dx = c.dx - 1; dx <= c.dx + 1; dx++) fine.push({ dx, dy, e: err(dx, dy, 1) });
  }
  const f = pick(fine);
  return { dx: f.dx, dy: f.dy, fit: Math.max(0, 1 - f.e / mean0) };
}

/**
 * The track of every cell in the newest frame. `pixelsOf` gives a cell's pixel indices
 * (from the labels of findRainCells). Cells within reach of the picture's edge that have no past
 * are 'unclear', not 'new': they may have just come in from outside it.
 */
export function trackCells(
  frames: RadarMosaic[],
  cellIds: number[],
  pixelsOf: (id: number) => number[],
  wholeMotion: RadarMotion | null = null,
): Map<number, CellTrack> {
  const out = new Map<number, CellTrack>();
  const N = frames.length - 1;
  const none = (kind: CellKind, fit = 0): CellTrack => ({ kind, vx: 0, vy: 0, kmh: 0, toDeg: 0, steady: false, growthDbz: null, fit });
  if (N < PAIR_LAG) {
    for (const id of cellIds) out.set(id, none('unclear'));
    return out;
  }
  const cur = frames[N], prev = frames[N - PAIR_LAG];
  const minutes = (cur.t - prev.t) / 60;
  const kpp = kmPerPx(cur, pxToLonLat(cur, cur.w / 2, cur.h / 2)[1]);
  const maxShift = minutes > 0 ? (MAX_KMH * minutes) / 60 / kpp : 0;
  const prior = wholeMotion?.stable
    ? { dx: Math.round(wholeMotion.pxPerMinX * minutes), dy: Math.round(wholeMotion.pxPerMinY * minutes) }
    : { dx: 0, dy: 0 };
  const edge = Math.ceil(maxShift);

  for (const id of cellIds) {
    const px = pixelsOf(id);
    if (px.length === 0 || minutes <= 0) { out.set(id, none('unclear')); continue; }
    let curMax = NO_ECHO, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (const p of px) {
      if (cur.dbz[p] > curMax) curMax = cur.dbz[p];
      const x = p % cur.w, y = (p - x) / cur.w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const nearEdge = x0 < edge || y0 < edge || x1 >= cur.w - edge || y1 >= cur.h - edge;

    // Walked back one frame at a time: in 10 min no rain moves more than ~17 km, so a cell is
    // not mistaken for its neighbour, which one 30-min jump did in a cluster of showers.
    const m1 = chainBack(frames, N, PAIR_LAG, px, kpp, prior);
    const pastMax = m1 ? maxAt(prev, px, m1.dx, m1.dy) : NO_ECHO;
    if (!m1 || m1.fit < MIN_FIT || pastMax < PRESENT_DBZ) {
      if (blinks(frames, px)) out.set(id, none('static', m1?.fit ?? 0));
      else out.set(id, none(nearEdge ? 'unclear' : 'new', m1?.fit ?? 0));
      continue;
    }
    const v1 = { x: m1.dx / minutes, y: m1.dy / minutes };
    const kmh1 = Math.hypot(v1.x, v1.y) * kpp * 60;
    const growthDbz = curMax - pastMax;
    if (kmh1 < MIN_MOVE_KMH) {
      out.set(id, { ...none('static', m1.fit), growthDbz });
      continue;
    }

    // Second pair: the same echo, 30 min further back.
    let v = v1, steady = false;
    if (N >= 2 * PAIR_LAG) {
      const older = frames[N - 2 * PAIR_LAG];
      const minutes2 = (prev.t - older.t) / 60;
      const shifted: number[] = [];
      for (const p of px) {
        const x = (p % cur.w) - m1.dx, y = Math.floor(p / cur.w) - m1.dy;
        if (x >= 0 && y >= 0 && x < cur.w && y < cur.h) shifted.push(y * cur.w + x);
      }
      const m2 = minutes2 > 0
        ? chainBack(frames, N - PAIR_LAG, PAIR_LAG, shifted, kpp, { dx: Math.round(m1.dx), dy: Math.round(m1.dy) })
        : null;
      if (m2 && m2.fit >= MIN_FIT) {
        const v2 = { x: m2.dx / minutes2, y: m2.dy / minutes2 };
        const kmh2 = Math.hypot(v2.x, v2.y) * kpp * 60;
        const mid = (kmh1 + kmh2) / 2;
        if (kmh2 >= MIN_MOVE_KMH && angleGap(toDeg(v1.x, v1.y), toDeg(v2.x, v2.y)) <= STEADY_DIR_DEG
          && kmh1 >= STEADY_SPEED_LO * mid && kmh1 <= STEADY_SPEED_HI * mid
          && kmh2 >= STEADY_SPEED_LO * mid && kmh2 <= STEADY_SPEED_HI * mid) {
          steady = true;
          v = { x: (v1.x + v2.x) / 2, y: (v1.y + v2.y) / 2 };
        }
      }
    }
    if (!steady && wholeMotion?.stable) {
      const r = kmh1 / wholeMotion.kmh;
      steady = angleGap(toDeg(v1.x, v1.y), wholeMotion.toDeg) <= STEADY_DIR_DEG && r >= STEADY_SPEED_LO && r <= STEADY_SPEED_HI;
    }
    out.set(id, {
      kind: 'moving', vx: v.x, vy: v.y, kmh: Math.hypot(v.x, v.y) * kpp * 60, toDeg: toDeg(v.x, v.y),
      steady, growthDbz, fit: m1.fit,
    });
  }
  return out;
}

/**
 * Total shift of a cell over `steps` frames back from frames[from], matched one frame at a time,
 * each step's prior being the step before (rain keeps its heading over 10 min). `fit` is the
 * worst step: a cell that did not exist at some step has no past that far back.
 */
function chainBack(
  frames: RadarMosaic[], from: number, steps: number, pixels: number[], kpp: number,
  prior: { dx: number; dy: number },
): { dx: number; dy: number; fit: number } | null {
  let mask = pixels, tx = 0, ty = 0, fit = 1;
  let stepPrior = { dx: Math.round(prior.dx / steps), dy: Math.round(prior.dy / steps) };
  for (let k = 0; k < steps; k++) {
    const cur = frames[from - k], prev = frames[from - k - 1];
    if (!cur || !prev) return null;
    const minutes = (cur.t - prev.t) / 60;
    if (minutes <= 0) return null;
    const m = matchBack(mask, cur, prev, (MAX_KMH * minutes) / 60 / kpp, stepPrior);
    if (!m) return null;
    fit = Math.min(fit, m.fit);
    tx += m.dx; ty += m.dy;
    stepPrior = { dx: m.dx, dy: m.dy };
    const back: number[] = [];
    for (const p of mask) {
      const x = (p % cur.w) - m.dx, y = Math.floor(p / cur.w) - m.dy;
      if (x >= 0 && y >= 0 && x < cur.w && y < cur.h) back.push(y * cur.w + x);
    }
    if (back.length === 0) return null;
    mask = back;
  }
  return { dx: tx, dy: ty, fit };
}

function maxAt(m: RadarMosaic, pixels: number[], dx: number, dy: number): number {
  let max = NO_ECHO;
  for (const p of pixels) {
    const x = (p % m.w) - dx, y = Math.floor(p / m.w) - dy;
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
    const v = m.dbz[y * m.w + x];
    if (v > max) max = v;
  }
  return max;
}

/** Did the cell's own place have echo 40-90 min ago? (a fixed echo that blinks). The last half hour
 *  is left out: a core born 20 min ago is already there in the frames just before. */
function blinks(frames: RadarMosaic[], pixels: number[]): boolean {
  const N = frames.length - 1;
  for (let k = PAIR_LAG + 1; k <= BLINK_FRAMES && N - k >= 0; k++) {
    const f = frames[N - k];
    let hit = 0;
    for (const p of pixels) if (f.dbz[p] >= BLINK_DBZ) hit++;
    if (hit >= BLINK_SHARE * pixels.length) return true;
  }
  return false;
}

/** Pixel indices of every labelled cell, in one pass over the labels. */
export function pixelsByLabel(labels: Int32Array): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i];
    if (id <= 0) continue;
    let list = out.get(id);
    if (!list) { list = []; out.set(id, list); }
    list.push(i);
  }
  return out;
}
