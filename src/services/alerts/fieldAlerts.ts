/**
 * Field (campo) alert builder — converts FieldAlerts into UnifiedAlert[].
 *
 * Handles frost, rain/hail, fog, and drone alerts from agricultural
 * and operational field conditions.
 */

import type { FieldAlerts, AlertLevel as CampoAlertLevel } from '../../types/campo';
import type { TeleconnectionIndex } from '../../api/naoClient';
import type { UnifiedAlert } from './types';
import { severityFromScore } from './riskEngine';

// ── Helpers ──────────────────────────────────────────────────

export function campoLevelToScore(level: CampoAlertLevel): number {
  switch (level) {
    case 'critico': return 85;
    case 'alto':    return 55;
    case 'riesgo':  return 30;
    default:        return 0;
  }
}

// ── Campo (field) alerts -> UnifiedAlert ──────────────────────

export function buildFieldAlerts(
  field: FieldAlerts | null,
  nao?: TeleconnectionIndex,
  ao?: TeleconnectionIndex,
): UnifiedAlert[] {
  if (!field) return [];
  const now = new Date();
  const results: UnifiedAlert[] = [];

  // Frost
  if (field.frost.level !== 'none') {
    const score = campoLevelToScore(field.frost.level);
    const tempStr = field.frost.minTemp != null ? `${field.frost.minTemp.toFixed(1)}°C` : '?';
    let frostDetail = `Mín prevista ${tempStr}`;
    // NAO/AO context: negative phases amplify and sustain cold events
    if (nao && nao.value < -1) frostDetail += ' · NAO−: patrón frío persistente';
    else if (ao && ao.value < -1) frostDetail += ' · AO−: aire ártico activo';
    results.push({
      id: 'frost-forecast',
      category: 'frost',
      severity: severityFromScore(score),
      score,
      icon: 'snowflake',
      title: field.frost.level === 'critico' ? 'HELADA SEVERA' : 'Riesgo de helada',
      detail: frostDetail,
      urgent: field.frost.level === 'critico',
      updatedAt: now,
    });
  }

  // Rain / Hail
  if (field.rain.level !== 'none') {
    const score = campoLevelToScore(field.rain.level);

    // Temporal context: WHEN is rain expected?
    let timeLabel: string;
    if (field.rain.hoursUntilRain !== null && field.rain.hoursUntilRain <= 1) {
      timeLabel = 'inminente';
    } else if (field.rain.hoursUntilRain !== null && field.rain.hoursUntilRain <= 3) {
      timeLabel = `en ~${Math.round(field.rain.hoursUntilRain)}h`;
    } else if (field.rain.firstRainAt) {
      timeLabel = `~${field.rain.firstRainAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
    } else {
      timeLabel = 'próximas horas';
    }

    let detail = `${field.rain.maxPrecip.toFixed(1)} mm/h · ${timeLabel}`;
    if (field.rain.rainAccum6h > 0) detail += ` · ${field.rain.rainAccum6h}mm en 6h`;
    if (field.rain.hailRisk) detail += ' · GRANIZO';

    // Title reflects imminence
    let title: string;
    if (field.rain.hailRisk) {
      title = 'Riesgo de GRANIZO';
    } else if (field.rain.hoursUntilRain !== null && field.rain.hoursUntilRain <= 1) {
      title = 'Lluvia inminente';
    } else {
      title = 'Lluvia prevista';
    }

    const rainSeverity = field.rain.level === 'riesgo' ? 'info' as const : severityFromScore(score);
    results.push({
      id: 'rain-forecast',
      category: 'rain',
      severity: rainSeverity,
      score: Math.min(100, field.rain.hailRisk ? score + 20 : score),
      icon: field.rain.hailRisk ? 'hail' : 'cloud-rain',
      title,
      detail,
      urgent: field.rain.hailRisk || field.rain.level === 'critico',
      updatedAt: now,
    });
  }

  // Fog
  if (field.fog.level !== 'none') {
    const score = campoLevelToScore(field.fog.level);
    const spreadStr = field.fog.spread != null ? `ΔT=${field.fog.spread.toFixed(1)}°C` : '';
    const fogSeverity = field.fog.level === 'critico' ? severityFromScore(score) : 'info' as const;
    results.push({
      id: 'fog-alert',
      category: 'fog',
      severity: fogSeverity,
      score,
      icon: 'fog',
      title: field.fog.level === 'critico' ? 'NIEBLA INMINENTE' : 'Riesgo de niebla',
      detail: [
        spreadStr,
        field.fog.spreadTrend !== null
          ? `${field.fog.spreadTrend > 0 ? '+' : ''}${field.fog.spreadTrend.toFixed(1)}°C/h`
          : '',
        field.fog.fogEta
          ? `ETA ~${field.fog.fogEta.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
          : '',
        `${field.fog.confidence}% confianza`,
      ].filter(Boolean).join(' · '),
      urgent: field.fog.level === 'critico',
      updatedAt: now,
      confidence: field.fog.confidence,
    });
  }

  // Drone — meteo conditions (score scales with reason count)
  if (!field.drone.flyable) {
    const droneReasons = field.drone.reasons.length;
    const droneScore = Math.min(100, 30 + droneReasons * 15); // 1 reason=45, 2=60, 3=75
    results.push({
      id: 'drone-nogo',
      category: 'drone',
      severity: severityFromScore(droneScore),
      score: droneScore,
      icon: 'drone',
      title: 'Dron: Precaución',
      detail: field.drone.reasons.slice(0, 2).join(' · '),
      urgent: false,
      updatedAt: now,
    });
  }

  // Drone — airspace restrictions: shown only in FieldDrawer Dron panel, not in general AlertPanel
  // (broad zone coverage doesn't warrant a persistent map-center alert)

  // Wind propagation: shown as ETA badge in Header bar, not in AlertPanel
  // (ETA is actionable time info that fits better in the persistent top bar)

  return results;
}
