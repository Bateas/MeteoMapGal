/**
 * «Lloviendo ahora»: where it rains, measured, and where the rain is heading.
 *
 * Two observations, each doing what it does well (measured 1-oct-2026 over 7 rainy and 3 dry
 * days of stored readings; kept outside this repository):
 *  - The RADAR draws the area. Gauges alone cannot: leaving one official gauge out and painting
 *    8 km around the others caught 45 % of the rain at that gauge, with 30 % false alarms, and
 *    on showery days an official neighbour 25 km away was wet only 14-46 % of the time.
 *  - The GAUGES say the rain reached the ground, and veto radar echo that did not.
 *
 * A wet gauge only counts after these checks, each one measured:
 *  - sun out (>= 250 W/m²): not rain now (1.2 % of real rain readings had that much sun);
 *  - gauges that leak (RAIN_GAUGE_BLACKLIST);
 *  - an amateur gauge needs a second wet gauge 1.5-8 km away (twin stations of one owner, a few
 *    metres apart, confirmed each other's dew) or radar echo over it; in dry days no amateur
 *    reading had an official confirmation, in rainy days 81-93 % had one;
 *  - at dawn (4-10 h, <= 0.4 mm) an amateur reading is dew unless an OFFICIAL gauge or the radar
 *    agrees: that is when 68-78 % of the dry-day false readings happened;
 *  - an official gauge alone needs 0.6 mm in 30 min, or a partner, or radar.
 * Together: false dots on 3 dry days went from 670 to 20 min in the Rías and from 450 to 0 in
 * the Embalse; on rainy days 84 % of the wet readings stay, and only 3.5 % of the ones dropped
 * had an official gauge nearby saying it rained (radar rescues the rest when it sees them).
 * Humidity is NOT a check: 12 % of real rain fell with it under 85 %, and dew happens at 96-99 %.
 *
 * Pure: no fetch, no DOM.
 */

import type { NormalizedReading, NormalizedStation } from '../types/station';
import { precipKindFor, precipSamplesFromHistory, rainInWindowMm } from './precipSemantics';
import { NO_ECHO, kmPerPx, lonLatToPx, maxDbzNear, pxToLonLat, type RadarMosaic } from './radarDecode';
import type { CellTrack } from './radarTracking';

// ── Thresholds (see the header for where each comes from) ────────────────

/** Rain window, minutes. MeteoGalicia publishes every 10 min with some delay. */
export const RAIN_WINDOW_MIN = 30;
const MIN_RAIN_MM = 0.2;
const OFFICIAL_ALONE_MM = 0.6;
const SUN_WM2 = 250;
const PAIR_MIN_KM = 1.5;
const PAIR_MAX_KM = 8;
const DAWN_FROM_H = 4;
const DAWN_TO_H = 10;
const DAWN_MAX_MM = 0.4;
/** Radar echo over a gauge that counts as seeing precipitation there. */
const RADAR_CONFIRM_DBZ = 15;
const RADAR_CONFIRM_KM = 2;
const MAX_READING_AGE_MIN = 30;
/** Echo drawn as rain: ~0.6 mm/h and up. Sea clutter off the Rías sits at 10-15 dBZ. */
export const RAIN_CELL_DBZ = 20;
/** Smaller patches are speckle (fixed echoes in the hills of Vila Real on a dry night). */
const MIN_CELL_PX = 6;

/**
 * Gauges whose rain readings are not rain. Same idea as WIND_BLACKLIST: one line of evidence each.
 */
export const RAIN_GAUGE_BLACKLIST = new Set<string>([
  // Sobrada (Tomiño): wet on all 9 dry days of 17-25 sep 2026, 34 h and 19 mm with humidity ~75 %
  // while every neighbour stayed dry. A dripping or leaking gauge.
  'mg_10177',
]);

export const isOfficialGauge = (id: string) => /^(mg_|aemet_|ipma_)/.test(id);

// ── Gauges ───────────────────────────────────────────────

