import { describe, it, expect } from 'vitest';
import { assembleMosaic, kmPerPx, lonLatToPx, type RadarMosaic } from './radarDecode';
import { findRainCells } from './rainNowService';
import { pixelsByLabel, trackCells } from './radarTracking';

const BLOCK = { x0: 60, y0: 46, nx: 2, ny: 2 };
const T0 = Date.parse('2026-10-01T12:00:00Z') / 1000;
const BASE = { lat: 42.30, lon: -8.68 };

interface Blob { lon: number; lat: number; r: number; dbz: number }
/** `n` frames 10 min apart; `at(i)` gives the blobs of frame i (0 = oldest). */
function frames(n: number, at: (i: number) => Blob[]): RadarMosaic[] {
  const out: RadarMosaic[] = [];
  for (let i = 0; i < n; i++) {
    const m = assembleMosaic([], BLOCK, T0 + i * 600);
    for (const b of at(i)) {
      const [cx, cy] = lonLatToPx(m, b.lon, b.lat);
      for (let y = Math.floor(cy - b.r); y <= cy + b.r; y++) for (let x = Math.floor(cx - b.r); x <= cx + b.r; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= b.r && x >= 0 && y >= 0 && x < m.w && y < m.h) m.dbz[y * m.w + x] = Math.round(b.dbz - 8 * (d / b.r));
      }
    }
    out.push(m);
  }
  return out;
}
/** A point moved `km` towards `toDeg` from `p`. */
function move(p: { lat: number; lon: number }, km: number, toDeg: number) {
  const r = (toDeg * Math.PI) / 180;
  return { lat: p.lat + (Math.cos(r) * km) / 111.32, lon: p.lon + (Math.sin(r) * km) / (111.32 * Math.cos((p.lat * Math.PI) / 180)) };
}
function track(fs: RadarMosaic[]) {
  const newest = fs[fs.length - 1];
  const { cells, labels } = findRainCells(newest);
  const px = pixelsByLabel(labels);
  const t = trackCells(fs, cells.map((c) => c.id), (id) => px.get(id) ?? []);
  return cells.map((c) => ({ cell: c, t: t.get(c.id)! }));
}

describe('trackCells', () => {
  it('follows a patch moving at 40 km/h towards the east-north-east, steadily', () => {
    // 40 km/h = 6.67 km every 10 min; the patch ends at the base
    const fs = frames(10, (i) => [{ ...move(BASE, (9 - i) * -6.67, 70), r: 7, dbz: 40 }]);
    const [{ t }] = track(fs);
    expect(t.kind).toBe('moving');
    expect(t.steady).toBe(true);
    expect(t.kmh).toBeGreaterThan(34);
    expect(t.kmh).toBeLessThan(46);
    expect(Math.abs(t.toDeg - 70)).toBeLessThan(12);
  });

  it('calls a patch that stays put static (a fixed echo)', () => {
    const fs = frames(10, () => [{ ...BASE, r: 6, dbz: 30 }]);
    const [{ t }] = track(fs);
    expect(t.kind).toBe('static');
    expect(t.steady).toBe(false);
  });

  it('calls a core that appears where there was nothing new', () => {
    const fs = frames(10, (i) => (i >= 8 ? [{ ...BASE, r: 5, dbz: 42 }] : []));
    const [{ t }] = track(fs);
    expect(t.kind).toBe('new');
    expect(t.growthDbz).toBeNull();
  });

  it('does not call a fixed echo that blinks on and off new', () => {
    // there an hour ago, gone, back now: the same place, so not a newborn core
    const fs = frames(10, (i) => (i === 3 || i === 9 ? [{ ...BASE, r: 5, dbz: 28 }] : []));
    const [{ t }] = track(fs);
    expect(t.kind).toBe('static');
  });

  it('calls a patch with no past at the edge of the picture unclear, not new', () => {
    const m = assembleMosaic([], BLOCK, T0);
    const kpp = kmPerPx(m, 44.8);
    // two pixels inside the northern edge: it may have just come in from outside the radar picture
    const edge = { lat: 45.08 - (8 * kpp) / 111.32, lon: -8.5 };
    const fs = frames(10, (i) => (i === 9 ? [{ ...edge, r: 5, dbz: 35 }] : []));
    const [{ t }] = track(fs);
    expect(t.kind).toBe('unclear');
  });

  it('gives two patches their own headings', () => {
    const a0 = move(BASE, -40, 90), b0 = move(BASE, 40, 0);
    const fs = frames(10, (i) => [
      { ...move(a0, i * 5, 90), r: 6, dbz: 38 },    // 30 km/h towards the east
      { ...move(b0, i * 2.5, 0), r: 6, dbz: 38 },   // 15 km/h towards the north
    ]);
    const out = track(fs);
    const east = out.find((o) => o.cell.lat < BASE.lat + 0.1)!.t;
    const north = out.find((o) => o.cell.lat > BASE.lat + 0.1)!.t;
    expect(Math.abs(east.toDeg - 90)).toBeLessThan(12);
    expect(Math.abs(east.kmh - 30)).toBeLessThan(6);
    expect(north.toDeg < 12 || north.toDeg > 348).toBe(true);
    expect(Math.abs(north.kmh - 15)).toBeLessThan(5);
  });

  it('is not fooled by a neighbouring shower 25 km behind (one 30-min jump was)', () => {
    // a line of showers 25 km apart moving 20 km/h east: each must be matched to itself
    const start = move(BASE, -60, 90);
    const fs = frames(10, (i) => [0, 25, 50].map((k) => ({ ...move(start, k + i * 3.33, 90), r: 4, dbz: 36 })));
    for (const { t } of track(fs)) {
      expect(t.kind).toBe('moving');
      expect(Math.abs(t.kmh - 20)).toBeLessThan(6);
      expect(Math.abs(t.toDeg - 90)).toBeLessThan(15);
    }
  });

  it('cannot follow anything with fewer than four frames', () => {
    const fs = frames(3, () => [{ ...BASE, r: 6, dbz: 30 }]);
    expect(track(fs)[0].t.kind).toBe('unclear');
  });
});
