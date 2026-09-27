/**
 * Surf Verdict Engine — wave-based scoring for surf spots.
 *
 * Base level from wave height:
 *   Flat (<0.3m) → Peque (0.3-0.8m) → Surf OK (0.8-1.5m) → Clásico (1.5-2.5m) → Grande (>2.5m)
 *
 * Modifiers (cap +1 total):
 *   - Offshore wind: +1 (olas limpias)
 *   - Onshore wind: -1 (mar revuelto)
 *   - Swell period >=10s + aligned: +1 (swell de calidad)
 *   - Short period <5s: -1 (mar de viento)
 *
 * Hard floors:
 *   - CLÁSICO needs >= 1.0m effective waves
 *   - GRANDE needs >= 1.8m effective waves
 *
 * ONE place decides the surf verdict. Before, four surfaces each computed it
 * their own way — the marker from a copy without wind, the popup from a second
 * download at a different hour, the list from the wind verdict and a tide gauge
 * — so one beach could read PEQUE on the map and SURF OK in its own card in the
 * same minute. Now `useSurfMarineData` builds a `SurfWaveEntry` with
 * `buildSurfEntry` and every surface only reads it, through
 * `surfDisplayState` / `surfView`, which also carry the engine's hard gate.
 *
 * The wave height at a beach is a MODEL value: nobody measures waves on these
 * beaches. Every surface that prints it says so (`~`, «modelo»).
 */
import type { MarineForecastHour } from '../api/marineClient';
import type { SailingSpot } from '../config/spots';
import type { SpotScore } from './spotScoringEngine';
import { isDirVariable, PROVISIONAL_LABEL } from '../config/verdictStyles';
import { STALE_THRESHOLD_MIN } from '../config/constants';

export interface SurfVerdictResult {
  /** 0 FLAT · 1 PEQUE · 2 SURF OK · 3 CLÁSICO · 4 GRANDE */
  level: 0 | 1 | 2 | 3 | 4;
  label: string;
  /** Accent: marker ring and badge border, always drawn on a dark surface */
  color: string;
  /** Text on a dark surface (marker badge, card, sidebar and ticker in dark) */
  text: string;
  /** Text on a light panel (sidebar and ticker in the light theme) */
  lightText: string;
  bg: string;
  summary: string;
}

// Summaries describe the sea, never who it suits or whether to go in: that is
// the reader's call («informa, nunca autoriza», as sportWarningService). The
// old PEQUE line called Corrubedo «ideal para iniciarse» while its own card
// says «Solo intermedio-avanzado».
const LEVELS: SurfVerdictResult[] = [
  { level: 0, label: 'FLAT',    color: '#94a3b8', text: '#94a3b8', lightText: '#475569', bg: 'rgba(100,116,139,0.15)', summary: 'Mar plano — sin olas para surf' },
  { level: 1, label: 'PEQUE',   color: '#22d3ee', text: '#67e8f9', lightText: '#155e75', bg: 'rgba(34,211,238,0.12)',  summary: 'Olas pequeñas' },
  { level: 2, label: 'SURF OK', color: '#3b82f6', text: '#93c5fd', lightText: '#1d4ed8', bg: 'rgba(59,130,246,0.12)',  summary: 'Olas surfeables' },
  { level: 3, label: 'CLÁSICO', color: '#22c55e', text: '#4ade80', lightText: '#166534', bg: 'rgba(34,197,94,0.12)',   summary: 'Día clásico — olas limpias y consistentes' },
  { level: 4, label: 'GRANDE',  color: '#f97316', text: '#fdba74', lightText: '#9a3412', bg: 'rgba(249,115,22,0.12)',  summary: 'Mar grande — solo con experiencia' },
];

/**
 * Compute how well a swell direction aligns with a beach orientation.
 * Returns a multiplier 0.3→1.0:
 *   - Frontal swell (0° diff) = 1.0
 *   - 45° angle = ~0.85
 *   - 90° lateral = 0.5
 *   - Behind the beach (>120°) = 0.3
 *
 * Use to adjust coastalFactor dynamically: effectiveFactor = baseFactor × alignment
 */
