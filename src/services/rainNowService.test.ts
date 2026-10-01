import { describe, it, expect } from 'vitest';
import type { NormalizedReading, NormalizedStation } from '../types/station';
import { assembleMosaic, lonLatToPx, type RadarMosaic } from './radarDecode';
import {
  RAIN_GAUGE_BLACKLIST, classifyGauges, drawableCells, findRainCells, gaugeIntensity, groundTruth,
  rainArrivalAt, renderRain,
} from './rainNowService';
import type { RadarMotion } from './radarMotion';

// 15:00 and 06:00 in Madrid (CEST) on 1-oct-2026
const AFTERNOON = Date.parse('2026-10-01T15:00:00+02:00');
const DAWN = Date.parse('2026-10-01T06:00:00+02:00');
const BASE = { lat: 42.30, lon: -8.68 };
/** A point `km` east of the base */
const east = (km: number) => ({ lat: BASE.lat, lon: BASE.lon + km / (111.32 * Math.cos((BASE.lat * Math.PI) / 180)) });

function st(id: string, at = BASE): NormalizedStation {
  return { id, source: 'meteogalicia', name: id, lat: at.lat, lon: at.lon, altitude: 50 };
}
function rd(id: string, now: number, precip: number, solar: number | null = 0, minutesAgo = 5): NormalizedReading {
  return {
    stationId: id, timestamp: new Date(now - minutesAgo * 60_000), windSpeed: null, windGust: null, windDirection: null,
    temperature: 15, humidity: 95, precipitation: precip, solarRadiation: solar, pressure: null, dewPoint: null,
  };
}
function judge(now: number, list: { s: NormalizedStation; r: NormalizedReading; h?: NormalizedReading[] }[], radar?: RadarMosaic[]) {
  const out = classifyGauges({
    stations: list.map((x) => x.s),
    readings: new Map(list.map((x) => [x.s.id, x.r])),
    history: new Map(list.filter((x) => x.h).map((x) => [x.s.id, x.h!])),
    nowMs: now, radar,
  });
  return Object.fromEntries(out.map((g) => [g.id, g.verdict]));
}

describe('classifyGauges', () => {
  it('lets an official gauge stand alone only with real rain (0.6 mm in 30 min)', () => {
    expect(judge(AFTERNOON, [{ s: st('mg_1'), r: rd('mg_1', AFTERNOON, 0.3) }])).toEqual({ mg_1: 'alone' });
    expect(judge(AFTERNOON, [{ s: st('mg_1'), r: rd('mg_1', AFTERNOON, 0.7) }])).toEqual({ mg_1: 'rain' });
  });

  it('accepts an amateur gauge with a partner 1.5-8 km away, not with a twin next to it', () => {
    const counter = (id: string, mm: number) => ({ s: st(id), r: rd(id, AFTERNOON, mm), h: [rd(id, AFTERNOON, 1.0, 0, 40)] });
    const a = counter('wu_A', 1.4);
    const far = { ...counter('wu_B', 1.6), s: st('wu_B', east(3)) };
    const twin = { ...counter('wu_C', 1.6), s: st('wu_C', east(0.3)) };
    expect(judge(AFTERNOON, [a, far]).wu_A).toBe('rain');
    expect(judge(AFTERNOON, [a, twin]).wu_A).toBe('alone');
  });

  it('reads a day counter by its growth, not its total', () => {
    // 12 mm since midnight, nothing new in the last half hour
    const g = { s: st('wu_A'), r: rd('wu_A', AFTERNOON, 12), h: [rd('wu_A', AFTERNOON, 12, 0, 40)] };
    expect(judge(AFTERNOON, [g]).wu_A).toBe('dry');
  });

  it('calls dawn drops on amateur gauges dew unless an official gauge agrees', () => {
    const counter = (id: string, at = BASE) => ({ s: st(id, at), r: rd(id, DAWN, 0.3), h: [rd(id, DAWN, 0, 0, 40)] });
    const pair = [counter('mc_A'), counter('wu_B', east(3))];
    expect(judge(DAWN, pair)).toEqual({ mc_A: 'dew', wu_B: 'dew' });
    const official = { s: st('mg_9', east(5)), r: rd('mg_9', DAWN, 0.4) };
    expect(judge(DAWN, [...pair, official]).mc_A).toBe('rain');
  });

  it('never calls it rain with the sun out, or from a gauge that leaks', () => {
    expect(judge(AFTERNOON, [{ s: st('mg_1'), r: rd('mg_1', AFTERNOON, 1.2, 600) }])).toEqual({ mg_1: 'sun' });
    const leak = [...RAIN_GAUGE_BLACKLIST][0];
    expect(judge(AFTERNOON, [{ s: st(leak), r: rd(leak, AFTERNOON, 1.2) }])[leak]).toBe('blacklist');
  });

  it('lets radar echo over a lone gauge confirm it', () => {
    const m = assembleMosaic([], { x0: 60, y0: 46, nx: 2, ny: 2 }, AFTERNOON / 1000);
    const [px, py] = lonLatToPx(m, BASE.lon, BASE.lat);
    m.dbz[Math.floor(py) * m.w + Math.floor(px)] = 24;
    const g = { s: st('mg_1'), r: rd('mg_1', AFTERNOON, 0.3) };
    expect(judge(AFTERNOON, [g], [m]).mg_1).toBe('rain');
  });

  it('skips stale readings and networks whose rain field means nothing known', () => {
    expect(judge(AFTERNOON, [{ s: st('mg_1'), r: rd('mg_1', AFTERNOON, 2, 0, 50) }])).toEqual({});
    expect(judge(AFTERNOON, [{ s: st('skyx_1'), r: rd('skyx_1', AFTERNOON, 2) }])).toEqual({});
  });
});

