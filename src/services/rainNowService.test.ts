import { describe, it, expect } from 'vitest';
import type { NormalizedReading, NormalizedStation } from '../types/station';
import { assembleMosaic, lonLatToPx, type RadarMosaic } from './radarDecode';
import {
  RAIN_GAUGE_BLACKLIST, announcingTracks, approachingCells, classifyGauges, drawableCells, echoWorthFollowing, findRainCells, formatEta,
  gaugeIntensity, groundTruth, rainArrivalAt, renderRain, roundEta,
} from './rainNowService';
import type { CellTrack } from './radarTracking';

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

  it('a gauge at zero under a storm core is mute, not dry, and does not dry out its cell (6-oct)', () => {
    const m = assembleMosaic([], { x0: 60, y0: 46, nx: 2, ny: 2 }, AFTERNOON / 1000);
    const [px, py] = lonLatToPx(m, BASE.lon, BASE.lat);
    m.dbz[Math.floor(py) * m.w + Math.floor(px)] = 52;
    const silent = (id: string, at = BASE) => ({ s: st(id, at), r: rd(id, AFTERNOON, 3), h: [rd(id, AFTERNOON, 3, 0, 40)] });
    expect(judge(AFTERNOON, [silent('wu_A')], [m]).wu_A).toBe('mute');
    // weak echo over it: an honest «dry» vote
    m.dbz[Math.floor(py) * m.w + Math.floor(px)] = 20;
    expect(judge(AFTERNOON, [silent('wu_A')], [m]).wu_A).toBe('dry');
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

// A cell's track, as radarTracking would give it (~0.905 km per pixel at 42.3° N, zoom 7).
const KPP = 0.905;
function track(kind: CellTrack['kind'], kmh = 0, toDeg = 90, steady = true): CellTrack {
  const r = (toDeg * Math.PI) / 180;
  const pxMin = kmh / 60 / KPP;
  return { kind, vx: Math.sin(r) * pxMin, vy: -Math.cos(r) * pxMin, kmh, toDeg, steady, growthDbz: 0, fit: 0.9 };
}
const tracksFor = (cells: { id: number }[], t: CellTrack) => new Map(cells.map((c) => [c.id, t]));

describe('rainArrivalAt: each cell with its own track', () => {
  const m = mosaicWith([{ ...east(-15), r: 4, dbz: 32 }]);
  const { cells, labels } = findRainCells(m);
  const draw = drawableCells(cells);

  it('times a cell moving steadily towards the point', () => {
    const a = rainArrivalAt(BASE, m, labels, draw, tracksFor(cells, track('moving', 30, 90)))!;
    // the near edge is ~11 km away at 30 km/h
    expect(a.etaMin).toBeGreaterThanOrEqual(20);
    expect(a.etaMin).toBeLessThanOrEqual(25);
    expect(a.maxDbz).toBe(32);
  });

  it('announces nothing from echo that moves away, wanders, stays or was just born', () => {
    expect(rainArrivalAt(BASE, m, labels, draw, tracksFor(cells, track('moving', 30, 270)))).toBeNull();
    expect(rainArrivalAt(BASE, m, labels, draw, tracksFor(cells, track('moving', 30, 90, false)))).toBeNull();
    expect(rainArrivalAt(BASE, m, labels, draw, tracksFor(cells, track('static')))).toBeNull();
    expect(rainArrivalAt(BASE, m, labels, draw, tracksFor(cells, track('new')))).toBeNull();
    expect(rainArrivalAt(BASE, m, labels, draw, null)).toBeNull();
  });

  it('uses each cell its own heading: of two cells, only the one coming is announced', () => {
    const two = mosaicWith([{ ...east(-15), r: 4, dbz: 32 }, { ...east(15), r: 4, dbz: 40 }]);
    const found = findRainCells(two);
    const west = found.cells.find((c) => c.lon < BASE.lon)!, eastCell = found.cells.find((c) => c.lon > BASE.lon)!;
    const tracks = new Map([[west.id, track('moving', 30, 90)], [eastCell.id, track('moving', 30, 90)]]);
    const a = rainArrivalAt(BASE, two, found.labels, drawableCells(found.cells), tracks)!;
    expect(a.maxDbz).toBe(32);                               // the eastern one moves away, east
  });

  it('reaches 90 min, said to 10 min beyond the hour', () => {
    const far = mosaicWith([{ ...east(-40), r: 4, dbz: 32 }]);     // ~36 km of road at 30 km/h
    const f = findRainCells(far);
    const a = rainArrivalAt(BASE, far, f.labels, drawableCells(f.cells), tracksFor(f.cells, track('moving', 30, 90)))!;
    expect(a.etaMin).toBeGreaterThan(60);
    expect(a.etaMin % 10).toBe(0);
    expect(rainArrivalAt(BASE, far, f.labels, drawableCells(f.cells), tracksFor(f.cells, track('moving', 15, 90)))).toBeNull();
  });

  it('says it is raining there now when the point is under the echo', () => {
    expect(rainArrivalAt(east(-15), m, labels, draw, null)).toEqual({ etaMin: 0, distanceKm: 0, maxDbz: 32 });
  });
});

describe('drawableCells with tracks', () => {
  it('drops echo that stays put unless a gauge under it measured rain', () => {
    const m = mosaicWith([{ ...BASE, r: 6, dbz: 28 }]);
    const { cells, labels } = findRainCells(m);
    const still = tracksFor(cells, track('static'));
    expect(drawableCells(groundTruth(cells, labels, m, []), BASE, { tracks: still }).size).toBe(0);
    expect(drawableCells(groundTruth(cells, labels, m, [gauge('mg_wet', BASE, 'rain')]), BASE, { tracks: still }).size).toBe(1);
  });

  it('draws rain that is coming from as far as 160 km, and nothing else beyond 80', () => {
    const m = mosaicWith([{ ...east(-120), r: 6, dbz: 34 }]);
    const { cells } = findRainCells(m);
    expect(drawableCells(cells, BASE).size).toBe(0);
    expect(drawableCells(cells, BASE, { coming: new Set([cells[0].id]) }).size).toBe(1);
  });
});

describe('approachingCells: rain seen before it arrives', () => {
  const m = mosaicWith([{ ...east(-90), r: 10, dbz: 34 }]);   // ~310 px, ~255 km²
  const { cells } = findRainCells(m);

  it('announces rain 90 km out heading for the sector, with the time it enters it', () => {
    const [a] = approachingCells(cells, tracksFor(cells, track('moving', 40, 90)), m, BASE, 40);
    expect(a).toBeDefined();
    // ~50 km from the circle to its centre minus its own radius (~9 km): the leading edge
    expect(a.distanceKm).toBeGreaterThanOrEqual(38);
    expect(a.distanceKm).toBeLessThanOrEqual(44);
    expect(Math.round(a.fromDeg)).toBeGreaterThanOrEqual(265);    // it comes from the west
    expect(Math.round(a.fromDeg)).toBeLessThanOrEqual(275);
    // at 40 km/h: about an hour
    expect(a.etaMin).toBeGreaterThanOrEqual(55);
    expect(a.etaMin).toBeLessThanOrEqual(75);
  });

  it('gives a distance and a time that agree with the speed it prints', () => {
    // Measuring to the centre and timing to the edge read «a 30 km a 35 km/h, entraria en ~35 min».
    const [a] = approachingCells(cells, tracksFor(cells, track('moving', 40, 90)), m, BASE, 40);
    const minutesAtSpeed = (a.distanceKm / 40) * 60;
    expect(Math.abs(minutesAtSpeed - a.etaMin)).toBeLessThanOrEqual(10);   // the ETA is rounded
  });

  it('ignores rain moving away, passing by, wandering, standing still or already inside', () => {
    expect(approachingCells(cells, tracksFor(cells, track('moving', 40, 270)), m, BASE, 40)).toEqual([]);
    expect(approachingCells(cells, tracksFor(cells, track('moving', 40, 0)), m, BASE, 40)).toEqual([]);
    expect(approachingCells(cells, tracksFor(cells, track('moving', 40, 90, false)), m, BASE, 40)).toEqual([]);
    expect(approachingCells(cells, tracksFor(cells, track('static')), m, BASE, 40)).toEqual([]);
    const inside = mosaicWith([{ ...east(-20), r: 10, dbz: 34 }]);
    const ins = findRainCells(inside);
    expect(approachingCells(ins.cells, tracksFor(ins.cells, track('moving', 40, 90)), inside, BASE, 40)).toEqual([]);
  });

  it('ignores what would take more than two hours, and patches too small or too weak', () => {
    expect(approachingCells(cells, tracksFor(cells, track('moving', 15, 90)), m, BASE, 40)).toEqual([]);
    const shower = mosaicWith([{ ...east(-90), r: 6, dbz: 40 }]);                // ~110 px: a shower
    const sh = findRainCells(shower);
    expect(approachingCells(sh.cells, tracksFor(sh.cells, track('moving', 40, 90)), shower, BASE, 40)).toEqual([]);
    const weak = mosaicWith([{ ...east(-90), r: 10, dbz: 22 }]);
    const w = findRainCells(weak);
    expect(approachingCells(w.cells, tracksFor(w.cells, track('moving', 40, 90)), weak, BASE, 40)).toEqual([]);
    const small = mosaicWith([{ ...east(-90), r: 2.5, dbz: 34 }]);
    const sm = findRainCells(small);
    expect(approachingCells(sm.cells, tracksFor(sm.cells, track('moving', 40, 90)), small, BASE, 40)).toEqual([]);
  });
});

describe('announcingTracks', () => {
  it('keeps the steady tracks of rain areas only, not of showers or of wandering echo', () => {
    const m = mosaicWith([{ ...east(-60), r: 10, dbz: 34 }, { ...east(60), r: 6, dbz: 40 }]);
    const { cells } = findRainCells(m);
    const big = cells.find((c) => c.lon < BASE.lon)!, small = cells.find((c) => c.lon > BASE.lon)!;
    const steady = tracksFor(cells, track('moving', 40, 90));
    expect([...announcingTracks(cells, steady)!.keys()]).toEqual([big.id]);
    expect(announcingTracks(cells, tracksFor(cells, track('moving', 40, 90, false)))!.size).toBe(0);
    expect(announcingTracks(cells, null)).toBeNull();
    expect(small.pixels).toBeLessThan(250);
  });
});

describe('echoWorthFollowing: the cheap look on a dry day', () => {
  it('asks for the history only with echo that could become an announcement', () => {
    expect(echoWorthFollowing(mosaicWith([]), BASE)).toBe(false);
    expect(echoWorthFollowing(mosaicWith([{ ...east(-90), r: 6, dbz: 34 }]), BASE)).toBe(true);
    expect(echoWorthFollowing(mosaicWith([{ ...east(-90), r: 6, dbz: 22 }]), BASE)).toBe(false);   // weak
    expect(echoWorthFollowing(mosaicWith([{ ...east(-90), r: 2.5, dbz: 34 }]), BASE)).toBe(false); // speckle-sized
  });
});

describe('roundEta / formatEta', () => {
  it('says minutes to 5 within the hour and to 10 beyond', () => {
    expect(roundEta(2)).toBe(5);
    expect(roundEta(23)).toBe(25);
    expect(roundEta(74)).toBe(70);
    expect(formatEta(25)).toBe('~25 min');
    expect(formatEta(60)).toBe('~1 h');
    expect(formatEta(90)).toBe('~1 h 30');
  });
});