export type GaugeVerdict =
  | 'rain'       // measured rain that passed the checks
  | 'dry'        // fresh reading, no rain in the window
  | 'sun'        // wet reading with the sun out
  | 'blacklist'  // a gauge known to leak
  | 'dew'        // amateur at dawn, nobody official agrees
  | 'alone';     // wet with no partner and no radar to back it

export interface GaugeRain {
  id: string;
  name: string;
  lon: number;
  lat: number;
  official: boolean;
  /** Rain in the last RAIN_WINDOW_MIN minutes, mm */
  mm: number;
  verdict: GaugeVerdict;
  /** Strongest echo within 2 km over the last two frames; null without radar */
  radarDbz: number | null;
}

function madridHour(ms: number): number {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: 'numeric', hourCycle: 'h23' }).format(new Date(ms));
  return Number(h);
}

function distKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dx = (aLon - bLon) * 111.32 * Math.cos(((aLat + bLat) / 2) * Math.PI / 180);
  return Math.hypot(dx, (aLat - bLat) * 111.32);
}

/**
 * Every gauge with a fresh reading, judged. `radar` holds the latest mosaics (oldest first);
 * without it the checks fall back to gauges only.
 */
export function classifyGauges(opts: {
  stations: NormalizedStation[];
  readings: Map<string, NormalizedReading>;
  history?: Map<string, NormalizedReading[]>;
  nowMs: number;
  radar?: RadarMosaic[] | null;
}): GaugeRain[] {
  const { stations, readings, history, nowMs } = opts;
  const recent = (opts.radar ?? []).slice(-2);
  const dawn = (() => { const h = madridHour(nowMs); return h >= DAWN_FROM_H && h <= DAWN_TO_H; })();

  type Cand = GaugeRain & { sunny: boolean };
  const cands: Cand[] = [];
  for (const s of stations) {
    if (precipKindFor(s.id) === null) continue;
    const r = readings.get(s.id);
    if (!r || nowMs - r.timestamp.getTime() > MAX_READING_AGE_MIN * 60_000) continue;
    const mm = rainInWindowMm(s.id, precipSamplesFromHistory(history?.get(s.id), r), nowMs, RAIN_WINDOW_MIN);
    if (mm == null) continue;
    let radarDbz: number | null = null;
    if (recent.length) {
      radarDbz = NO_ECHO;
      for (const m of recent) radarDbz = Math.max(radarDbz, maxDbzNear(m, s.lon, s.lat, RADAR_CONFIRM_KM));
    }
    cands.push({
      id: s.id, name: s.name, lon: s.lon, lat: s.lat, official: isOfficialGauge(s.id), mm,
      verdict: 'dry', radarDbz, sunny: r.solarRadiation != null && r.solarRadiation >= SUN_WM2,
    });
  }

  const wet = cands.filter((c) => c.mm >= MIN_RAIN_MM && !c.sunny && !RAIN_GAUGE_BLACKLIST.has(c.id));
  const partnerAt = (c: Cand, officialOnly: boolean, minKm: number) => wet.some((o) => {
    if (o.id === c.id || (officialOnly && !o.official)) return false;
    const d = distKm(c.lat, c.lon, o.lat, o.lon);
    return d >= minKm && d <= PAIR_MAX_KM;
  });

  return cands.map(({ sunny, ...c }) => {
    if (c.mm < MIN_RAIN_MM) return { ...c, verdict: 'dry' as const };
    if (sunny) return { ...c, verdict: 'sun' as const };
    if (RAIN_GAUGE_BLACKLIST.has(c.id)) return { ...c, verdict: 'blacklist' as const };
    const radarSees = c.radarDbz != null && c.radarDbz >= RADAR_CONFIRM_DBZ;
    const cand = { ...c, sunny } as Cand;
    if (!c.official && dawn && c.mm <= DAWN_MAX_MM) {
      return { ...c, verdict: (radarSees || partnerAt(cand, true, 0) ? 'rain' : 'dew') as GaugeVerdict };
    }
    const ok = radarSees || partnerAt(cand, false, PAIR_MIN_KM) || (c.official && c.mm >= OFFICIAL_ALONE_MM);
    return { ...c, verdict: (ok ? 'rain' : 'alone') as GaugeVerdict };
  });
}

