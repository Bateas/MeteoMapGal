/**
 * Unified Alert Service — normalizes ALL alert sources into a single
 * prioritized list for the AlertPanel.
 *
 * Each subsystem (storm, inversion, thermal, campo) emits alerts with a
 * common shape, scored 0-100 with severity levels. The composite risk
 * index is the weighted maximum across all active alerts.
 */

import type { FieldAlerts, AlertLevel as CampoAlertLevel } from '../types/campo';
import type { StormAlert, StormAlertLevel } from '../types/lightning';
import type { ThermalProfile, ThermalStatus } from './lapseRateService';
import type { ZoneAlert, MicroZoneId } from '../types/thermal';

// ── Unified Alert Types ──────────────────────────────────────

export type AlertCategory =
  | 'storm'          // ⛈️  Tormenta eléctrica
  | 'inversion'      // 🌡️  Inversión térmica
  | 'thermal'        // 🌬️  Viento térmico
  | 'frost'          // ❄️  Helada
  | 'fog'            // 🌫️  Niebla
  | 'rain'           // 🌧️  Lluvia / Granizo
  | 'drone'          // 🛩️  Vuelo dron
  | 'wind-front';    // 📡  Frente de viento

export type AlertSeverity = 'info' | 'moderate' | 'high' | 'critical';

export interface UnifiedAlert {
  id: string;                          // e.g., "storm-main", "frost-forecast"
  category: AlertCategory;
  severity: AlertSeverity;
  score: number;                       // 0-100 (weighted composite score)
  icon: string;                        // Emoji
  title: string;                       // Short label (Spanish)
  detail: string;                      // 1-line description (Spanish)
  /** If true, the alert pulses / demands attention */
  urgent: boolean;
  /** When the alert was last computed */
  updatedAt: Date;
  /** Optional: which zone/area is affected */
  zoneId?: MicroZoneId;
}

export interface CompositeRisk {
  /** Overall risk score 0-100 (weighted max across all alerts) */
  score: number;
  /** Highest severity across all alerts */
  severity: AlertSeverity;
  /** Semaphore color for quick visual */
  color: 'green' | 'yellow' | 'orange' | 'red';
  /** Total number of active alerts (severity > info) */
  activeCount: number;
}

// ── Category weights (higher = more dangerous) ──────────────

const CATEGORY_WEIGHT: Record<AlertCategory, number> = {
  'storm':       3.0,   // Life-threatening
  'frost':       2.0,   // Crop damage
  'inversion':   1.8,   // Air quality + sailing impact
  'rain':        1.5,   // Crop / flood
  'fog':         1.2,   // Visibility
  'thermal':     1.0,   // Sailing / recreation
  'wind-front':  1.0,   // Propagation info
  'drone':       0.5,   // Convenience
};

// ── Conversion helpers ───────────────────────────────────────

function severityFromScore(score: number): AlertSeverity {
  if (score >= 80) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'moderate';
  return 'info';
}

function colorFromSeverity(severity: AlertSeverity): 'green' | 'yellow' | 'orange' | 'red' {
  switch (severity) {
    case 'critical': return 'red';
    case 'high':     return 'orange';
    case 'moderate': return 'yellow';
    default:         return 'green';
  }
}

// ── Storm alerts → UnifiedAlert ──────────────────────────────

function stormAlertScore(level: StormAlertLevel, nearestKm: number): number {
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
    icon: '⛈️',
    title: labels[storm.level],
    detail,
    urgent: storm.level === 'danger' || (storm.level === 'warning' && storm.trend === 'approaching'),
    updatedAt: storm.updatedAt,
  }];
}

// ── Inversion alerts → UnifiedAlert ──────────────────────────

export function buildInversionAlerts(profile: ThermalProfile | null): UnifiedAlert[] {
  if (!profile || !profile.hasInversion || !profile.regression) return [];

  const { slopePerKm, rSquared, stationCount } = profile.regression;
  // Score: slope +1 to +10 → 30 to 100, scaled by R²
  const rawScore = Math.min(100, 30 + (slopePerKm - 1) * 7.8);
  const score = Math.round(rawScore * Math.min(1, rSquared / 0.5));

  const isStrong = profile.status === 'strong-inversion';
  const title = isStrong ? 'INVERSIÓN FUERTE' : 'Inversión térmica detectada';
  const detail = `${slopePerKm > 0 ? '+' : ''}${slopePerKm.toFixed(1)}°C/km · ${stationCount} est. · R²=${rSquared.toFixed(2)}`;

  return [{
    id: 'inversion-main',
    category: 'inversion',
    severity: isStrong ? 'high' : 'moderate',
    score,
    icon: '🌡️',
    title,
    detail,
    urgent: isStrong && rSquared >= 0.5,
    updatedAt: new Date(),
  }];
}

// ── Thermal wind alerts → UnifiedAlert ───────────────────────

export function buildThermalAlerts(
  zoneAlerts: Map<MicroZoneId, ZoneAlert>,
): UnifiedAlert[] {
  const results: UnifiedAlert[] = [];

  for (const [zoneId, za] of zoneAlerts) {
    if (za.alertLevel === 'none') continue;

    const score = za.maxScore;
    const levelLabel = za.alertLevel === 'high' ? 'ALTO' : za.alertLevel === 'medium' ? 'MEDIO' : 'BAJO';

    results.push({
      id: `thermal-${zoneId}`,
      category: 'thermal',
      severity: za.alertLevel === 'high' ? 'high' : za.alertLevel === 'medium' ? 'moderate' : 'info',
      score,
      icon: '🌬️',
      title: `Térmico ${levelLabel} — ${zoneId}`,
      detail: `${score}% — ${za.activeRules.length} regla(s) activa(s)`,
      urgent: za.alertLevel === 'high' && score >= 70,
      updatedAt: new Date(),
      zoneId,
    });
  }
  return results;
}

