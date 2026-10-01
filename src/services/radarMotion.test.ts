import { describe, it, expect } from 'vitest';
import { assembleMosaic, kmPerPx, type RadarMosaic } from './radarDecode';
import { estimateMotion, shiftBetween } from './radarMotion';

const BLOCK = { x0: 60, y0: 46, nx: 2, ny: 2 };

/** A band of rain (a soft-edged ellipse) centred at (cx, cy) pixels. */
function frame(t: number, cx: number, cy: number, rx = 40, ry = 18, peak = 42): RadarMosaic {
  const m = assembleMosaic([], BLOCK, t);
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d < 1) m.dbz[y * m.w + x] = Math.round(peak - 22 * d);
    }
  }
  return m;
}

describe('shiftBetween', () => {
  it('measures the shift of a band', () => {
    expect(shiftBetween(frame(0, 200, 250), frame(1800, 212, 244), 40)).toEqual({ dx: 12, dy: -6 });
  });

  it('gives up when a frame has almost no rain', () => {
    expect(shiftBetween(frame(0, 200, 250, 3, 3), frame(1800, 210, 250, 3, 3), 40)).toBeNull();
  });
});

describe('estimateMotion', () => {
  const kpp = kmPerPx(frame(0, 0, 0, 1, 1), 42.6);

  it('reads a steady drift east as stable, at the right speed', () => {
    // 4 px every 10 min towards the east
    const frames = Array.from({ length: 10 }, (_, i) => frame(i * 600, 150 + 4 * i, 260));
    const m = estimateMotion(frames)!;
    expect(m.stable).toBe(true);
    expect(m.pairs).toBe(3);
    expect(m.toDeg).toBeCloseTo(90, 0);
    expect(m.kmh).toBeCloseTo(4 * 6 * kpp, 0);
  });

  it('calls rain that does not move not stable (no arrow, no arrival)', () => {
    const frames = Array.from({ length: 10 }, (_, i) => frame(i * 600, 250, 250));
    const m = estimateMotion(frames)!;
    expect(m.kmh).toBeLessThan(1);
    expect(m.stable).toBe(false);
  });

  it('calls jumps in different directions not stable', () => {
    const pos = [[150, 260], [150, 260], [150, 260], [170, 260], [170, 260], [170, 260], [170, 240], [170, 240], [170, 240], [150, 240]];
    const m = estimateMotion(pos.map(([x, y], i) => frame(i * 600, x, y)))!;
    expect(m.stable).toBe(false);
  });

  it('needs at least four frames', () => {
    expect(estimateMotion([frame(0, 100, 100), frame(600, 104, 100)])).toBeNull();
  });
});
