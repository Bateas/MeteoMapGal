/**
 * Cross Sea Alert — detects dangerous cross-sea conditions.
 *
 * Cross sea occurs when wave direction and wind direction diverge
 * significantly (>45°), creating confused, choppy conditions that are
 * hazardous for small craft. This typically happens when:
 *
 *   1. A new wind direction establishes but old swell persists
 *   2. Reflected waves from coastline create secondary wave trains
 *   3. Multiple swell systems arrive from different angles
 *
 * The angular difference between wave propagation direction and wind
 * direction is the primary indicator. Combined with wave height and
 * wind speed, this determines the severity of cross-sea conditions.
 *
 * Spot-aware: only relevant where waveRelevance is 'moderate' or 'critical'.
 * Interior spots (Cesantes, Bocana) are sheltered from ocean swell.
 */

import type { BuoyReading } from '../api/buoyClient';
import type { AlertLevel } from '../types/campo';
import type { UnifiedAlert } from './alertService';
import { angleDifference } from './windUtils';
import { isBuoyFresh } from './buoyUtils';

// ── Types ────────────────────────────────────────────────────

export interface CrossSeaRisk {
  level: AlertLevel;
  /** Angular difference between wave and wind direction (degrees) */
  angleDelta: number | null;
  /** Wave direction from buoy (degrees) */
  waveDir: number | null;
  /** Wind direction — from buoy or nearby stations (degrees) */
  windDir: number | null;
  /** Significant wave height (m) */
  waveHeight: number | null;
  /** Wind speed (m/s) */
  windSpeed: number | null;
  /** Peak wave period (s) — distinguishes swell (≥8s) from wind-sea (<4s) */
  wavePeriod: number | null;
  /** Source buoy name */
  sourceBuoy: string | null;
  /** Human-readable explanation (Spanish) */
  hypothesis: string;
}

// ── Constants ────────────────────────────────────────────────

/** Minimum angle between wave and wind to flag cross sea (degrees) */
const CROSS_SEA_MODERATE = 45;
const CROSS_SEA_HIGH = 70;
const CROSS_SEA_CRITICAL = 90;

/** Minimum wave height to consider cross sea relevant (m) */
const MIN_WAVE_HEIGHT = 0.5;

/** Minimum wind speed to produce meaningful wind waves (m/s) */
const MIN_WIND_SPEED = 3.0;

/**
 * Ocean-facing buoys outside the Ría interior.
 * Cross-sea alerts from these buoys are downgraded one level because
 * conditions at Cabo Silleiro (open ocean) don't directly translate
 * to conditions inside the Ría de Vigo / Rías Baixas.
 */
const OCEAN_BUOYS = new Set(['Cabo Silleiro', 'Ons']);

/** Wave period thresholds (seconds) — Tp distinguishes swell from wind-sea */
const TP_SWELL = 8;      // Tp ≥8s = ocean swell (long-traveled, more dangerous cross-sea)
const TP_WIND_SEA = 4;   // Tp <4s = local wind-sea (short-lived, less dangerous)

// ── Main Assessment ──────────────────────────────────────────

/**
 * Assess cross-sea risk at a single buoy.
 * Requires both waveDir and windDir to compute angular difference.
 */
