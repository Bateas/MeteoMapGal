/**
 * Viración detector — daily wind cycle phase tracker for Rías Baixas.
 *
 * "Viración" is the local Galician term for the afternoon thermal sea
 * breeze that takes over from the morning land breeze (terral) once the
 * land has heated up enough to flip the pressure gradient. It's the
 * defining wind pattern of the rías between April and September on
 * sunny days with weak synoptic flow.
 *
 * This is NOT an alert system. It tracks the CURRENT PHASE of the daily
 * cycle and compares the observed wind to the empirically-validated
 * pattern for each spot. Output is a small information line — never a
 * red badge or a Telegram push. If the pattern is broken (e.g. synoptic
 * front blowing through), we say "irregular" rather than firing nothing.
 *
 * ─── Empirical basis ────────────────────────────────────────────
 *
 * Thresholds below come from a SQL audit of TimescaleDB readings
 * (Mar-May 2026, ~30+ thermal days per spot). Audit S135+2 confirmed:
 *   - Transition hour: 11-13h local across all spots
 *   - Morning direction VARIES per spot (orography)
 *   - Afternoon direction VARIES per spot (orientation to the Atlantic)
 *   - Speed peaks 14-19h
 *
 * Each spot was profiled against its closest "on-water" station:
 *   - Vigo + Cesantes + Centro-Ría: mg_14001 (Porto de Vigo, on water)
 *   - Lourido + Castiñeiras: mg_14005 (Porto de Marín, on water)
 *   - Cíes-Ría: mc_ESGAL...36940A (Cangas, N coast Vigo ría)
 *   - Lanzada + Illa Arousa: mg_10134 (Sálvora, oceanic)
 *
 * ─── Confidence rules ──────────────────────────────────────────
 *
 * High   : observed direction within expected sector for current phase
 *          AND speed in expected range
 *          AND month is Apr-Sep
 *          AND no strong synoptic forecast (>12 kt)
 * Medium : direction matches but speed atypical
 * Low    : pattern broken — emit "irregular" descriptor
 *
 * Out of season (Oct-Mar) → returns 'unknown' with confidence 'low'.
 */

import type { SpotId } from '../config/spots';
import type { NormalizedReading } from '../types/station';
import { isStationBlindAt } from '../config/stationBiases';

/** Daily phase of the wind cycle. */
export type ViracionPhase =
  | 'terral'      // morning land breeze (offshore from interior)
  | 'transition' // wind dropping/rotating around midday
  | 'viracion'   // afternoon sea breeze (onshore from Atlantic)
  | 'decaying'   // evening calming
  | 'unknown';   // out of season, no data, or pattern fully broken

export interface ViracionPattern {
  /** Spots that share this empirical profile (validated against same station). */
  appliesTo: SpotId[];
  /** Expected morning direction sector — degrees, inclusive bounds. */
  morningDir: { min: number; max: number };
  /** Expected afternoon direction sector. */
  afternoonDir: { min: number; max: number };
  /** Hour of day (local time, 0-23) where the turn typically happens. */
  transitionHour: number;
  /** Typical peak afternoon speed in knots — used for sanity check. */
  expectedAfternoonKt: number;
  /** Local hour (inclusive) the afternoon viración window opens. */
  windowStart: number;
  /** Local hour the window closes. */
  windowEnd: number;
  /**
   * Special-case flag: stations like Sálvora always have wind because they
   * are oceanic; the morning is NOT a real terral, just the synoptic NE
   * flow. We still detect a viración when it ROTATES even though the
   * speed doesn't drop dramatically.
   */
  oceanic?: boolean;
}

/**
 * Empirical patterns derived from TimescaleDB SQL audit S135+2.
 * Each entry is grouped by the spots that share the same "on-water"
 * reference station — these are the spots whose viración pattern is
 * physically the same.
 */
export const VIRACION_PATTERNS: ViracionPattern[] = [
  {
    // Ría de Vigo — interior + center. Reference: mg_14001 Porto de Vigo.
    appliesTo: ['cesantes', 'centro-ria', 'bocana', 'vao'],
    morningDir: { min: 20, max: 90 },
    afternoonDir: { min: 220, max: 260 },
    transitionHour: 12,
    expectedAfternoonKt: 8,
    windowStart: 13,
    windowEnd: 20,
  },
  {
    // Ría de Pontevedra. Reference: mg_14005 Porto de Marín.
    appliesTo: ['lourido', 'castineiras'],
    morningDir: { min: 30, max: 130 },
    afternoonDir: { min: 220, max: 270 },
    transitionHour: 12,
    expectedAfternoonKt: 7,
    windowStart: 13,
    windowEnd: 20,
  },
  {
    // Ría de Vigo, north side (Cíes / Cangas exposure). Reference: mc_..36940A.
    appliesTo: ['cies-ria'],
    morningDir: { min: 320, max: 40 },  // wraps midnight
    afternoonDir: { min: 270, max: 310 },
    transitionHour: 11,                 // gradual 10-12h, midpoint 11
    expectedAfternoonKt: 5,
    windowStart: 13,
    windowEnd: 20,
  },
  {
    // Outer ría / Arousa exposure. Reference: mg_10134 Sálvora.
    appliesTo: ['lanzada', 'illa-arousa'],
    morningDir: { min: 10, max: 60 },
    afternoonDir: { min: 250, max: 295 },
    transitionHour: 12,
    expectedAfternoonKt: 9,
    windowStart: 13,
    windowEnd: 20,
    oceanic: true,
  },
];

