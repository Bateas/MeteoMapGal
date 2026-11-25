import { describe, expect, it } from 'vitest';
import { gaugeWetNow, renderPastRain, WET_NOW_MAX_AGE_MIN } from './rainNowService';
import { NO_ECHO, type RadarMosaic } from './radarDecode';

function mosaic(w: number, h: number, t: number, wet: Record<number, number>): RadarMosaic {
  const dbz = new Int8Array(w * h).fill(NO_ECHO);
  for (const [i, v] of Object.entries(wet)) dbz[Number(i)] = v;
  return { z: 7, x0: 60, y0: 46, nx: 1, ny: 1, w, h, dbz, t };
}
const alphaAt = (rgba: Uint8ClampedArray, i: number) => rgba[i * 4 + 3];

describe('renderPastRain: an earlier frame, only around what is drawn now', () => {
  const W = 20, H = 20;
  const at = (x: number, y: number) => y * W + x;
  // Now: a drawn patch (label 1) at (10,10) and a patch that is NOT drawn (label 2) at (2,2).
  const now = mosaic(W, H, 1200, { [at(10, 10)]: 30, [at(2, 2)]: 30 });
  const labels = new Int32Array(W * H);
  labels[at(10, 10)] = 1;
  labels[at(2, 2)] = 2;
  const drawn = new Set([1]);

  it('paints past echo within reach of a drawn patch, in its own tone', () => {
    const past = mosaic(W, H, 600, { [at(8, 9)]: 45 });
    const out = renderPastRain(past, now, labels, drawn, 3);
    expect(alphaAt(out, at(8, 9))).toBeGreaterThan(0);
    // 45 dBZ is the heavy tone (violet), not the tone of the patch it leads to
    expect([out[at(8, 9) * 4], out[at(8, 9) * 4 + 1], out[at(8, 9) * 4 + 2]]).toEqual([124, 58, 237]);
  });

  it('leaves out past echo farther than the reach', () => {
    const past = mosaic(W, H, 600, { [at(15, 10)]: 30, [at(10, 4)]: 30 });
    const out = renderPastRain(past, now, labels, drawn, 3);
    expect(alphaAt(out, at(15, 10))).toBe(0);
    expect(alphaAt(out, at(10, 4))).toBe(0);
  });

  it('does not bring back, in the past, a patch that is not drawn now', () => {
    const past = mosaic(W, H, 600, { [at(2, 2)]: 35, [at(3, 3)]: 35 });
    const out = renderPastRain(past, now, labels, drawn, 3);
    expect(alphaAt(out, at(2, 2))).toBe(0);
    expect(alphaAt(out, at(3, 3))).toBe(0);
  });

  it('ignores echo under the rain threshold and reaches the edge of the picture without wrapping', () => {
    const edgeNow = mosaic(W, H, 1200, { [at(19, 5)]: 30 });
    const edgeLabels = new Int32Array(W * H);
    edgeLabels[at(19, 5)] = 1;
    const past = mosaic(W, H, 600, { [at(18, 5)]: 10, [at(17, 5)]: 25, [at(0, 6)]: 25 });
    const out = renderPastRain(past, edgeNow, edgeLabels, drawn, 2);
    expect(alphaAt(out, at(18, 5))).toBe(0);
    expect(alphaAt(out, at(17, 5))).toBeGreaterThan(0);
    // (0,6) is next to (19,5) only in a flat array, not on the map
    expect(alphaAt(out, at(0, 6))).toBe(0);
  });

  it('paints nothing with a frame of another size or with nothing drawn', () => {
    const other = mosaic(10, 10, 600, { 5: 40 });
    expect(renderPastRain(other, now, labels, drawn, 5).some((v) => v !== 0)).toBe(false);
    const past = mosaic(W, H, 600, { [at(10, 10)]: 40 });
    expect(renderPastRain(past, now, labels, new Set(), 5).some((v) => v !== 0)).toBe(false);
  });
});

describe('gaugeWetNow: measuring rain now, not only in the last half hour', () => {
  const NOW = Date.UTC(2026, 10, 11, 16, 20);
  const min = (m: number) => NOW - m * 60_000;

  it('an interval gauge whose newest reading carries rain', () => {
    expect(gaugeWetNow('mg_10109', [{ t: min(20), mm: 0 }, { t: min(10), mm: 0.2 }], NOW)).toBe(true);
  });

  it('not when it rained earlier and the newest reading is dry', () => {
    expect(gaugeWetNow('mg_10109', [{ t: min(20), mm: 0.6 }, { t: min(10), mm: 0 }], NOW)).toBe(false);
  });

  it('not when the wet reading is old', () => {
    expect(gaugeWetNow('aemet_1690A', [{ t: min(WET_NOW_MAX_AGE_MIN + 5), mm: 1 }], NOW)).toBe(false);
  });

  it('a day counter that grew between its last two readings, and one that did not', () => {
    expect(gaugeWetNow('mc_ESGAL01', [{ t: min(43), mm: 12.7 }, { t: min(28), mm: 13.5 }], NOW)).toBe(true);
    expect(gaugeWetNow('mc_ESGAL01', [{ t: min(35), mm: 3.4 }, { t: min(20), mm: 3.4 }], NOW)).toBe(false);
  });

  it('a day counter with a single reading, or whose last step spans a long gap, says nothing', () => {
    expect(gaugeWetNow('mc_ESGAL01', [{ t: min(10), mm: 3.4 }], NOW)).toBe(false);
    expect(gaugeWetNow('mc_ESGAL01', [{ t: min(200), mm: 1 }, { t: min(10), mm: 3.4 }], NOW)).toBe(false);
  });

  it('a reading stamped in the future is not trusted', () => {
    expect(gaugeWetNow('mg_10109', [{ t: NOW + 7 * 3600_000, mm: 1 }], NOW)).toBe(false);
  });

  it('never a rolling-hour gauge, nor an unknown network, nor no readings', () => {
    expect(gaugeWetNow('nt_70ee50', [{ t: min(5), mm: 2 }], NOW)).toBe(false);
    expect(gaugeWetNow('skyx_SKY100', [{ t: min(5), mm: 2 }], NOW)).toBe(false);
    expect(gaugeWetNow('mg_10109', [], NOW)).toBe(false);
  });
});
