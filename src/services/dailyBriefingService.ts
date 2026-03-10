/**
 * Wind consensus computation from real-time station readings.
 *
 * Previously this file contained the full DailySailingBriefing scoring engine.
 * That was superseded by the unified SpotSelector + spotScoringEngine.
 * Only computeWindConsensus remains (used by windStatusService).
 */
import type { NormalizedReading } from '../types/station';
import { msToKnots, degToCardinal8 } from './windUtils';

// ── Types ────────────────────────────────────────────────────

export interface WindConsensus {
  /** Number of stations reporting consistent wind direction */
  stationCount: number;
  /** Average wind speed across consensus stations (kt) */
  avgSpeedKt: number;
  /** Dominant wind direction (cardinal) */
  dominantDir: string;
}

// ── Real-time wind consensus ─────────────────────────────────

/**
 * Compute wind consensus from real-time station readings.
 * Groups stations reporting wind in the same ±45° sector.
 * Returns the largest group with avg speed ≥ 2kt (real wind).
 */
export function computeWindConsensus(
  currentReadings: Map<string, NormalizedReading>,
): WindConsensus | null {
  // Collect all stations with valid wind data (≥2kt to exclude calm/noise)
  const windStations: { dir: number; speedKt: number }[] = [];

  for (const [, reading] of currentReadings) {
    if (
      reading.windSpeed !== null &&
      reading.windDirection !== null &&
      msToKnots(reading.windSpeed) >= 2
    ) {
      windStations.push({
        dir: reading.windDirection,
        speedKt: msToKnots(reading.windSpeed),
      });
    }
  }

  if (windStations.length < 2) return null;

  // For each possible 90° sector centered on a cardinal (8 sectors),
  // count how many stations fall within ±45°
  let bestGroup: typeof windStations = [];
  let bestCardinal = 'N';

  for (let sectorCenter = 0; sectorCenter < 360; sectorCenter += 45) {
    const group = windStations.filter((ws) => {
      const diff = Math.abs(((ws.dir - sectorCenter) + 180) % 360 - 180);
      return diff <= 45;
    });

    if (group.length > bestGroup.length) {
      bestGroup = group;
      bestCardinal = degToCardinal8(sectorCenter);
    }
  }

  if (bestGroup.length < 2) return null;

  const avgSpeed = bestGroup.reduce((sum, ws) => sum + ws.speedKt, 0) / bestGroup.length;

  // Return consensus if average is at least 2kt (real wind detected)
  if (avgSpeed < 2) return null;

  return {
    stationCount: bestGroup.length,
    avgSpeedKt: Math.round(avgSpeed * 10) / 10,
    dominantDir: bestCardinal,
  };
}
