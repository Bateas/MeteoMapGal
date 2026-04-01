/**
 * Aviation proximity alert evaluation.
 * Pure function — computes alert level from aircraft positions.
 *
 * Alert levels:
 * - CRITICAL: < 1km + < 200m altitude
 * - MODERATE: < 3km + < 500m altitude + descending
 * - INFO: any aircraft in bbox (~15km)
 * - NONE: no aircraft detected
 */
import type { Aircraft, AviationAlert, AviationAlertLevel } from '../types/aviation';

export function evaluateAviationAlert(aircraft: Aircraft[]): AviationAlert {
  if (aircraft.length === 0) {
    return {
      level: 'none',
      nearestAircraft: null,
      aircraftInBbox: 0,
      aircraftClose: 0,
      updatedAt: Date.now(),
    };
  }

  let level: AviationAlertLevel = 'info';
  let nearest: Aircraft | null = null;
  let minDist = Infinity;
  let closeCount = 0;

  for (const ac of aircraft) {
    if (ac.distanceKm < minDist) {
      minDist = ac.distanceKm;
      nearest = ac;
    }

    if (ac.distanceKm < 3) {
      closeCount++;

      // CRITICAL: very close + very low
      if (ac.distanceKm < 1 && ac.altitude < 200) {
        level = 'critical';
      }
      // MODERATE: close + low + descending
      else if (ac.altitude < 500 && ac.verticalRate < 0 && level !== 'critical') {
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

/** Compute adaptive polling interval based on proximity */
export function computePollingInterval(aircraft: Aircraft[]): number {
  if (aircraft.length === 0) return 60_000; // 60s — no aircraft
  const minDist = Math.min(...aircraft.map((a) => a.distanceKm));
  if (minDist < 3) return 10_000;  // 10s — close aircraft
  return 15_000;                    // 15s — aircraft in bbox
}