/** Coarse intensity of a gauge's rain over the window. */
export function gaugeIntensity(mmInWindow: number): 'debil' | 'moderada' | 'fuerte' {
  const perHour = mmInWindow * (60 / RAIN_WINDOW_MIN);
  if (perHour < 2) return 'debil';
  if (perHour < 10) return 'moderada';
  return 'fuerte';
}

// ── Radar cells ──────────────────────────────────────────

export type CellGround = 'confirmed' | 'dry' | 'unknown';

export interface RainCell {
  id: number;
  pixels: number;
  areaKm2: number;
  maxDbz: number;
  /** Centroid */
  lon: number;
  lat: number;
  /** A gauge under it measured rain / gauges under it are dry / no gauge under it */
  ground: CellGround;
}

/** Connected patches of echo >= RAIN_CELL_DBZ (8-neighbour), with the label of every pixel (0 = none). */
export function findRainCells(m: RadarMosaic): { cells: RainCell[]; labels: Int32Array } {
  const labels = new Int32Array(m.w * m.h);
  const cells: RainCell[] = [];
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < m.w * m.h; start++) {
    if (labels[start] !== 0 || m.dbz[start] < RAIN_CELL_DBZ) continue;
    const id = ++next;
    let n = 0, sx = 0, sy = 0, max = NO_ECHO;
    const members: number[] = [];
    labels[start] = id; stack.push(start);
    while (stack.length) {
      const p = stack.pop() as number;
      members.push(p);
      const x = p % m.w, y = (p - x) / m.w;
      n++; sx += x; sy += y; if (m.dbz[p] > max) max = m.dbz[p];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((dx || dy) && nx >= 0 && ny >= 0 && nx < m.w && ny < m.h) {
          const q = ny * m.w + nx;
          if (labels[q] === 0 && m.dbz[q] >= RAIN_CELL_DBZ) { labels[q] = id; stack.push(q); }
        }
      }
    }
    if (n < MIN_CELL_PX) {
      for (const p of members) labels[p] = -1;            // speckle: remembered, never drawn
      continue;
    }
    const [lon, lat] = pxToLonLat(m, sx / n + 0.5, sy / n + 0.5);
    const kpp = kmPerPx(m, lat);
    cells.push({ id, pixels: n, areaKm2: Math.round(n * kpp * kpp), maxDbz: max, lon, lat, ground: 'unknown' });
  }
  return { cells, labels };
}

/**
 * What the gauges under each cell say. Confirmed: a gauge within 2 km measured rain. Dry: two or
 * more gauges right under it read dry (and none wet). Otherwise unknown (sea, or no gauge there).
 */
export function groundTruth(cells: RainCell[], labels: Int32Array, m: RadarMosaic, gauges: GaugeRain[]): RainCell[] {
  const byId = new Map(cells.map((c) => [c.id, { wet: 0, dry: 0 }]));
  for (const g of gauges) {
    const [px, py] = lonLatToPx(m, g.lon, g.lat);
    const r = g.verdict === 'rain' ? Math.ceil(RADAR_CONFIRM_KM / kmPerPx(m, g.lat)) : 0;
    const seen = new Set<number>();
    for (let y = Math.floor(py) - r; y <= Math.floor(py) + r; y++) {
      for (let x = Math.floor(px) - r; x <= Math.floor(px) + r; x++) {
        if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
        const id = labels[y * m.w + x];
        if (id > 0) seen.add(id);
      }
    }
    for (const id of seen) {
      const t = byId.get(id);
      if (!t) continue;
      if (g.verdict === 'rain') t.wet++;
      else if (g.verdict === 'dry') t.dry++;
    }
  }
  return cells.map((c) => {
    const t = byId.get(c.id)!;
    return { ...c, ground: t.wet > 0 ? 'confirmed' : t.dry >= 2 ? 'dry' : 'unknown' };
  });
}

/** An unconfirmed patch smaller than this is not drawn (~25 km² at 42° N). On the dry night of
 *  1-oct the radar showed patches of 12-20 px and up to 27 dBZ near Arbo in four frames running,
 *  and of 15-16 px off Baiona: fixed echoes, not rain. A gauge that measured rain under a patch
 *  lets it through at any size. */