describe('gaugeIntensity', () => {
  it('bands the half-hour rain as an hourly rate', () => {
    expect(gaugeIntensity(0.4)).toBe('debil');
    expect(gaugeIntensity(2)).toBe('moderada');
    expect(gaugeIntensity(6)).toBe('fuerte');
  });
});

// ── Radar cells and arrival ─────────────────────────────

function mosaicWith(blobs: { lon: number; lat: number; r: number; dbz: number }[]): RadarMosaic {
  const m = assembleMosaic([], { x0: 60, y0: 46, nx: 2, ny: 2 }, AFTERNOON / 1000);
  for (const b of blobs) {
    const [cx, cy] = lonLatToPx(m, b.lon, b.lat);
    for (let y = Math.floor(cy - b.r); y <= cy + b.r; y++) for (let x = Math.floor(cx - b.r); x <= cx + b.r; x++) {
      if (Math.hypot(x - cx, y - cy) <= b.r) m.dbz[y * m.w + x] = b.dbz;
    }
  }
  return m;
}
const gauge = (id: string, at: { lat: number; lon: number }, verdict: 'rain' | 'dry') =>
  ({ id, name: id, lon: at.lon, lat: at.lat, official: true, mm: verdict === 'rain' ? 1 : 0, verdict, radarDbz: null });

describe('findRainCells and groundTruth', () => {
  it('drops speckle and keeps real patches', () => {
    const { cells } = findRainCells(mosaicWith([{ ...east(-20), r: 1, dbz: 40 }, { ...BASE, r: 5, dbz: 28 }]));
    expect(cells).toHaveLength(1);
    expect(cells[0].maxDbz).toBe(28);
    expect(cells[0].lat).toBeCloseTo(BASE.lat, 1);
  });

  it('confirms a cell with rain measured under it and hides weak echo the gauges deny', () => {
    const m = mosaicWith([{ ...BASE, r: 6, dbz: 24 }, { ...east(-25), r: 6, dbz: 24 }, { ...east(25), r: 6, dbz: 36 }]);
    const { cells, labels } = findRainCells(m);
    const judged = groundTruth(cells, labels, m, [
      gauge('mg_wet', BASE, 'rain'),
      gauge('mg_d1', east(-25), 'dry'), gauge('mg_d2', east(-24), 'dry'),
      gauge('mg_d3', east(25), 'dry'), gauge('mg_d4', east(26), 'dry'),
    ]);
    const at = (km: number) => judged.find((c) => Math.abs(c.lon - east(km).lon) < 0.02)!;
    expect(at(0).ground).toBe('confirmed');
    expect(at(-25).ground).toBe('dry');
    const draw = drawableCells(judged);
    expect(draw.has(at(-25).id)).toBe(false);            // weak and denied: virga or clutter
    expect(draw.has(at(25).id)).toBe(true);              // strong: the gauges may just be late
    const pic = renderRain(m, labels, draw);
    expect(pic.some((v, i) => i % 4 === 3 && v > 0)).toBe(true);
  });
});

describe('drawableCells: fixed echoes (dry night of 1-oct)', () => {
  it('drops a small patch nobody confirms, and draws it once a gauge under it measured rain', () => {
    const m = mosaicWith([{ ...BASE, r: 2.5, dbz: 26 }]);           // ~20 px, like the Arbo echo
    const { cells, labels } = findRainCells(m);
    expect(cells).toHaveLength(1);
    expect(drawableCells(groundTruth(cells, labels, m, [])).size).toBe(0);
    expect(drawableCells(groundTruth(cells, labels, m, [gauge('mg_wet', BASE, 'rain')])).size).toBe(1);
  });

  it('draws nothing beyond 80 km of the sector', () => {
    const far = { lat: 41.39, lon: -8.21 };                           // the 40 px echo over Braga
    const m = mosaicWith([{ ...far, r: 6, dbz: 30 }]);
    const { cells } = findRainCells(m);
    expect(drawableCells(cells).size).toBe(1);
    expect(drawableCells(cells, { lon: -8.68, lat: 42.30 }).size).toBe(0);
  });
});

describe('rainArrivalAt', () => {
  const m = mosaicWith([{ ...east(-15), r: 4, dbz: 32 }]);
  const { cells, labels } = findRainCells(m);
  const draw = drawableCells(cells);
  // 30 km/h towards the east, in pixels per minute (~0.9 km per pixel)
  const kpp = 0.903;
  const motion = (stable: boolean, to: 'east' | 'west' = 'east'): RadarMotion =>
    ({ pxPerMinX: (to === 'east' ? 1 : -1) * 30 / 60 / kpp, pxPerMinY: 0, kmh: 30, toDeg: to === 'east' ? 90 : 270, pairs: 3, stable });

  it('times a band moving towards the point', () => {
    const a = rainArrivalAt(BASE, m, labels, draw, motion(true))!;
    // the near edge is ~11 km away at 30 km/h
    expect(a.etaMin).toBeGreaterThanOrEqual(20);
    expect(a.etaMin).toBeLessThanOrEqual(25);
    expect(a.maxDbz).toBe(32);
  });

  it('announces nothing when the band moves away or the motion is not stable', () => {
    expect(rainArrivalAt(BASE, m, labels, draw, motion(true, 'west'))).toBeNull();
    expect(rainArrivalAt(BASE, m, labels, draw, motion(false))).toBeNull();
  });

  it('says it is raining there now when the point is under the echo', () => {
    expect(rainArrivalAt(east(-15), m, labels, draw, null)).toEqual({ etaMin: 0, distanceKm: 0, maxDbz: 32 });
  });
});
