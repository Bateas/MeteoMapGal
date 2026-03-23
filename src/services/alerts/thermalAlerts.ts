/**
 * Thermal and inversion alert builders — converts thermal profile and
 * zone alert data into UnifiedAlert[].
 */

import type { ThermalProfile } from '../lapseRateService';
import type { ZoneAlert, MicroZoneId } from '../../types/thermal';
import type { TeleconnectionIndex } from '../../api/naoClient';
import type { UnifiedAlert } from './types';

// ── Inversion alerts -> UnifiedAlert ──────────────────────────

export function buildInversionAlerts(
  profile: ThermalProfile | null,
  nao?: TeleconnectionIndex,
  ao?: TeleconnectionIndex,
): UnifiedAlert[] {
  if (!profile || !profile.hasInversion || !profile.regression) return [];

  const { slopePerKm, rSquared, stationCount } = profile.regression;
  const isStrong = profile.status === 'strong-inversion';

  // ── Nocturnal inversion filter ────────────────────────────
  const hour = new Date().getHours();
  const isNight = hour >= 21 || hour < 7;
  if (isNight && !isStrong) return [];

  // Score: slope +1 to +10 -> 30 to 100, scaled by R-squared
  const rawScore = Math.min(100, 30 + (slopePerKm - 1) * 7.8);
  const score = Math.round(rawScore * Math.min(1, rSquared / 0.5));

  const title = isStrong ? 'INVERSIÓN FUERTE' : 'Inversión térmica detectada';
  const nightNote = isNight ? ' (nocturna persistente)' : '';
  let detail = `${slopePerKm > 0 ? '+' : ''}${slopePerKm.toFixed(1)}°C/km · ${stationCount} est. · R²=${rSquared.toFixed(2)}${nightNote}`;

  // NAO/AO context: negative NAO = blocking pattern sustains inversions
  if (nao && nao.value < -0.5) detail += ' · NAO−: bloqueo persistente';
  else if (ao && ao.value < -0.5) detail += ' · AO−: aire frío atrapado';

  return [{
    id: 'inversion-main',
    category: 'inversion',
    severity: 'info',
    score,
    icon: 'thermometer',
    title,
    detail,
    urgent: isStrong && rSquared >= 0.5,
    updatedAt: new Date(),
  }];
}

// ── Thermal wind alerts -> UnifiedAlert ───────────────────────

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
      severity: 'info',
      score,
      icon: 'thermal-wind',
      title: `Térmico ${levelLabel} — ${zoneId}`,
      detail: `${score}% — ${za.activeRules.length} regla(s) activa(s)`,
      urgent: za.alertLevel === 'high' && score >= 70,
      updatedAt: new Date(),
      zoneId,
    });
  }
  return results;
}
