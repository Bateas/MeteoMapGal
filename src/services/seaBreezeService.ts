/**
 * Sea-breeze (viración térmica) sector-level detector — Phase A.
 *
 * T2-4 (S136+3+5). DISTINCT from `viracionDetector.ts` (which classifies the
 * per-spot phase of the daily wind cycle). This service computes the
 * SECTOR-WIDE physical DRIVER of the sea breeze: the coast-inland temperature
 * gradient. When inland heats well above the coast on a sunny afternoon, the
 * pressure gradient pulls cool marine air onshore — that's the engine behind
 * every spot's viración.
 *
 * Why it's useful (reactive-map test): it answers "is the thermal engine ON
 * right now, and how strong?" — a single sector signal that tells a sailor
 * whether to expect the afternoon breeze to fill in, BEFORE any individual
 * spot flips. Complements (not duplicates) per-spot viración.
 *
 * Phase A = pure function + tests only. Phase B (animated front arrow on the
 * map showing where the breeze has penetrated) is deferred until this core
 * is validated against real afternoons.
 *
 * Pure computation — no React, no stores, no API calls.
 */

import type { NormalizedReading } from '../types/station';
import { msToKnots } from './windUtils';

// ── Types ────────────────────────────────────────────────────

export type SeaBreezePhase = 'none' | 'building' | 'active' | 'mature';
export type SeaBreezeStrength = 'weak' | 'moderate' | 'strong';

export interface SeaBreezeAssessment {
  /** True when the thermal gradient + timing favour an onshore sea breeze */
  active: boolean;
  phase: SeaBreezePhase;
  /** inland_temp - coast_temp (°C). Positive = breeze driver present. */
  deltaT: number | null;
  strength: SeaBreezeStrength | null;
  coastTemp: number | null;
  inlandTemp: number | null;
  /** Onshore (sea→land) wind confirmed at the coast */
  onshoreAtCoast: boolean;
  /** Confidence 0-100 */
  confidence: number;
  /** Spanish one-line explanation */
  hypothesis: string;
}

// ── Thresholds (Galician Rías sea breeze) ───────────────────

/** ΔT (inland-coast) thresholds in °C */
const DELTA_WEAK = 2;     // below this: no meaningful gradient
const DELTA_MODERATE = 4;
const DELTA_STRONG = 7;

/** Sea-breeze season: April (3) – September (8) inclusive (0-indexed months) */
const SEASON_START_MONTH = 3;
const SEASON_END_MONTH = 8;

/** Active window: late morning through evening */
const HOUR_START = 11;
const HOUR_END = 20;

/** Minimum onshore wind speed at coast to count as "filled in" (kt) */
const ONSHORE_MIN_KT = 5;

// ── Pure core ────────────────────────────────────────────────

/**
 * Classify the sea-breeze state from pre-extracted aggregates.
 * This is the fully-pure, fully-testable core.
 *
 * @param coastTemp       Coast stations average air temp (°C) or null
 * @param inlandTemp      Inland stations average air temp (°C) or null
 * @param hour            Local hour 0-23
 * @param month           Local month 0-11
 * @param coastOnshore    Onshore wind direction observed at the coast?
 * @param coastWindKt     Coast wind speed (kt) or null
 */