export function swellAlignmentMultiplier(swellDir: number, beachOrientation: number): number {
  // Beach faces beachOrientation degrees — swell should come FROM that direction
  // Angle between swell direction and beach face
  const diff = Math.abs(((swellDir - beachOrientation + 540) % 360) - 180);
  // cos-based decay: 0° = 1.0, 90° = 0.5, 180° = 0.3
  if (diff <= 90) return 1.0 - (diff / 90) * 0.5; // 1.0 → 0.5
  return 0.3; // behind the beach — minimal exposure
}

export function computeSurfVerdict(
  waveHeight: number,
  period: number,
  isOffshore: boolean,
  isOnshore: boolean,
  swellAligned = true,
): SurfVerdictResult {
  // Base wave level (0-4) — determined by ACTUAL wave height
  let level: number;
  if (waveHeight < 0.3) level = 0;       // FLAT
  else if (waveHeight < 0.8) level = 1;  // PEQUE
  else if (waveHeight < 1.5) level = 2;  // SURF OK
  else if (waveHeight < 2.5) level = 3;  // CLÁSICO
  else level = 4;                         // GRANDE

  const baseLevel = level;
  const warnings: string[] = [];
  let bonus = 0;

  // Wind quality (affects wave cleanliness, not size)
  if (isOffshore && level > 0) {
    bonus += 1;
    warnings.push('viento offshore (olas limpias)');
  }
  if (isOnshore && level > 0) {
    bonus -= 1;
    warnings.push('viento onshore (mar revuelto)');
  }

  // Period quality — only bonus if swell direction aligns with beach
  if (period >= 10 && level >= 1 && swellAligned) {
    bonus += 1;
    warnings.push(`periodo ${period.toFixed(0)}s (swell de calidad)`);
  } else if (period >= 10 && level >= 1 && !swellAligned) {
    warnings.push(`periodo ${period.toFixed(0)}s (swell cruzado)`);
  } else if (period > 0 && period < 5 && level >= 1) {
    bonus -= 1;
    warnings.push(`periodo ${period.toFixed(0)}s (mar de viento)`);
  }

  // Apply bonus but CAP at +1 from base
  level = Math.max(0, Math.min(4, baseLevel + Math.max(-2, Math.min(1, bonus))));

  // Hard floors: modifiers can't create size that isn't there
  if (level >= 3 && waveHeight < 1.0) level = 2; // CLÁSICO needs >= 1.0m
  if (level === 4 && waveHeight < 1.8) level = 3; // GRANDE needs >= 1.8m

  const result = { ...LEVELS[level] };
  // Level 0 reached through the modifiers, not the sea: there ARE waves, just
  // not surfable ones, and «Mar plano» beside «~0,7 m» contradicted itself.
  if (level === 0 && baseLevel > 0) result.summary = 'Sin olas surfeables';

  // Technical detail line
  const detail: string[] = [];
  detail.push(formatSurfWave(waveHeight));
  if (period > 0) detail.push(`${period.toFixed(0)}s`);
  if (warnings.length > 0) detail.push(warnings.join(', '));
  result.summary += ` (${detail.join(' · ')})`;

  return result;
}

// ── From a forecast hour and the spot's wind to one verdict ──────────
//
// The tolerances below are the ones SpotPopup used when it was the only
// surface that applied wind: offshore within 45° of any offshoreWindDir,
// onshore within 50° of the beach orientation, swell "aligned" within 45° of
// any swellDirections. They moved here unchanged; whether they are right is a
// separate question (see the notes in the task report), not this file's.

/** What the engine needs to know about a surf spot. */
export type SurfSpotShape = Pick<SailingSpot, 'coastalFactor' | 'beachOrientation' | 'offshoreWindDir' | 'swellDirections'>;

/** What it needs from the spot's score: the consensus wind the popup shows. */
export type SurfWindSource = Pick<SpotScore, 'provisional' | 'wind'>;

/** Used when a surf spot has no coastalFactor of its own. */
export const DEFAULT_COASTAL_FACTOR = 0.85;

/** A forecast hour further than this from now is not "now". Not a surf
 *  threshold: the sources are hourly, so a valid array always has an hour
 *  within 30 min of now, and this only trips when the whole array is stale. */
export const SURF_HOUR_MAX_OFFSET_MS = 90 * 60_000;