export interface ViracionDetection {
  phase: ViracionPhase;
  confidence: 'high' | 'medium' | 'low';
  /** True when observed wind matches the expected pattern for this hour. */
  isOnPattern: boolean;
  /** Short human-readable summary, Spanish, for SpotPopup display. */
  description: string;
  /**
   * Source quality flags — what cross-validation was used to arrive at
   * the confidence rating. Useful for debugging and the monthly review.
   */
  sources: {
    station: boolean;
    /** Buoy reading was provided AND agreed with the station within tolerance. */
    buoyConfirmed: boolean;
    /** Buoy reading was provided AND CONTRADICTED the station >60° divergent. */
    buoyConflict: boolean;
    /** Station is in a documented blind sector for the observed direction. */
    stationBlindSector: boolean;
  };
}

/**
 * Optional cross-source ground truth. A buoy in open water has no
 * orographic shielding — when its direction agrees with the station's
 * we can promote confidence; when it disagrees we know the station
 * reading is suspect.
 */
export interface BuoyReading {
  /** Compass direction, degrees. */
  windDirection: number;
  /** Speed in knots. Optional — used for sanity check only. */
  windKt?: number;
}

const NO_DETECTION: ViracionDetection = {
  phase: 'unknown',
  confidence: 'low',
  isOnPattern: false,
  description: '',
  sources: { station: false, buoyConfirmed: false, buoyConflict: false, stationBlindSector: false },
};

