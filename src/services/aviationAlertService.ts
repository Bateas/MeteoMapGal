/**
 * Aviation proximity alert evaluation.
 * Pure function — computes alert level from aircraft positions.
 *
 * Wide bbox fetches aircraft across all Galicia for MAP DISPLAY.
 * Alerts only trigger based on distance to Embalse center:
 * - CRITICAL: < 1km + < 200m altitude
 * - MODERATE: < 3km + < 500m altitude + descending
 * - INFO: any aircraft within 15km
 * - NONE: no aircraft within alert radius
 */
import type { Aircraft, AviationAlert, AviationAlertLevel } from '../types/aviation';
import { ALERT_RADIUS } from '../types/aviation';

export function evaluateAviationAlert(aircraft: Aircraft[]): AviationAlert {
  // Only consider aircraft within alert radius (15km) for alerts
  const nearby = aircraft.filter((a) => a.distanceKm < ALERT_RADIUS.info);

  if (nearby.length === 0) {
    return {
      level: 'none',
      nearestAircraft: null,
      aircraftInBbox: aircraft.length,
      aircraftClose: 0,
      updatedAt: Date.now(),
    };
  }

  let level: AviationAlertLevel = 'info';
  let nearest: Aircraft | null = null;
  let minDist = Infinity;
  let closeCount = 0;

  for (const ac of nearby) {
    if (ac.distanceKm < minDist) {
      minDist = ac.distanceKm;
      nearest = ac;
    }

    if (ac.distanceKm < ALERT_RADIUS.moderate) {
      closeCount++;

      if (ac.distanceKm < ALERT_RADIUS.critical && ac.altitude < 200) {
        level = 'critical';
      } else if (ac.altitude < 500 && ac.verticalRate < 0 && level !== 'critical') {
        level = 'moderate';
      }
    }
  }

  return {
    level,
    nearestAircraft: nearest,
    aircraftInBbox: aircraft.length,
    aircraftClose: closeCount,
    updatedAt: Date.now(),
  };
}

/** Compute adaptive polling interval based on proximity to Embalse */
export function computePollingInterval(aircraft: Aircraft[]): number {
  const nearby = aircraft.filter((a) => a.distanceKm < ALERT_RADIUS.info);
  if (nearby.length === 0) return 60_000;
  const minDist = Math.min(...nearby.map((a) => a.distanceKm));
  if (minDist < ALERT_RADIUS.moderate) return 10_000;
  return 15_000;
}