/** Angular distance between two compass directions, 0-180°. */
function angleDiff(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

export function isOffshoreWind(spot: SurfSpotShape, windDirDeg: number | null): boolean {
  return windDirDeg != null && spot.offshoreWindDir
    ? spot.offshoreWindDir.some((d) => angleDiff(windDirDeg, d) < 45)
    : false;
}

export function isOnshoreWind(spot: SurfSpotShape, windDirDeg: number | null): boolean {
  return windDirDeg != null && spot.beachOrientation != null
    ? angleDiff(windDirDeg, spot.beachOrientation) < 50
    : false;
}

/** No swell direction → assumed aligned (conservative, as before). */
export function isSwellAligned(spot: SurfSpotShape, swellDir: number | null): boolean {
  return swellDir != null && spot.swellDirections
    ? spot.swellDirections.some((d) => angleDiff(swellDir, d) < 45)
    : true;
}

/** The forecast hour closest to `nowMs`, or null when none is within `maxOffsetMs`. */
export function nearestHour<T extends { time: Date }>(
  hours: readonly T[],
  nowMs: number,
  maxOffsetMs: number = SURF_HOUR_MAX_OFFSET_MS,
): T | null {
  let best: T | null = null;
  let bestDt = Infinity;
  for (const h of hours) {
    const dt = Math.abs(h.time.getTime() - nowMs);
    if (dt < bestDt) { best = h; bestDt = dt; }
  }
  return best && bestDt <= maxOffsetMs ? best : null;
}

/** True when the hour carries a wave height at all (a null is missing data,
 *  never a flat sea). */
function hasWave(h: MarineForecastHour): boolean {
  return (h.swellHeight ?? h.waveHeight) != null;
}

// ── Is the sector's reading set still arriving? ──────────────────────
//
// The engine's cold-load rule, mirrored (spotScoringEngine, `readingSetPartial`
// in scoreAllSpots): with 8 or more discovered stations, the set is clearly
// partial while fewer than 40% of them carry a fresh reading. The engine keeps
// surf spots out of its provisional flag on purpose, so a surf spot with no
// wind consensus could mean two things: its stations have not landed yet
// (cold load: wait) or they did and read under 1 kt, or are down (calm glassy
// morning: decide without wind). Only this tells them apart. A test runs both
// on the same inputs so the two copies cannot drift.

export const READING_SET_MIN_STATIONS = 8;
export const READING_SET_FRESH_RATIO = 0.4;

export function isReadingSetPartial(
  stationCount: number,
  readings: Iterable<{ timestamp?: Date | null }>,
  nowMs: number,
): boolean {
  if (stationCount < READING_SET_MIN_STATIONS) return false;
  const freshMs = STALE_THRESHOLD_MIN * 60_000;
  let fresh = 0;
  for (const r of readings) {
    const t = r.timestamp?.getTime?.();
    if (t != null && nowMs - t <= freshMs) fresh++;
  }
  return fresh < stationCount * READING_SET_FRESH_RATIO;
}

export interface BeachWave {
  /** Open-sea model height before any correction (m) */
  rawHeight: number;
  /** Height at the beach: raw × coastalFactor × swell alignment (m) — MODEL */
  height: number;
  /** Swell period, or the sea's when the source does not split swell (s) */
  period: number;
  /** Where the swell (or the sea) comes FROM (°), null when the source has none */
  swellDir: number | null;
  /** swellAlignmentMultiplier, 1 when there is no direction */
  alignment: number;
}

/** One forecast hour turned into the wave at THIS beach. */
export function beachWaveAt(spot: SurfSpotShape, h: MarineForecastHour): BeachWave {
  const rawHeight = h.swellHeight ?? h.waveHeight ?? 0;
  const swellDir = h.swellDirection ?? h.waveDirection ?? null;
  const alignment = swellDir != null && spot.beachOrientation != null
    ? swellAlignmentMultiplier(swellDir, spot.beachOrientation)
    : 1.0;
  const height = rawHeight * (spot.coastalFactor ?? DEFAULT_COASTAL_FACTOR) * alignment;
  const period = h.swellPeriod ?? h.wavePeriod ?? 0;
  return { rawHeight, height, period, swellDir, alignment };
}

export interface SurfNow extends BeachWave {
  /** The forecast hour this refers to (epoch ms) */
  hourTime: number;
  swellHeight: number | null;
  verdict: SurfVerdictResult;
  /** No usable wind yet — no score, a provisional one, or no wind consensus
   *  while the sector's reading set is still arriving (cold load: stations
   *  land in waves). The verdict was computed WITHOUT wind modifiers and must
   *  not be shown as firm: a deep link to Corrubedo said SURF OK for the
   *  seconds before the NW (onshore) wind landed and turned it into PEQUE.
   *  Same rule the sailing markers follow. With the set complete and still no
   *  consensus the wind is genuinely absent, and the verdict is final. */
  windPending: boolean;
}

/**
 * The verdict for now, with the consensus wind of the spot.
 *
 * `readingSetPartial` (see isReadingSetPartial) decides what a missing wind
 * consensus means; when the caller cannot tell, it is treated as still
 * arriving.
 */
export function deriveSurfNow(
  spot: SurfSpotShape,
  hours: readonly MarineForecastHour[],
  score: SurfWindSource | undefined | null,
  nowMs: number,
  readingSetPartial = true,
): SurfNow | null {
  const h = nearestHour(hours.filter(hasWave), nowMs);
  if (!h) return null;
  const wave = beachWaveAt(spot, h);
  const windPending = !score || score.provisional === true || (!score.wind && readingSetPartial);
  // A direction the card calls «variable» (the sources disagree, see
  // verdictStyles.DIR_VARIABLE_BELOW) is a mean with nothing behind it, so it
  // decides neither offshore nor onshore — the same rule the sailing engine
  // follows for its pattern match.
  const windDir = windPending || !score?.wind || isDirVariable(score.wind) ? null : score.wind.dirDeg;
  const verdict = computeSurfVerdict(
    wave.height,
    wave.period,
    isOffshoreWind(spot, windDir),
    isOnshoreWind(spot, windDir),
    isSwellAligned(spot, wave.swellDir),
  );
  return { ...wave, hourTime: h.time.getTime(), swellHeight: h.swellHeight, verdict, windPending };
}

// ── The cache entry every surface reads ──────────────────────────────

export interface SurfWaveEntry {
  /** Wave at the beach for `hourTime` (m). MODEL, never measured. Null without data. */
  waveHeight: number | null;
  /** Open-sea model height before the beach correction (m) */
  rawHeight: number | null;
  swellHeight: number | null;
  period: number | null;
  /** Direction the swell (or sea) comes from (°), null when the source has none */
  swellDir: number | null;
  /** Null when there is no usable hour: surfaces say «sin dato», never FLAT */
  verdict: SurfVerdictResult | null;
  /** See SurfNow.windPending */
  windPending: boolean;
  /** The forecast hour the values refer to (epoch ms) */
  hourTime: number | null;
  /** Every hour the source returned, kept for the forecast strip */
  hours: MarineForecastHour[];
  /** When `hours` was downloaded (epoch ms) */
  fetchedAt: number;
  /** Always 'modelo': there is no wave measurement on these beaches */
  basis: 'modelo';
}

/** Build the entry for one spot from its downloaded hours and current score. */
export function buildSurfEntry(
  spot: SurfSpotShape,
  hours: MarineForecastHour[],
  score: SurfWindSource | undefined | null,
  nowMs: number,
  fetchedAt: number,
  readingSetPartial = true,
): SurfWaveEntry {
  const now = deriveSurfNow(spot, hours, score, nowMs, readingSetPartial);
  if (!now) {
    return {
      waveHeight: null, rawHeight: null, swellHeight: null, period: null, swellDir: null,
      verdict: null, windPending: false, hourTime: null, hours, fetchedAt, basis: 'modelo',
    };
  }
  return {
    waveHeight: now.height,
    rawHeight: now.rawHeight,
    swellHeight: now.swellHeight,
    period: now.period,
    swellDir: now.swellDir,
    verdict: now.verdict,
    windPending: now.windPending,
    hourTime: now.hourTime,
    hours,
    fetchedAt,
    basis: 'modelo',
  };
}

/** Whether two entries would render the same (so a rewrite can be skipped). */
export function sameSurfEntry(a: SurfWaveEntry | undefined, b: SurfWaveEntry): boolean {
  if (!a) return false;
  return a.hours === b.hours
    && a.fetchedAt === b.fetchedAt
    && a.hourTime === b.hourTime
    && a.windPending === b.windPending
    && a.verdict?.label === b.verdict?.label
    && a.verdict?.summary === b.verdict?.summary
    && (a.waveHeight?.toFixed(2) ?? null) === (b.waveHeight?.toFixed(2) ?? null);
}

// ── How every surface presents a surf spot ───────────────────────────

/** State of a surf spot as every surface must present it. */
export type SurfDisplayState = 'loading' | 'nodata' | 'ready' | 'danger';

/** What a surface needs from the score to know the engine flagged danger. */
export interface SurfGateSource {
  hardGateTriggered?: string | null;
}

/**
 * 'danger' first: the engine's hard gate (wind over the spot's limit, or a
 * buoy sea over its limit) outranks loading and the wave verdict, which
 * ignores wind SPEED and read «SURF OK» in a 30 kt blow the engine calls
 * «Peligroso». Danger always renders, the same rule as the engine's
 * provisional gate. On 'danger' a surface shows the engine's own verdict,
 * exactly as it would for any spot.
 */
export function surfDisplayState(
  entry: SurfWaveEntry | undefined | null,
  score: SurfGateSource | undefined | null,
): SurfDisplayState {
  if (score?.hardGateTriggered) return 'danger';
  if (!entry || entry.windPending) return 'loading';
  return entry.verdict && entry.waveHeight != null ? 'ready' : 'nodata';
}

/** What a panel (sidebar row and header, mobile pill) prints for a surf spot. */
export type SurfView =
  /** The engine's hard gate: print its wind verdict and summary instead. */
  | { state: 'danger'; wave: string | null }
  | {
      state: 'loading' | 'nodata' | 'ready';
      /** Badge text: the surf label, «Calculando…» or «Sin dato de olas» */
      label: string;
      /** Badge colour for the theme; null = the panel's neutral text colour */
      color: string | null;
      /** «~1,1 m (modelo)», null without a height */
      wave: string | null;
      /** The line under the badge, null when there is nothing to add */
      summary: string | null;
    };

export function surfView(
  entry: SurfWaveEntry | undefined | null,
  score: SurfGateSource | undefined | null,
  theme: 'dark' | 'light' = 'dark',
): SurfView {
  const state = surfDisplayState(entry, score);
  const wave = entry?.waveHeight != null && (state === 'ready' || state === 'danger')
    ? `${formatSurfWave(entry.waveHeight)} (modelo)`
    : null;
  if (state === 'danger') return { state, wave };
  if (state === 'loading') {
    return {
      state,
      label: PROVISIONAL_LABEL,
      color: null,
      wave: null,
      // With the forecast in, what is missing is the spot's wind.
      summary: entry ? 'Esperando el viento de las estaciones…' : 'Cargando previsión de olas…',
    };
  }
  if (state === 'nodata' || !entry?.verdict) {
    // The badge already says it; nothing is on its way, so nothing is promised.
    return { state: 'nodata', label: 'Sin dato de olas', color: null, wave: null, summary: null };
  }
  const v = entry.verdict;
  return { state, label: v.label, color: theme === 'light' ? v.lightText : v.text, wave, summary: v.summary };
}

/**
 * Which level is «the best» surf for a casual reader (the simple-mode ticker):
 * CLÁSICO, then SURF OK, then GRANDE — «solo con experiencia», and the spec
 * gives it the tone of the sailing «fuerte», the too-much end, not the top.
 * 0 = not a candidate (below SURF OK).
 */
export function surfBestRank(level: number): number {
  return level === 3 ? 3 : level === 2 ? 2 : level === 4 ? 1 : 0;
}

/** «~1,2 m» — approximate, because it is a model value. The tilde and not the
 *  «≈» of the design: on the map badge at desktop pixel density «≈» collapsed
 *  to «=» or «-», which states the opposite, and «~» is the sign the app
 *  already uses for estimates («NW ~5kt»). Decimal comma, as the rest of the
 *  Spanish copy (sportWarningService). */
export function formatSurfWave(heightM: number): string {
  return `~${heightM.toFixed(1).replace('.', ',')} m`;
}
