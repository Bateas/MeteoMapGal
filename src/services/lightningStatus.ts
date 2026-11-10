/**
 * What the lightning network MEASURED around the sector point, said as it is: how far the
 * nearest strike was, how many there were and when the last one fell. Pure.
 *
 * This replaces the storm «probability» and the «arrives in N min» on every surface. Checked
 * against the stored season (Apr-Nov 2026, 1,644 logged predictions against the strikes that
 * followed): «30-44 %» was followed by a storm at the point 14 % of the time and by a strike
 * somewhere within 80 km 70 % of the time, «Tormenta probable en la próxima hora» came true
 * 24 % of the time, and the nine signals did worse than the recent strikes alone. So the
 * surfaces say the measurement and its age, and nothing about what comes next.
 *
 * The LEVEL is not decided here: it is the lightning store's (`stormAlert.level`), which already
 * follows the validated safety rule of lightningProximityService.
 */
import type { StormAlertLevel } from '../types/lightning';
import { haversineDistance } from './geoUtils';

/** Same window as the store's alert. */
export const LIGHTNING_STATUS_WINDOW_MIN = 30;
/** Same radius as the store's «watch» ring. */
export const LIGHTNING_STATUS_REGION_KM = 80;
const NEAR_KM = 25;

export interface LightningStatus {
  level: StormAlertLevel;
  /** km to the nearest strike of the window, within the region; null with none */
  nearestKm: number | null;
  /** Strikes within 25 km in the window */
  count25: number;
  /** Strikes within 80 km in the window */
  count80: number;
  /** Minutes since the latest strike within the region; null with none */
  lastStrikeMin: number | null;
  /** Short label for a chip: «PELIGRO», «AVISO», «55 km» or «RAYOS» */
  chip: string;
  /** «Rayos a 12 km» (empty with none) */
  headline: string;
  /** «8 en 30 min a menos de 80 km, 3 a menos de 25 km · último hace 4 min» (empty with none) */
  detail: string;
  /** What to do, only where the validated safety rule backs it (aviso and peligro) */
  action: string | null;
}

const NONE: LightningStatus = {
  level: 'none', nearestKm: null, count25: 0, count80: 0, lastStrikeMin: null,
  chip: 'RAYOS', headline: '', detail: '', action: null,
};

export function formatStrikeKm(km: number): string {
  return km < 1 ? 'menos de 1 km' : `${Math.round(km)} km`;
}

export function formatStrikeAge(min: number): string {
  return min < 1 ? 'último hace menos de 1 min' : `último hace ${Math.round(min)} min`;
}

export function lightningStatus(
  strikes: readonly { lat: number; lon: number; timestamp: number }[],
  centerLat: number,
  centerLon: number,
  level: StormAlertLevel,
  nowMs: number,
): LightningStatus {
  let nearest = Infinity;
  let count25 = 0;
  let count80 = 0;
  let latest = -Infinity;
  for (const s of strikes) {
    const age = nowMs - s.timestamp;
    if (age < 0 || age > LIGHTNING_STATUS_WINDOW_MIN * 60_000) continue;
    const km = haversineDistance(centerLat, centerLon, s.lat, s.lon);
    if (!(km <= LIGHTNING_STATUS_REGION_KM)) continue;
    count80++;
    if (km <= NEAR_KM) count25++;
    if (km < nearest) nearest = km;
    if (s.timestamp > latest) latest = s.timestamp;
  }
  // No strike in the window: nothing measured to say, whatever level a stale alert still holds.
  if (count80 === 0) return NONE;

  const lastStrikeMin = (nowMs - latest) / 60_000;
  const shown: StormAlertLevel = level === 'none' ? 'watch' : level;
  const where = formatStrikeKm(nearest);
  const counts = count25 > 0 && count25 < count80
    ? `${count80} en 30 min a menos de 80 km, ${count25} a menos de 25 km`
    : count25 > 0
    ? `${count25} en 30 min a menos de 25 km`
    : `${count80} en 30 min a menos de 80 km`;
  return {
    level: shown,
    nearestKm: Math.round(nearest * 10) / 10,
    count25,
    count80,
    lastStrikeMin: Math.round(lastStrikeMin),
    chip: shown === 'danger' ? 'PELIGRO' : shown === 'warning' ? 'AVISO' : nearest < 1 ? '<1 km' : where,
    headline: `Rayos a ${where}`,
    detail: `${counts} · ${formatStrikeAge(lastStrikeMin)}`,
    action: shown === 'danger'
      ? 'Fuera del agua y a cubierto.'
      : shown === 'warning'
      ? 'Tormenta activa cerca: no te alejes de la orilla.'
      : null,
  };
}