function assessBuoyCrossSeaRisk(buoy: BuoyReading): CrossSeaRisk {
  const noRisk: CrossSeaRisk = {
    level: 'none',
    angleDelta: null,
    waveDir: buoy.waveDir,
    windDir: buoy.windDir,
    waveHeight: buoy.waveHeight,
    windSpeed: buoy.windSpeed,
    wavePeriod: buoy.wavePeriod,
    sourceBuoy: buoy.stationName,
    hypothesis: 'Sin datos de dirección de oleaje o viento',
  };

  // Need both directions
  if (buoy.waveDir === null || buoy.windDir === null) return noRisk;

  // Need meaningful waves
  if (buoy.waveHeight === null || buoy.waveHeight < MIN_WAVE_HEIGHT) {
    return {
      ...noRisk,
      hypothesis: `Oleaje insignificante (${buoy.waveHeight?.toFixed(1) ?? '?'} m)`,
    };
  }

  // Need meaningful wind
  if (buoy.windSpeed === null || buoy.windSpeed < MIN_WIND_SPEED) {
    return {
      ...noRisk,
      hypothesis: 'Viento insuficiente para mar cruzada',
    };
  }

  const delta = angleDifference(buoy.waveDir, buoy.windDir);

  // ── Level determination ──────────────────────────────────
  let level: AlertLevel = 'none';
  const notes: string[] = [];

  if (delta >= CROSS_SEA_CRITICAL) {
    // Waves nearly perpendicular to wind — very dangerous
    level = 'critico';
    notes.push(`oleaje ${delta.toFixed(0)}° cruzado al viento — mar muy confusa`);
  } else if (delta >= CROSS_SEA_HIGH) {
    level = 'alto';
    notes.push(`oleaje ${delta.toFixed(0)}° cruzado al viento — navegación difícil`);
  } else if (delta >= CROSS_SEA_MODERATE) {
    level = 'riesgo';
    notes.push(`oleaje ${delta.toFixed(0)}° cruzado — precaución`);
  } else {
    return {
      level: 'none',
      angleDelta: delta,
      waveDir: buoy.waveDir,
      windDir: buoy.windDir,
      waveHeight: buoy.waveHeight,
      windSpeed: buoy.windSpeed,
      wavePeriod: buoy.wavePeriod,
      sourceBuoy: buoy.stationName,
      hypothesis: `Oleaje alineado con viento (${delta.toFixed(0)}°) — sin mar cruzada`,
    };
  }

  // Amplify severity if wave height is significant
  if (buoy.waveHeight >= 2.0 && level === 'riesgo') {
    level = 'alto';
    notes.push(`Hm0 ${buoy.waveHeight.toFixed(1)} m amplifica el riesgo`);
  } else if (buoy.waveHeight >= 3.0 && level === 'alto') {
    level = 'critico';
    notes.push(`Hm0 ${buoy.waveHeight.toFixed(1)} m — condiciones peligrosas`);
  }

  // Wave period factor: Tp distinguishes dangerous ocean swell from local chop
  if (buoy.wavePeriod !== null) {
    if (buoy.wavePeriod >= TP_SWELL && delta >= CROSS_SEA_MODERATE) {
      // Long-period swell crossed with wind → very dangerous (persistent energy)
      if (level === 'riesgo') {
        level = 'alto';
        notes.push(`Tp ${buoy.wavePeriod.toFixed(1)}s (swell oceánico) — energía persistente`);
      } else if (level === 'alto') {
        level = 'critico';
        notes.push(`Tp ${buoy.wavePeriod.toFixed(1)}s swell + cruce → peligroso`);
      } else {
        notes.push(`Tp ${buoy.wavePeriod.toFixed(1)}s (swell oceánico)`);
      }
    } else if (buoy.wavePeriod < TP_WIND_SEA) {
      // Short-period wind-sea → less dangerous cross-sea, can downgrade
      if (level === 'riesgo') {
        level = 'none';
        notes.push(`Tp ${buoy.wavePeriod.toFixed(1)}s (mar de viento local) — cruce poco peligroso`);
      } else if (level === 'alto') {
        level = 'riesgo';
        notes.push(`Tp ${buoy.wavePeriod.toFixed(1)}s (mar de viento) — riesgo reducido`);
      }
    }
  }

  return {
    level,
    angleDelta: delta,
    waveDir: buoy.waveDir,
    windDir: buoy.windDir,
    waveHeight: buoy.waveHeight,
    windSpeed: buoy.windSpeed,
    wavePeriod: buoy.wavePeriod,
    sourceBuoy: buoy.stationName,
    hypothesis: notes.join(' · '),
  };
}

// ── Public API ───────────────────────────────────────────────

/**
 * Assess cross-sea risk across all buoys that report wave direction.
 * Returns the worst-case risk found.
 */
export function assessCrossSeaRisk(buoys: BuoyReading[]): CrossSeaRisk {
  if (buoys.length === 0) {
    return {
      level: 'none', angleDelta: null, waveDir: null, windDir: null,
      waveHeight: null, windSpeed: null, wavePeriod: null, sourceBuoy: null,
      hypothesis: 'Sin datos de boyas',
    };
  }

  let worst: CrossSeaRisk | null = null;
  const LEVEL_ORDER: Record<AlertLevel, number> = { none: 0, riesgo: 1, alto: 2, critico: 3 };

  for (const buoy of buoys) {
    // Only assess buoys with wave data (ocean-facing)
    if (buoy.waveDir === null) continue;
    // Cross-sea is an INSTANTANEOUS wave-vs-wind angle — a stale reading (>2h)
    // can hold a phantom verdict long after the sea state changed. Exclude stale
    // buoys (same gate as the wind verdict + fog alert). O3.
    if (!isBuoyFresh(buoy)) continue;

    const risk = assessBuoyCrossSeaRisk(buoy);
    if (!worst || LEVEL_ORDER[risk.level] > LEVEL_ORDER[worst.level] ||
        (risk.level === worst.level && (risk.angleDelta ?? 0) > (worst.angleDelta ?? 0))) {
      worst = risk;
    }
  }

  return worst ?? {
    level: 'none', angleDelta: null, waveDir: null, windDir: null,
    waveHeight: null, windSpeed: null, wavePeriod: null, sourceBuoy: null,
    hypothesis: 'Ninguna boya con datos de oleaje direccional',
  };
}