export function classifySeaBreeze(opts: {
  coastTemp: number | null;
  inlandTemp: number | null;
  hour: number;
  month: number;
  coastOnshore: boolean;
  coastWindKt: number | null;
}): SeaBreezeAssessment {
  const { coastTemp, inlandTemp, hour, month, coastOnshore, coastWindKt } = opts;

  const inSeason = month >= SEASON_START_MONTH && month <= SEASON_END_MONTH;
  const inWindow = hour >= HOUR_START && hour <= HOUR_END;

  const none = (hypothesis: string, deltaT: number | null = null): SeaBreezeAssessment => ({
    active: false, phase: 'none', deltaT, strength: null,
    coastTemp, inlandTemp, onshoreAtCoast: coastOnshore, confidence: 0, hypothesis,
  });

  if (!inSeason) return none('Fuera de temporada de brisa (abr-sep)');
  if (!inWindow) return none('Fuera de la franja diurna de brisa (11-20h)');
  if (coastTemp === null || inlandTemp === null) {
    return none('Sin temperatura costa/interior suficiente');
  }

  const deltaT = Math.round((inlandTemp - coastTemp) * 10) / 10;

  if (deltaT < DELTA_WEAK) {
    return none(`Gradiente débil (Δ${deltaT > 0 ? '+' : ''}${deltaT.toFixed(1)}°C) — motor térmico apagado`, deltaT);
  }

  // Gradient strength
  const strength: SeaBreezeStrength = deltaT >= DELTA_STRONG ? 'strong'
    : deltaT >= DELTA_MODERATE ? 'moderate' : 'weak';

  // Onshore confirmation: has the breeze actually filled in at the coast?
  const filledIn = coastOnshore && coastWindKt !== null && coastWindKt >= ONSHORE_MIN_KT;

  // Phase: gradient present but not yet onshore = building; onshore + moderate+ = active;
  // onshore + strong = mature.
  let phase: SeaBreezePhase;
  if (!filledIn) {
    phase = 'building';
  } else if (strength === 'strong') {
    phase = 'mature';
  } else {
    phase = 'active';
  }

  // Confidence: gradient magnitude + onshore confirmation + data presence
  let confidence = 0;
  confidence += strength === 'strong' ? 45 : strength === 'moderate' ? 35 : 20;
  if (filledIn) confidence += 35;
  else if (coastOnshore) confidence += 15; // onshore but light
  confidence = Math.min(100, confidence);

  const strengthEs = strength === 'strong' ? 'fuerte' : strength === 'moderate' ? 'moderada' : 'débil';
  const phaseEs = phase === 'mature' ? 'plena' : phase === 'active' ? 'activa' : 'formándose';
  const windStr = filledIn ? ` · costa ${coastWindKt!.toFixed(0)}kt onshore` : coastOnshore ? ' · onshore flojo' : ' · aún sin entrar';
  const hypothesis = `Brisa ${phaseEs} (Δ${deltaT.toFixed(1)}°C, ${strengthEs})${windStr}`;

  return {
    active: true,
    phase,
    deltaT,
    strength,
    coastTemp,
    inlandTemp,
    onshoreAtCoast: coastOnshore,
    confidence,
    hypothesis,
  };
}

// ── Wrapper: extract coast/inland aggregates from station readings ──

export interface SeaBreezeStation {
  id: string;
  lat: number;
  lon: number;
}

/**
 * Longitude threshold separating coast from inland for the Rías sector.
 * Coast = west of -8.65 (open to the Atlantic), inland = east of -8.45.
 * The gap (−8.65..−8.45) is intentionally excluded as "transition" so the
 * gradient is measured between clearly-coastal and clearly-inland stations.
 */
const COAST_LON_MAX = -8.65;
const INLAND_LON_MIN = -8.45;

/** Onshore for the Rías = wind FROM the W sector (SW..NW, 200°-340°) blowing inland. */
function isOnshoreRias(dir: number): boolean {
  return dir >= 200 && dir <= 340;
}

/**
 * Assess the sea breeze for the Rías sector from live readings + station geo.
 * Pulls coast/inland mean temps and the strongest coastal onshore wind, then
 * delegates to the pure `classifySeaBreeze`.
 *
 * @param now  Injectable clock for testing (defaults to new Date()).
 */
export function assessSeaBreezeRias(
  readings: Map<string, NormalizedReading>,
  stations: SeaBreezeStation[],
  now: Date = new Date(),
): SeaBreezeAssessment {
  const coastTemps: number[] = [];
  const inlandTemps: number[] = [];
  let coastOnshore = false;
  let coastWindKt: number | null = null;

  for (const s of stations) {
    const r = readings.get(s.id);
    if (!r) continue;

    const isCoast = s.lon <= COAST_LON_MAX;
    const isInland = s.lon >= INLAND_LON_MIN;

    if (r.temperature !== null) {
      if (isCoast) coastTemps.push(r.temperature);
      else if (isInland) inlandTemps.push(r.temperature);
    }

    // Track the strongest onshore wind among coastal stations
    if (isCoast && r.windSpeed !== null && r.windDirection !== null) {
      const kt = msToKnots(r.windSpeed);
      if (isOnshoreRias(r.windDirection)) {
        coastOnshore = true;
        if (coastWindKt === null || kt > coastWindKt) coastWindKt = kt;
      }
    }
  }

  const mean = (arr: number[]): number | null =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  return classifySeaBreeze({
    coastTemp: mean(coastTemps),
    inlandTemp: mean(inlandTemps),
    hour: now.getHours(),
    month: now.getMonth(),
    coastOnshore,
    coastWindKt,
  });
}