export const MIN_UNCONFIRMED_CELL_PX = 30;
/** Rain drawn only this far from the sector centre: a 40 px, 30 dBZ fixed echo sat over Braga. */
export const DRAW_MAX_KM = 80;
/** ...except rain that moves steadily towards the sector, drawn from this far out (still inside
 *  the radar picture of Galicia, which reaches ~200 km west of the Rías). */
export const DRAW_FAR_KM = 160;

/** The echo checks of drawableCells, without the distance. */
function echoWorthDrawing(c: RainCell): boolean {
  if (c.ground === 'dry' && c.maxDbz < 30) return false;
  if (c.ground !== 'confirmed' && c.pixels < MIN_UNCONFIRMED_CELL_PX) return false;
  return true;
}

/**
 * Cells worth drawing: not weak echo the gauges under it deny (virga, clutter), not a small patch
 * nobody confirms, not echo that has stayed in the same place for half an hour with no gauge
 * confirming it (`tracks`: that is how the radar's fixed echoes look), and not far from the
 * sector unless it is coming (`coming`, see approachingCells), which is drawn out to DRAW_FAR_KM.
 */
export function drawableCells(
  cells: RainCell[],
  centre?: { lon: number; lat: number },
  opts: { coming?: Set<number>; tracks?: Map<number, CellTrack> | null } = {},
): Set<number> {
  return new Set(cells.filter((c) => {
    if (!echoWorthDrawing(c)) return false;
    if (c.ground !== 'confirmed' && opts.tracks?.get(c.id)?.kind === 'static') return false;
    if (centre) {
      const d = distKm(c.lat, c.lon, centre.lat, centre.lon);
      if (d > (opts.coming?.has(c.id) ? DRAW_FAR_KM : DRAW_MAX_KM)) return false;
    }
    return true;
  }).map((c) => c.id));
}

// ── Arrival ──────────────────────────────────────────────

/** Echo strong enough to announce: ~1.3 mm/h. */
const ETA_MIN_DBZ = 25;
const ETA_CORRIDOR_KM = 3;
/** Furthest arrival announced at a spot. Beyond the hour it is said coarsely (to 10 min). */
export const ARRIVAL_MAX_MIN = 90;
/** Furthest rain announced as coming towards the sector. */
export const APPROACH_MAX_MIN = 120;

export interface RainArrival {
  /** 0 = raining there now */
  etaMin: number;
  distanceKm: number;
  maxDbz: number;
}

/** A track that may carry an arrival: moving, with a heading that repeated. */
const carries = (t: CellTrack | undefined): t is CellTrack => !!t && t.kind === 'moving' && t.steady;

/**
 * An arrival is announced only from a sizeable rain area (~200 km² at 42° N). Replayed on 1-oct
 * against what the radar showed afterwards: on a front over Germany and the Low Countries 77 % of
 * the announcements came (79 % from patches this size, which kept 198 of 218), within 10 min of
 * the time said for 3 in 5; on scattered showers over Portugal in weak wind, only 4 of 10 came.
 * A shower lives 30-60 min and its heading does not hold; storms have the lightning tracker.
 */
export const MIN_ANNOUNCE_PX = 250;

/** The tracks an arrival may be announced from: steady and big enough (see MIN_ANNOUNCE_PX). */
export function announcingTracks(cells: RainCell[], tracks: Map<number, CellTrack> | null): Map<number, CellTrack> | null {
  if (!tracks) return null;
  const out = new Map<number, CellTrack>();
  for (const c of cells) {
    const t = tracks.get(c.id);
    if (carries(t) && c.pixels >= MIN_ANNOUNCE_PX) out.set(c.id, t);
  }
  return out;
}

/** Minutes rounded as they are said: to 5 within the hour, to 10 beyond. */
export function roundEta(min: number): number {
  return min <= 60 ? Math.max(5, Math.round(min / 5) * 5) : Math.round(min / 10) * 10;
}

