/**
 * useSpotLightningRisk — per-spot lightning proximity for the active sector.
 *
 * Frontend half of the LOCAL lightning safety feature: reuses the exact same
 * pure service the ingestor runs for Telegram, so map and alerts can never
 * disagree about who is at risk.
 *
 * Debug: `?simstrike=<spotId>` injects a synthetic approaching storm around
 * that spot (same pattern as `?simfog=`) — lets us verify the banner in dev
 * and prod without waiting for real lightning. Survives esbuild console drop.
 */

import { useMemo } from 'react';
import { useLightningStore } from './useLightningData';
import { useSectorStore } from '../store/sectorStore';
import { getSpotsForSector } from '../config/spots';
import {
  assessSpotLightningRisk,
  type ProximityStrike,
  type SpotLightningRisk,
} from '../services/lightningProximityService';

/** ~1km in degrees of latitude at Galician latitudes */
const KM_LAT = 0.009;

/** Synthetic approaching storm NE of the spot: recent strikes closer than the
 *  older ones so the trend reads "acercándose" with a plausible ETA. */
function buildSimulatedStrikes(spotLat: number, spotLon: number, now: number): ProximityStrike[] {
  const mk = (kmNorth: number, ageMin: number): ProximityStrike => ({
    lat: spotLat + kmNorth * KM_LAT,
    lon: spotLon,
    time: new Date(now - ageMin * 60_000),
  });
  return [mk(6, 2), mk(8, 4), mk(15, 6), mk(18, 12), mk(20, 16)];
}

function getSimStrikeSpotId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return new URLSearchParams(window.location.search).get('simstrike');
  } catch {
    return null;
  }
}

export function useSpotLightningRisk(): SpotLightningRisk[] {
  const strikes = useLightningStore((s) => s.strikes);
  const sectorId = useSectorStore((s) => s.activeSector.id);

  return useMemo(() => {
    const spots = getSpotsForSector(sectorId).map((s) => ({
      id: s.id,
      name: s.shortName,
      lat: s.center[1],
      lon: s.center[0],
      sector: sectorId,
    }));

    const simSpotId = getSimStrikeSpotId();
    if (simSpotId) {
      const target = spots.find((s) => s.id === simSpotId);
      if (target) {
        return assessSpotLightningRisk(
          spots, buildSimulatedStrikes(target.lat, target.lon, Date.now()),
        );
      }
    }

    if (strikes.length === 0) return [];
    const proximity: ProximityStrike[] = [];
    for (const s of strikes) {
      if (s.cloudToCloud) continue; // ground strikes only — same rule as the ingestor
      proximity.push({ lat: s.lat, lon: s.lon, time: new Date(s.timestamp) });
    }
    return assessSpotLightningRisk(spots, proximity);
  }, [strikes, sectorId]);
}
