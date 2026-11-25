/**
 * Field (campo) alert builder — converts FieldAlerts into UnifiedAlert[].
 *
 * Handles frost, rain/hail and fog from the field conditions.
 */

import type { FieldAlerts, AlertLevel as CampoAlertLevel } from '../../types/campo';
import type { TeleconnectionIndex } from '../../api/naoClient';
import type { UnifiedAlert } from './types';
import { severityFromScore } from './riskEngine';
import { dayWord } from './whenText';
import { msToKnots } from '../windUtils';

// ── Helpers ──────────────────────────────────────────────────

const FROST_SCORE_CAP = 50;

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
    // One forecast point, and it warns of 23 % of the frosts measured at Ourense stations: it goes in
    // the folded «En el campo» without alert colours, so it never lights the red band nor turns urgent.
    // Reopen at the end of the shadow exam (31-mar, POD >= 0.70, FAR <= 0.20).
    const score = Math.min(campoLevelToScore(field.frost.level), FROST_SCORE_CAP);
    const tempStr = field.frost.minTemp != null ? `${field.frost.minTemp.toFixed(1)}°C` : '?';
    // The coldest hour with its day: it can be another night, not always tonight.
    const tw = field.frost.timeWindow;
    const coldest = tw ? new Date((tw.from.getTime() + tw.to.getTime()) / 2) : null;
    const timeStr = coldest ? ` · ${dayWord(coldest, now)} hacia las ${coldest.getHours()} h` : '';
    const cloudStr = field.frost.cloudCover != null ? ` · nubes ${field.frost.cloudCover.toFixed(0)} %` : '';
    const windStr = field.frost.windSpeed != null ? ` · viento ${msToKnots(field.frost.windSpeed).toFixed(0)} kt` : '';
    let frostDetail = `Mín prevista ${tempStr}${timeStr}${cloudStr}${windStr}`;
    // NAO/AO context: negative phases amplify and sustain cold events
    if (nao && nao.value < -1) frostDetail += ' · NAO−: patrón frío persistente';
    else if (ao && ao.value < -1) frostDetail += ' · AO−: aire ártico activo';
    results.push({
      id: 'frost-forecast',
      category: 'frost',
      severity: severityFromScore(score),
      score,
      icon: 'snowflake',
      title: field.frost.level === 'critico' ? 'Helada fuerte prevista' : 'Riesgo de helada',
      detail: frostDetail,
      urgent: false,
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
    if (field.rain.hailRisk) detail += ' · posible granizo según el modelo (CAPE y lluvia), sin rayos ni radar que lo confirmen';

    // Title reflects imminence
    let title: string;
    if (field.rain.hailRisk) {
      title = 'Posible granizo (modelo)';
    } else if (field.rain.hoursUntilRain !== null && field.rain.hoursUntilRain <= 1) {
      title = 'Lluvia inminente';
    } else {
      title = 'Lluvia prevista';
    }

    // Hail here comes from the MODEL alone (CAPE > 1000 and > 5 mm/h): like the storm predictor
    // without lightning, it never goes past an AVISO (moderate) nor turns urgent. Before, it
    // was critical and lit the red banner from a forecast nobody had confirmed.
    const rainSeverity = field.rain.level === 'riesgo' ? 'info' as const
      : field.rain.hailRisk ? 'moderate' as const
      : severityFromScore(score);
    results.push({
      id: 'rain-forecast',
      category: 'rain',
      severity: rainSeverity,
      score: field.rain.hailRisk ? Math.min(score, 50) : score,
      icon: field.rain.hailRisk ? 'hail' : 'cloud-rain',
      title,
      detail,
      urgent: !field.rain.hailRisk && field.rain.level === 'critico',
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
      fogMeta: {
        type: 'radiative',
        windDir: null,
        windSpeed: field.fog.windSpeed ?? null,
        spread: field.fog.spread ?? null,
        webcamConfirmed: false,
      },
    });
  }

  return results;
}