/** Smallest angular distance between two compass directions, 0..180°. */
export function circularDirDistance(a: number, b: number): number {
  const diff = Math.abs(((a - b) % 360) + 360) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// ── Helpers ──

/**
 * Inclusive check that allows the range to wrap past 360°.
 * Example: dirInRange(355, { min: 320, max: 40 }) → true
 */
export function dirInRange(deg: number, range: { min: number; max: number }): boolean {
  const d = ((deg % 360) + 360) % 360;
  if (range.min <= range.max) {
    return d >= range.min && d <= range.max;
  }
  // Wraps: e.g. 320..40
  return d >= range.min || d <= range.max;
}

function getPattern(spotId: SpotId): ViracionPattern | null {
  return VIRACION_PATTERNS.find((p) => p.appliesTo.includes(spotId)) ?? null;
}

function localHour(d: Date): number {
  // Europe/Madrid offset varies (CET/CEST), so use formatToParts for robustness.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(d);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '0';
  // "24" can be returned for midnight in some Node versions — normalize.
  const num = parseInt(h, 10);
  return num === 24 ? 0 : num;
}

function isThermalSeason(d: Date): boolean {
  const month = d.getUTCMonth() + 1;
  return month >= 4 && month <= 9;
}

// ── Public API ──

export interface ViracionInputs {
  /** Latest reading from the spot's reference station (preferredStations[0]). */
  reading: NormalizedReading | null;
  /** Optional ground-truth buoy reading from open water — promotes / demotes confidence. */
  buoy?: BuoyReading | null;
  /** Synoptic wind speed forecast for now (kt). >12 kt overrides thermal pattern. */
  synopticKt?: number | null;
  /** Clock injection for tests. */
  now?: Date;
}

/**
 * Classify the current viración phase for a spot.
 *
 * Confidence is built on three independent sources:
 *   1. Station reading vs expected sector for the current hour.
 *   2. Buoy reading (if provided) — open-water ground truth.
 *   3. Station bias (stationBiases.ts) — known orographic distortion.
 *
 * Decision matrix:
 *   Station on-pattern + buoy confirms (within 45°)  → HIGH
 *   Station on-pattern + no buoy + station NOT blind → HIGH (if speed OK)
 *   Station on-pattern + buoy CONFLICTS (>60°)       → MEDIUM ("boya discrepa")
 *   Station on-pattern + station IS blind, no buoy   → MEDIUM ("estación apantallada")
 *   Station off-pattern (any source)                  → LOW
 */
export function detectViracionPhase(
  spotId: SpotId,
  inputs: ViracionInputs | NormalizedReading | null = null,
  // Legacy positional args for backward compatibility:
  legacySynopticKt?: number | null,
  legacyNow?: Date,
): ViracionDetection {
  // ── Normalize inputs (support both new + legacy call signatures) ──
  let reading: NormalizedReading | null;
  let buoy: BuoyReading | null | undefined;
  let synopticKt: number | null | undefined;
  let now: Date;

  if (inputs && typeof inputs === 'object' && 'reading' in inputs) {
    reading = inputs.reading;
    buoy = inputs.buoy ?? null;
    synopticKt = inputs.synopticKt ?? null;
    now = inputs.now ?? new Date();
  } else {
    // Legacy: detectViracionPhase(spotId, reading, synopticKt?, now?)
    reading = (inputs as NormalizedReading | null) ?? null;
    buoy = null;
    synopticKt = legacySynopticKt ?? null;
    now = legacyNow ?? new Date();
  }

  // Out of season → silent.
  if (!isThermalSeason(now)) return NO_DETECTION;

  const pattern = getPattern(spotId);
  if (!pattern) return NO_DETECTION;

  if (!reading || reading.windDirection == null) return NO_DETECTION;

  // Synoptic kills thermal: above ~12 kt the gradient flow takes over.
  if (synopticKt != null && synopticKt > 12) {
    return {
      phase: 'unknown',
      confidence: 'low',
      isOnPattern: false,
      description: 'Sinóptico fuerte — viración no esperada',
      sources: { station: true, buoyConfirmed: false, buoyConflict: false, stationBlindSector: false },
    };
  }

  const hour = localHour(now);
  const obsDir = reading.windDirection;
  const obsKt = reading.windSpeed != null ? reading.windSpeed * 1.94384 : null;

  // ── Determine expected phase by clock ──
  let expectedPhase: ViracionPhase;
  if (hour < pattern.transitionHour) {
    expectedPhase = 'terral';
  } else if (hour === pattern.transitionHour || hour === pattern.transitionHour + 1) {
    expectedPhase = 'transition';
  } else if (hour >= pattern.windowStart && hour <= pattern.windowEnd) {
    expectedPhase = 'viracion';
  } else if (hour > pattern.windowEnd && hour <= 23) {
    expectedPhase = 'decaying';
  } else {
    expectedPhase = 'unknown';
  }

  if (expectedPhase === 'unknown') return NO_DETECTION;

  // ── Pattern check: does the station reading match the expected sector? ──
  let isOnPattern = false;
  switch (expectedPhase) {
    case 'terral':
      isOnPattern = dirInRange(obsDir, pattern.morningDir);
      break;
    case 'transition':
      isOnPattern = true; // transition is permissive — wind can be in any sector
      break;
    case 'viracion':
    case 'decaying':
      isOnPattern = dirInRange(obsDir, pattern.afternoonDir);
      break;
  }

  // ── Cross-source signals ──
  const stationBlind = isStationBlindAt(reading.stationId, obsDir);

  let buoyConfirmed = false;
  let buoyConflict = false;
  if (buoy && Number.isFinite(buoy.windDirection)) {
    const dirDiff = circularDirDistance(obsDir, buoy.windDirection);
    if (dirDiff <= 45) {
      buoyConfirmed = true;
    } else if (dirDiff > 60) {
      buoyConflict = true;
    }
  }

  // ── Confidence ladder ──
  //
  // The buoy is ground truth in open water — it overrides station-side
  // suspicion either way.
  let confidence: ViracionDetection['confidence'];
  if (!isOnPattern) {
    confidence = 'low';
  } else if (buoyConflict) {
    confidence = 'medium';
  } else if (buoyConfirmed) {
    confidence = 'high';
  } else if (stationBlind) {
    // Pattern matched, but the station is in a known blind sector and
    // we have no buoy to corroborate. Could be a genuine viración OR a
    // local artifact — keep at medium.
    confidence = 'medium';
  } else if (expectedPhase === 'viracion' && obsKt != null && obsKt >= pattern.expectedAfternoonKt * 0.5) {
    confidence = 'high';
  } else {
    confidence = 'medium';
  }

  // ── Description: phase + qualifiers ──
  let description: string;
  switch (expectedPhase) {
    case 'terral':
      description = isOnPattern
        ? 'Terral matutino — viración prevista hacia el mediodía'
        : 'Patrón matutino irregular';
      break;
    case 'transition':
      description = 'Viración entrando — viento girando';
      break;
    case 'viracion':
      if (isOnPattern && obsKt != null && obsKt >= pattern.expectedAfternoonKt * 0.5) {
        description = `Viración activa — ${Math.round(obsKt)} kt`;
      } else if (isOnPattern) {
        description = 'Viración entrando suave';
      } else {
        description = 'Viración esperada pero patrón irregular';
      }
      break;
    case 'decaying':
      description = isOnPattern ? 'Viración decayendo' : 'Calmando';
      break;
  }
  // Append cross-source qualifiers so the user sees WHY the confidence
  // is what it is. Keeps the line short.
  if (buoyConfirmed && isOnPattern) description += ' · confirmado por boya';
  else if (buoyConflict) description += ' · boya discrepa';
  else if (stationBlind && isOnPattern && !buoy) description += ' · estación apantallada';

  return {
    phase: expectedPhase,
    confidence,
    isOnPattern,
    description,
    sources: {
      station: true,
      buoyConfirmed,
      buoyConflict,
      stationBlindSector: stationBlind,
    },
  };
}
