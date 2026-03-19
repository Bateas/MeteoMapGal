/**
 * Geolocation auto-sector — detects user's location and suggests the nearest sector.
 *
 * Uses navigator.geolocation.getCurrentPosition() once on first visit.
 * Compares distance to each sector center and switches if the user is
 * within 80km of a sector center different from the current one.
 *
 * Privacy: only runs once, position is not stored, fails silently.
 */

import { SECTORS } from '../config/sectors';
import { useSectorStore } from '../store/sectorStore';

/** Haversine distance in km between two [lon, lat] points */
function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Max distance (km) from sector center to auto-switch */
const MAX_DISTANCE_KM = 80;

/** localStorage key to avoid re-prompting */
const GEO_DONE_KEY = 'meteomap-geo-done';

/**
 * Attempt geolocation-based sector detection.
 * Runs once per device. Switches sector if user is closer to a different one.
 * Fails silently on denied permissions or errors.
 */
export function tryAutoSector(): void {
  // Only run once per device
  if (localStorage.getItem(GEO_DONE_KEY)) return;

  // Check browser support
  if (!navigator.geolocation) {
    localStorage.setItem(GEO_DONE_KEY, 'no-support');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      localStorage.setItem(GEO_DONE_KEY, 'done');

      const userLon = pos.coords.longitude;
      const userLat = pos.coords.latitude;

      // Find nearest sector
      let nearestId = '';
      let nearestDist = Infinity;

      for (const sector of SECTORS) {
        const dist = haversineKm(userLon, userLat, sector.center[0], sector.center[1]);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestId = sector.id;
        }
      }

      // Only switch if within range and different from current
      const current = useSectorStore.getState().activeSector.id;
      if (nearestId && nearestId !== current && nearestDist < MAX_DISTANCE_KM) {
        console.debug(`[Geolocation] User is ${Math.round(nearestDist)}km from ${nearestId}, switching`);
        useSectorStore.getState().switchSector(nearestId);
      }
    },
    () => {
      // Permission denied or error — mark as done, don't retry
      localStorage.setItem(GEO_DONE_KEY, 'denied');
    },
    { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
  );
}