// ── Campo (field) alerts → UnifiedAlert ──────────────────────

function campoLevelToScore(level: CampoAlertLevel): number {
  switch (level) {
    case 'critico': return 85;
    case 'alto':    return 55;
    case 'riesgo':  return 30;
    default:        return 0;
  }
}

export function buildFieldAlerts(field: FieldAlerts | null): UnifiedAlert[] {
  if (!field) return [];
  const now = new Date();
  const results: UnifiedAlert[] = [];

  // Frost
  if (field.frost.level !== 'none') {
    const score = campoLevelToScore(field.frost.level);
    const tempStr = field.frost.minTemp != null ? `${field.frost.minTemp.toFixed(1)}°C` : '?';
    results.push({
      id: 'frost-forecast',
      category: 'frost',
      severity: severityFromScore(score),
      score,
      icon: '❄️',
      title: field.frost.level === 'critico' ? 'HELADA SEVERA' : 'Riesgo de helada',
      detail: `Mín prevista ${tempStr}`,
      urgent: field.frost.level === 'critico',
      updatedAt: now,
    });
  }

  // Rain / Hail
  if (field.rain.level !== 'none') {
    const score = campoLevelToScore(field.rain.level);
    let detail = `${field.rain.maxPrecip.toFixed(1)} mm/h · ${field.rain.maxProbability}% prob`;
    if (field.rain.hailRisk) detail += ' · ⚠️ GRANIZO';
    results.push({
      id: 'rain-forecast',
      category: 'rain',
      severity: severityFromScore(score),
      score: field.rain.hailRisk ? Math.min(100, score + 20) : score,
      icon: field.rain.hailRisk ? '🌨️' : '🌧️',
      title: field.rain.hailRisk ? 'Riesgo de GRANIZO' : 'Lluvia prevista',
      detail,
      urgent: field.rain.hailRisk || field.rain.level === 'critico',
      updatedAt: now,
    });
  }

  // Fog
  if (field.fog.level !== 'none') {
    const score = campoLevelToScore(field.fog.level);
    const spreadStr = field.fog.spread != null ? `ΔT=${field.fog.spread.toFixed(1)}°C` : '';
    results.push({
      id: 'fog-alert',
      category: 'fog',
      severity: severityFromScore(score),
      score,
      icon: '🌫️',
      title: field.fog.level === 'critico' ? 'NIEBLA INMINENTE' : 'Riesgo de niebla',
      detail: `${spreadStr} · ${field.fog.confidence}% confianza`,
      urgent: field.fog.level === 'critico',
      updatedAt: now,
    });
  }

  // Drone
  if (!field.drone.flyable) {
    results.push({
      id: 'drone-nogo',
      category: 'drone',
      severity: 'moderate',
      score: 35,
      icon: '🛩️',
      title: 'NO VOLAR',
      detail: field.drone.reasons.slice(0, 2).join(' · '),
      urgent: false,
      updatedAt: now,
    });
  }

  // Wind propagation
  if (field.wind.active) {
    const score = Math.min(100, 25 + field.wind.confidence * 0.5);
    let detail = `${field.wind.directionLabel} · ${field.wind.avgIncreaseKt.toFixed(1)} kt/10min`;
    if (field.wind.estimatedArrivalMin != null) {
      detail += ` · ETA ~${field.wind.estimatedArrivalMin.toFixed(0)} min`;
    }
    results.push({
      id: 'wind-front',
      category: 'wind-front',
      severity: severityFromScore(score),
      score,
      icon: '📡',
      title: 'Frente de viento detectado',
      detail,
      urgent: false,
      updatedAt: now,
    });
  }

  return results;
}

// ── Composite risk index ─────────────────────────────────────

export function computeCompositeRisk(alerts: UnifiedAlert[]): CompositeRisk {
  if (alerts.length === 0) {
    return { score: 0, severity: 'info', color: 'green', activeCount: 0 };
  }

  // Weighted max: the highest (score × weight) determines overall risk
  let maxWeightedScore = 0;
  let activeCount = 0;

  for (const a of alerts) {
    if (a.severity !== 'info') activeCount++;
    const weighted = a.score * (CATEGORY_WEIGHT[a.category] ?? 1);
    if (weighted > maxWeightedScore) maxWeightedScore = weighted;
  }

  // Normalize back to 0-100 (max possible weight is 3.0 for storm)
  const normalizedScore = Math.min(100, Math.round(maxWeightedScore / 3));
  // But never less than the raw max score
  const finalScore = Math.max(normalizedScore, Math.max(...alerts.map(a => a.score)));
  const severity = severityFromScore(finalScore);

  return {
    score: finalScore,
    severity,
    color: colorFromSeverity(severity),
    activeCount,
  };
}

// ── Main aggregator — call this from AppShell ────────────────

export function aggregateAllAlerts(sources: {
  stormAlert: StormAlert | null;
  thermalProfile: ThermalProfile | null;
  zoneAlerts: Map<MicroZoneId, ZoneAlert>;
  fieldAlerts: FieldAlerts | null;
}): { alerts: UnifiedAlert[]; risk: CompositeRisk } {
  const allAlerts: UnifiedAlert[] = [
    ...(sources.stormAlert ? buildStormAlerts(sources.stormAlert) : []),
    ...buildInversionAlerts(sources.thermalProfile),
    ...buildThermalAlerts(sources.zoneAlerts),
    ...buildFieldAlerts(sources.fieldAlerts),
  ];

  // Sort by score descending (highest priority first)
  allAlerts.sort((a, b) => b.score - a.score);

  return {
    alerts: allAlerts,
    risk: computeCompositeRisk(allAlerts),
  };
}