/** «~25 min», «~1 h», «~1 h 30». */
export function formatEta(min: number): string {
  if (min < 60) return `~${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m === 0 ? `~${h} h` : `~${h} h ${m}`;
}

/**
 * When the rain reaches a point: the first drawable echo >= 25 dBZ whose OWN steady track
 * (radarTracking) passes within 3 km of the point, within ARRIVAL_MAX_MIN. Echo that stays still,
 * was born just now or wanders is never announced as coming. Null when nothing comes.
 */
export function rainArrivalAt(
  point: { lon: number; lat: number },
  m: RadarMosaic,
  labels: Int32Array,
  drawable: Set<number>,
  tracks: Map<number, CellTrack> | null,
): RainArrival | null {
  const [cx, cy] = lonLatToPx(m, point.lon, point.lat);
  const kpp = kmPerPx(m, point.lat);
  const r0 = RADAR_CONFIRM_KM / kpp;
  let nowMax = NO_ECHO;
  for (let y = Math.floor(cy - r0); y <= Math.ceil(cy + r0); y++) {
    for (let x = Math.floor(cx - r0); x <= Math.ceil(cx + r0); x++) {
      if (x < 0 || y < 0 || x >= m.w || y >= m.h) continue;
      const i = y * m.w + x;
      if (drawable.has(labels[i]) && m.dbz[i] > nowMax) nowMax = m.dbz[i];
    }
  }
  if (nowMax >= ETA_MIN_DBZ) return { etaMin: 0, distanceKm: 0, maxDbz: nowMax };
  if (!tracks) return null;

  let fastest = 0;
  for (const id of drawable) {
    const t = tracks.get(id);
    if (carries(t)) fastest = Math.max(fastest, Math.hypot(t.vx, t.vy));
  }
  if (fastest === 0) return null;
  const reach = fastest * ARRIVAL_MAX_MIN;
  const corridor = ETA_CORRIDOR_KM / kpp;
  let best: RainArrival | null = null;
  for (let y = Math.max(0, Math.floor(cy - reach)); y <= Math.min(m.h - 1, Math.ceil(cy + reach)); y++) {
    for (let x = Math.max(0, Math.floor(cx - reach)); x <= Math.min(m.w - 1, Math.ceil(cx + reach)); x++) {
      const i = y * m.w + x;
      if (m.dbz[i] < ETA_MIN_DBZ || !drawable.has(labels[i])) continue;
      const t = tracks.get(labels[i]);
      if (!carries(t)) continue;
      const speed = Math.hypot(t.vx, t.vy);
      const ux = t.vx / speed, uy = t.vy / speed;
      const vx = cx - x, vy = cy - y;                 // from the echo to the point
      const along = vx * ux + vy * uy;
      if (along <= 0) continue;                        // moving away from the point
      if (Math.abs(vx * uy - vy * ux) > corridor) continue;
      const eta = along / speed;
      if (eta > ARRIVAL_MAX_MIN) continue;
      if (!best || eta < best.etaMin) best = { etaMin: eta, distanceKm: along * kpp, maxDbz: m.dbz[i] };
    }
  }
  if (!best) return null;
  return { ...best, etaMin: roundEta(best.etaMin), distanceKm: Math.round(best.distanceKm) };
}

export interface RainApproach {
  cellId: number;
  lon: number;
  lat: number;
  /** Along its track, from the cell's leading edge to the sector circle, km: the same distance
   *  etaMin is computed over, so «a X km a Y km/h» and the ETA agree for whoever reads them. */
  distanceKm: number;
  /** Bearing from the sector centre to the cell, degrees (where it comes FROM) */
  fromDeg: number;
  kmh: number;
  /** Heading it moves towards */
  toDeg: number;
  /** Until its leading edge reaches the sector circle, rounded as said */
  etaMin: number;
  maxDbz: number;
  areaKm2: number;
}

/**
 * Rain outside the sector that is heading into it: a cell with a steady track (moving, heading
 * repeated over two half-hours), echo >= 25 dBZ and the size checks of drawableCells, whose
 * leading edge reaches the sector circle within APPROACH_MAX_MIN. Soonest first.
 */
export function approachingCells(
  cells: RainCell[],
  tracks: Map<number, CellTrack> | null,
  m: RadarMosaic,
  centre: { lon: number; lat: number },
  radiusKm: number,
): RainApproach[] {
  if (!tracks) return [];
  const out: RainApproach[] = [];
  for (const c of cells) {
    const t = tracks.get(c.id);
    if (!carries(t) || c.maxDbz < ETA_MIN_DBZ || c.pixels < MIN_ANNOUNCE_PX || !echoWorthDrawing(c)) continue;
    const dist = distKm(c.lat, c.lon, centre.lat, centre.lon);
    if (dist <= radiusKm || dist > DRAW_FAR_KM) continue;
    const pxSpeed = Math.hypot(t.vx, t.vy);
    const speed = pxSpeed * kmPerPx(m, c.lat);                       // km per minute
    const ux = t.vx / pxSpeed, uy = -t.vy / pxSpeed;                 // east, north
    const dx = (centre.lon - c.lon) * 111.32 * Math.cos(((c.lat + centre.lat) / 2) * Math.PI / 180);
    const dy = (centre.lat - c.lat) * 111.32;
    const along = dx * ux + dy * uy;
    if (along <= 0) continue;                                        // moving away
    const perp = Math.abs(dx * uy - dy * ux);
    const reachR = radiusKm + Math.sqrt(c.areaKm2 / Math.PI);        // circle plus the cell's own size
    if (perp > reachR) continue;                                     // passes by
    // The centre of a 40 km band sits ~10 km behind its leading edge: measuring the distance to the
    // centre and the time to the edge printed «a 30 km a 35 km/h, entraria en ~35 min».
    const entryKm = Math.max(0, along - Math.sqrt(reachR * reachR - perp * perp));
    const eta = entryKm / speed;
    if (eta > APPROACH_MAX_MIN) continue;
    out.push({
      cellId: c.id, lon: c.lon, lat: c.lat, distanceKm: Math.round(entryKm),
      fromDeg: (Math.atan2(-dx, -dy) * 180 / Math.PI + 360) % 360,
      kmh: t.kmh, toDeg: t.toDeg, etaMin: roundEta(eta), maxDbz: c.maxDbz, areaKm2: c.areaKm2,
    });
  }
  return out.sort((a, b) => a.etaMin - b.etaMin);
}

/**
 * The cheap look on a dry day: is there echo in the newest frame that could become an
 * announcement (>= 25 dBZ, big enough to draw unconfirmed, within DRAW_FAR_KM)? Only then is the
 * last hour and a half of radar fetched to follow it.
 */
export function echoWorthFollowing(m: RadarMosaic, centre: { lon: number; lat: number }): boolean {
  return findRainCells(m).cells.some((c) => c.maxDbz >= ETA_MIN_DBZ && c.pixels >= MIN_UNCONFIRMED_CELL_PX
    && distKm(c.lat, c.lon, centre.lat, centre.lon) <= DRAW_FAR_KM);
}

// ── Picture ──────────────────────────────────────────────

/** Our three tones (light, moderate, heavy) as RGBA. Low alpha on purpose: start faint, raise on request. */
const TONES: [number, number, number, number][] = [
  [96, 165, 250, 51],   // 20-30 dBZ  ~0.6-2.7 mm/h   (alpha 0.20)
  [37, 99, 235, 82],    // 30-40 dBZ  ~2.7-11 mm/h    (0.32)
  [124, 58, 237, 115],  // >= 40 dBZ  > 11 mm/h       (0.45)
];
export function toneFor(dbz: number): 0 | 1 | 2 {
  return dbz >= 40 ? 2 : dbz >= 30 ? 1 : 0;
}

/** RGBA picture of the drawable cells, same size as the mosaic, for an image source. */
export function renderRain(m: RadarMosaic, labels: Int32Array, drawable: Set<number>): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(m.w * m.h * 4);
  for (let i = 0; i < m.w * m.h; i++) {
    if (m.dbz[i] < RAIN_CELL_DBZ || !drawable.has(labels[i])) continue;
    const c = TONES[toneFor(m.dbz[i])];
    out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = c[3];
  }
  return out;
}