/** Level shown for one buoy: open-sea buoys go two levels down (rarely reflects inside the ría). */
function effectiveCrossSeaLevel(risk: CrossSeaRisk): AlertLevel {
  if (!risk.sourceBuoy || !OCEAN_BUOYS.has(risk.sourceBuoy)) return risk.level;
  const downgrade: Record<AlertLevel, AlertLevel> = {
    critico: 'riesgo', alto: 'none', riesgo: 'none', none: 'none',
  };
  return downgrade[risk.level];
}

/**
 * Build UnifiedAlert[] from cross-sea assessment.
 * Only emits alerts if risk is riesgo or above.
 */
export function buildCrossSeaAlerts(buoys: BuoyReading[]): UnifiedAlert[] {
  // The open-sea downgrade is applied to EACH buoy before picking the worst. Picking first
  // let a Cabo Silleiro 'alto' (downgraded to nothing) hide a 'riesgo' measured inside the ría.
  const LEVEL_ORDER: Record<AlertLevel, number> = { none: 0, riesgo: 1, alto: 2, critico: 3 };
  let risk: CrossSeaRisk | null = null;
  let effectiveLevel: AlertLevel = 'none';
  for (const buoy of buoys) {
    if (buoy.waveDir === null || !isBuoyFresh(buoy)) continue;
    const r = assessBuoyCrossSeaRisk(buoy);
    const eff = effectiveCrossSeaLevel(r);
    if (eff === 'none') continue;
    if (!risk || LEVEL_ORDER[eff] > LEVEL_ORDER[effectiveLevel] ||
        (eff === effectiveLevel && (r.angleDelta ?? 0) > (risk.angleDelta ?? 0))) {
      risk = r;
      effectiveLevel = eff;
    }
  }
  if (!risk) return [];
  // Today only Cabo Silleiro reports wave direction, 50 km out: the alert says so instead of
  // reading as the sea inside the ría (the harbour gauges measure port agitation, not swell).
  const openSea = risk.sourceBuoy != null && OCEAN_BUOYS.has(risk.sourceBuoy);

  const levelToScore: Record<AlertLevel, number> = {
    none: 0, riesgo: 30, alto: 55, critico: 80,
  };
  // A moderate cross sea 50 km out decides nothing inside the ría: it goes with the notices, below
  // what is measured here (20-oct it headed the panel during rain).
  const openSeaNotice = openSea && effectiveLevel === 'riesgo';
  const score = openSeaNotice ? 20 : levelToScore[effectiveLevel];
  const severity = openSeaNotice ? 'info' : score >= 80 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'moderate' : 'info';

  const angleStr = risk.angleDelta !== null ? `${risk.angleDelta.toFixed(0)}°` : '';
  const buoyStr = risk.sourceBuoy
    ? openSea ? ` (${risk.sourceBuoy}, fuera de la ría)` : ` (${risk.sourceBuoy})`
    : '';
  const waveStr = risk.waveHeight !== null ? `Hm0 ${risk.waveHeight.toFixed(1)}m` : '';
  const baseTitle = effectiveLevel === 'critico'
    ? 'MAR CRUZADA PELIGROSA'
    : effectiveLevel === 'alto'
      ? 'Mar cruzada significativa'
      : 'Mar cruzada moderada';

  return [{
    id: 'cross-sea',
    category: 'marine',
    severity: severity as 'info' | 'moderate' | 'high' | 'critical',
    score,
    icon: 'waves',
    title: openSea
      ? effectiveLevel === 'critico' ? 'MAR CRUZADA PELIGROSA EN MAR ABIERTO' : `${baseTitle} en mar abierto`
      : baseTitle,
    detail: [
      `${angleStr} oleaje-viento${buoyStr}`,
      waveStr,
      risk.wavePeriod !== null
        ? risk.wavePeriod >= TP_SWELL
          ? `Tp ${risk.wavePeriod.toFixed(0)}s (swell)`
          : risk.wavePeriod < TP_WIND_SEA
            ? `Tp ${risk.wavePeriod.toFixed(0)}s (mar viento)`
            : `Tp ${risk.wavePeriod.toFixed(0)}s`
        : '',
    ].filter(Boolean).join(' · '),
    urgent: effectiveLevel === 'critico',
    updatedAt: new Date(),
  }];
}
