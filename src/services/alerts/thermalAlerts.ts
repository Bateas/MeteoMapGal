/**
 * Inversion alert builder — converts thermal profile data into UnifiedAlert[].
 *
 * Note: the previous `buildThermalAlerts(zoneAlerts)` that
 * emitted one alert per micro-zone of Castrelo (embalse / carballino / norte /
 * ourense / ...) was removed. It was redundant with thermalPrecursorService
 * (single 7-signal probability) + the Thermal tab (Embalse-only breakdown),
 * spammed 5 alerts at once on Embalse, and leaked cross-sector into Rías
 * because the data flow had no sector gate. Zone breakdowns still live in
 * the Thermal tab (`ThermalWindPanel.tsx`) which is Embalse-only by design.
 */

import type { ThermalProfile } from '../lapseRateService';
import type { TeleconnectionIndex } from '../../api/naoClient';
import type { UnifiedAlert, AlertSeverity } from './types';

/**
 * Cap severity for inversion alerts — notable but not dangerous, max yellow.
 * Strong events with high scores deserve yellow, weak ones stay blue (info).
 */
function cappedSeverity(score: number): AlertSeverity {
  if (score >= 45) return 'moderate'; // Strong → yellow
  return 'info';                      // Weak → blue
}

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
    severity: cappedSeverity(score),
    score,
    icon: 'thermometer',
    title,
    detail,
    urgent: isStrong && rSquared >= 0.5,
    updatedAt: new Date(),
  }];
}
