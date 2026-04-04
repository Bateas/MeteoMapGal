/**
 * Storm alert builders — converts lightning/storm data and storm shadow
 * detections into UnifiedAlert[].
 */

import type { NormalizedReading } from '../../types/station';
import type { StormAlert, StormAlertLevel } from '../../types/lightning';
import type { StormShadow } from '../stormShadowDetector';
import type { AlertSeverity, UnifiedAlert } from './types';
import { severityFromScore } from './riskEngine';
import { detectNorthWindConsensus } from '../maritimeFogService';

// ── Storm alerts -> UnifiedAlert ──────────────────────────────

export function stormAlertScore(level: StormAlertLevel, nearestKm: number): number {
  switch (level) {
    case 'danger':  return 95;
    case 'warning': return 60 + Math.max(0, (25 - nearestKm) * 1.4); // 60-95
    case 'watch':   return 25 + Math.max(0, (50 - nearestKm) * 0.7); // 25-60
    default:        return 0;
  }
}

export function buildStormAlerts(storm: StormAlert): UnifiedAlert[] {
  if (storm.level === 'none') return [];

  const score = stormAlertScore(storm.level, storm.nearestKm);
  const labels: Record<StormAlertLevel, string> = {
    danger: 'PELIGRO — Tormenta encima',
    warning: 'AVISO — Tormenta acercándose',
    watch: 'VIGILANCIA — Actividad eléctrica',
    none: '',
  };

  let detail = `${storm.nearestKm.toFixed(0)} km, ${storm.recentCount} rayos recientes`;
  if (storm.trend === 'approaching' && storm.etaMinutes != null) {
    detail += ` · ETA ~${storm.etaMinutes.toFixed(0)} min`;
  } else if (storm.trend === 'receding') {
    detail += ' · alejándose';
  }

  return [{
    id: 'storm-main',
    category: 'storm',
    severity: severityFromScore(score),
    score,
    icon: 'zap',
    title: labels[storm.level],
    detail,
    urgent: storm.level === 'danger' || (storm.level === 'warning' && storm.trend === 'approaching'),
    updatedAt: storm.updatedAt,
  }];
}

// ── Storm shadow alerts -> UnifiedAlert ───────────────────────

export function buildStormShadowAlerts(
  shadow: StormShadow | null,
  currentReadings?: Map<string, NormalizedReading>,
): UnifiedAlert[] {
  if (!shadow || shadow.confidence < 40) return [];

  const now = new Date();
  const score = Math.min(95, shadow.confidence);
  const hasLightning = shadow.lightningNearby > 0;
  const hasWindConfirmation = shadow.windContext !== null && shadow.windContext.outflowCount > 0;

  // ── North wind suppression for non-lightning cloud alerts ──
  // Strong N/NE across all stations = clear dry air. Solar radiation drops
  // could be from high-altitude clouds, NOT convective storms.
  // Only suppress when there's no lightning confirmation.
  if (!hasLightning && !hasWindConfirmation && currentReadings && detectNorthWindConsensus(currentReadings)) {
    return [];
  }

  // ── Clouds without confirmation = no alert at all ──
  // Solar radiation drops alone are normal weather phenomena in Galicia.
  // Only alert when there's actual danger: lightning OR wind outflow (gust front).
  if (!hasLightning && !hasWindConfirmation) {
    return [];
  }

  // ── Contextual title based on lightning presence ──
  // Clouds without lightning are NOT alarming — just informational.
  // Only escalate language when lightning or wind outflow confirms a real storm.
  let title: string;
  if (shadow.etaMinutes !== null) {
    title = hasLightning
      ? `Tormenta acercándose — ETA ~${shadow.etaMinutes} min`
      : `Nubes en la zona — ETA ~${shadow.etaMinutes} min`;
  } else if (hasLightning) {
    title = 'Tormenta cercana detectada';
  } else {
    title = 'Nubes en la zona';
  }

  // ── Detail ──
  let detail = `${shadow.shadowedStations.length} estación(es) afectada(s)`;

  if (shadow.movementSpeedKmh !== null) {
    detail += ` · ${shadow.movementSpeedKmh.toFixed(0)} km/h`;
  }
  if (shadow.movementBearing !== null) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const idx = Math.round(shadow.movementBearing / 45) % 8;
    detail += ` hacia ${dirs[idx]}`;
  }
  if (shadow.etaMinutes !== null) {
    detail += ` · ETA ~${shadow.etaMinutes} min al embalse`;
  }

  // Lightning context
  if (hasLightning) {
    detail += ` · ${shadow.lightningNearby} rayo(s)`;
  } else {
    detail += ' · Caída de radiación solar. Sin rayos por ahora.';
  }

  // Wind anomaly context
  if (shadow.windContext) {
    if (shadow.windContext.outflowCount > 0) {
      detail += ` · ${shadow.windContext.outflowCount} estación(es) con viento de tormenta`;
    } else if (shadow.windContext.gustCount > 0) {
      detail += ` · ${shadow.windContext.gustCount} racha(s) detectada(s)`;
    }
  }

  // ── Severity: downgrade when no lightning and no wind confirmation ──
  let severity: AlertSeverity;
  if (shadow.etaMinutes !== null && shadow.etaMinutes < 30) {
    severity = 'high';
  } else if (hasWindConfirmation) {
    severity = 'high';
  } else if (hasLightning && shadow.confidence >= 60) {
    severity = 'moderate';
  } else if (!hasLightning) {
    // No lightning, no wind outflow -> just dense clouds, lower severity
    severity = 'info';
  } else {
    severity = shadow.confidence >= 60 ? 'moderate' : 'info';
  }

  // Cap score for non-confirmed events: clouds without lightning or wind outflow
  // are NOT dangerous — purely informational. Low score keeps them subtle in the UI.
  let finalScore = score;
  if (!hasLightning && !hasWindConfirmation) {
    finalScore = Math.min(25, score); // very low — just clouds, not a warning
  } else if (hasWindConfirmation) {
    finalScore = Math.min(100, score + 10);
  }

  return [{
    id: 'storm-shadow',
    category: 'storm',
    severity,
    score: finalScore,
    icon: hasLightning ? 'zap' : 'cloud',
    title,
    detail,
    // Only urgent if confirmed storm (lightning or wind outflow). Clouds alone never urgent.
    urgent: hasLightning || hasWindConfirmation
      ? (shadow.etaMinutes !== null && shadow.etaMinutes < 20) || hasWindConfirmation
      : false,
    updatedAt: now,
  }];
}
