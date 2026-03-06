/**
 * Wind Status Service — comprehensive real-time wind assessment.
 *
 * Combines current readings + reading history to produce a complete
 * wind picture: consensus, trend, direction spread, zone coherence,
 * and stability duration. This replaces the old "propagation only"
 * panel that was empty 95% of the time.
 *
 * Three pillars:
 *   1. Real-time consensus (current readings)
 *   2. Historical trend (readingHistory — recent past)
 *   3. Cross-station validation (inter-zone coherence)
 */

import { computeWindConsensus, type WindConsensus } from './dailyBriefingService';
import { computeDirectionSpread } from './windPropagationService';
import { msToKnots } from './windUtils';
import type { NormalizedReading, NormalizedStation } from '../types/station';
import type { MicroZoneId, MicroZone } from '../types/thermal';

// ── Types ────────────────────────────────────────────────────

export interface WindTrend {
  direction: 'rising' | 'stable' | 'falling';
  /** Positive = increasing wind speed (kt/h) */
  rateKtPerHour: number;
  /** Average speed in last 20 min (kt) */
  recentAvgKt: number;
  /** Average speed 20-40 min ago (kt) */
  previousAvgKt: number;
}

export interface ZoneWindSummary {
  zoneId: MicroZoneId;
  zoneName: string;
  /** Dominant wind direction (cardinal), null if no wind */
  dominantDir: string | null;
  /** Average wind speed across zone stations (kt) */
  avgSpeedKt: number;
  /** Number of stations reporting wind in this zone */
  stationCount: number;
  /** true if this zone's dominant direction matches the global consensus */
  agrees: boolean;
}

export interface WindStatus {
  /** Global wind consensus from all stations */
  consensus: WindConsensus | null;
  /** Wind speed trend from historical readings */
  trend: WindTrend | null;
  /** Direction spread in degrees (lower = more consistent) */
  spreadDeg: number | null;
  /** Per-zone wind summary with coherence flags */
  zoneSummaries: ZoneWindSummary[];
  /** How long the current consensus direction has held (minutes), null if no consensus */
  consensusDurationMin: number | null;
  /** Rough stability estimate in hours, null if insufficient data */
  stableHours: number | null;
}

// ── Cardinal helpers ─────────────────────────────────────────

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

function degToCardinal8(deg: number): string {
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return CARDINALS[idx];
}

function angularDifference(a: number, b: number): number {
  return Math.abs(((a - b) + 180) % 360 - 180);
}

// ── Main entry point ─────────────────────────────────────────

export function computeWindStatus(
  currentReadings: Map<string, NormalizedReading>,
  readingHistory: Map<string, NormalizedReading[]>,
  stations: NormalizedStation[],
  stationToZone: Map<string, MicroZoneId>,
  zones: MicroZone[],
): WindStatus {
  // 1. Global consensus (reuses existing function)
  const consensus = computeWindConsensus(currentReadings);

  // 2. Direction spread (reuses existing function)
  const spreadDeg = computeDirectionSpread(currentReadings);

  // 3. Wind trend from history
  const trend = computeWindTrend(readingHistory);

  // 4. Per-zone summaries with coherence check
  const zoneSummaries = computeZoneWindSummaries(
    currentReadings, stationToZone, zones, consensus,
  );

  // 5. Consensus duration from history
  const { durationMin, stableHours } = estimateConsensusDuration(
    readingHistory, stationToZone, consensus,
  );

  return {
    consensus,
    trend,
    spreadDeg,
    zoneSummaries,
    consensusDurationMin: durationMin,
    stableHours,
  };
}

// ── Wind trend computation ───────────────────────────────────

/**
 * Compare average wind speed in last 20min vs 20-40min ago.
 * Uses ALL stations with history to get a robust trend signal.
 */
function computeWindTrend(
  readingHistory: Map<string, NormalizedReading[]>,
): WindTrend | null {
  const now = Date.now();
  const RECENT_WINDOW = 20 * 60 * 1000;  // 0-20 min ago
  const PREVIOUS_WINDOW_START = 20 * 60 * 1000; // 20 min ago
  const PREVIOUS_WINDOW_END = 40 * 60 * 1000;   // 40 min ago

  const recentSpeeds: number[] = [];
  const previousSpeeds: number[] = [];

  for (const [, history] of readingHistory) {
    for (const reading of history) {
      if (reading.windSpeed === null || reading.windSpeed < 0) continue;

      const age = now - reading.timestamp.getTime();
      if (age < 0) continue; // future reading, skip

      const speedKt = msToKnots(reading.windSpeed);

      if (age <= RECENT_WINDOW) {
        recentSpeeds.push(speedKt);
      } else if (age >= PREVIOUS_WINDOW_START && age <= PREVIOUS_WINDOW_END) {
        previousSpeeds.push(speedKt);
      }
    }
  }

  // Need data in both windows
  if (recentSpeeds.length < 2 || previousSpeeds.length < 2) return null;

  const recentAvg = recentSpeeds.reduce((a, b) => a + b, 0) / recentSpeeds.length;
  const previousAvg = previousSpeeds.reduce((a, b) => a + b, 0) / previousSpeeds.length;

  const diff = recentAvg - previousAvg;
  // Rate in kt/h: diff over 20min window → multiply by 3
  const rateKtPerHour = diff * 3;

  let direction: WindTrend['direction'];
  if (rateKtPerHour > 1.0) {
    direction = 'rising';
  } else if (rateKtPerHour < -1.0) {
    direction = 'falling';
  } else {
    direction = 'stable';
  }

  return {
    direction,
    rateKtPerHour,
    recentAvgKt: recentAvg,
    previousAvgKt: previousAvg,
  };
}

// ── Per-zone wind summaries ──────────────────────────────────

function computeZoneWindSummaries(
  currentReadings: Map<string, NormalizedReading>,
  stationToZone: Map<string, MicroZoneId>,
  zones: MicroZone[],
  globalConsensus: WindConsensus | null,
): ZoneWindSummary[] {
  const summaries: ZoneWindSummary[] = [];

  for (const zone of zones) {
    // Collect readings for this zone
    const zoneReadings: { dir: number; speedKt: number }[] = [];

    for (const [stationId, reading] of currentReadings) {
      if (stationToZone.get(stationId) !== zone.id) continue;
      if (reading.windSpeed === null || reading.windDirection === null) continue;

      const speedKt = msToKnots(reading.windSpeed);
      if (speedKt < 1) continue; // skip calm

      zoneReadings.push({ dir: reading.windDirection, speedKt });
    }

    if (zoneReadings.length === 0) {
      summaries.push({
        zoneId: zone.id,
        zoneName: zone.name,
        dominantDir: null,
        avgSpeedKt: 0,
        stationCount: 0,
        agrees: false,
      });
      continue;
    }

    // Find dominant direction using same ±45° sector approach
    let bestGroup: typeof zoneReadings = [];
    let bestCenter = 0;

    for (let center = 0; center < 360; center += 45) {
      const group = zoneReadings.filter(
        (r) => angularDifference(r.dir, center) <= 45,
      );
      if (group.length > bestGroup.length) {
        bestGroup = group;
        bestCenter = center;
      }
    }

    const dominantDir = bestGroup.length > 0 ? degToCardinal8(bestCenter) : null;
    const avgSpeedKt = zoneReadings.reduce((s, r) => s + r.speedKt, 0) / zoneReadings.length;

    // Check if zone agrees with global consensus (same cardinal direction)
    const agrees = globalConsensus !== null && dominantDir === globalConsensus.dominantDir;

    summaries.push({
      zoneId: zone.id,
      zoneName: zone.name,
      dominantDir,
      avgSpeedKt,
      stationCount: zoneReadings.length,
      agrees,
    });
  }

  return summaries;
}

// ── Consensus duration estimation ────────────────────────────

/**
 * Walk backwards through readingHistory to estimate how long
 * the current consensus direction has been dominant.
 *
 * Checks 10-minute windows going back up to 6 hours.
 */
function estimateConsensusDuration(
  readingHistory: Map<string, NormalizedReading[]>,
  stationToZone: Map<string, MicroZoneId>,
  currentConsensus: WindConsensus | null,
): { durationMin: number | null; stableHours: number | null } {
  if (!currentConsensus) return { durationMin: null, stableHours: null };

  const now = Date.now();
  const STEP_MS = 10 * 60 * 1000; // 10-minute steps
  const MAX_LOOKBACK = 6 * 60 * 60 * 1000; // 6 hours max

  let stableMinutes = 0;

  // Walk backwards in 10-min increments
  for (let offset = STEP_MS; offset <= MAX_LOOKBACK; offset += STEP_MS) {
    const windowStart = now - offset;
    const windowEnd = now - offset + STEP_MS;

    // Collect readings in this historical window
    const windowReadings = new Map<string, NormalizedReading>();

    for (const [stationId, history] of readingHistory) {
      // Find the reading closest to this window's midpoint
      let bestReading: NormalizedReading | null = null;
      let bestDist = Infinity;

      for (const r of history) {
        const t = r.timestamp.getTime();
        if (t >= windowStart && t < windowEnd) {
          const dist = Math.abs(t - (windowStart + STEP_MS / 2));
          if (dist < bestDist) {
            bestDist = dist;
            bestReading = r;
          }
        }
      }

      if (bestReading) {
        windowReadings.set(stationId, bestReading);
      }
    }

    // Need at least 3 stations to establish a historical consensus
    if (windowReadings.size < 3) break;

    // Compute consensus for this historical window
    const historicalConsensus = computeWindConsensus(windowReadings);

    // Check if same direction was dominant
    if (
      historicalConsensus &&
      historicalConsensus.dominantDir === currentConsensus.dominantDir &&
      historicalConsensus.avgSpeedKt >= 1.5 // at least some wind
    ) {
      stableMinutes += 10;
    } else {
      // Consensus broken — stop here
      break;
    }
  }

  if (stableMinutes === 0) {
    return { durationMin: null, stableHours: null };
  }

  return {
    durationMin: stableMinutes,
    stableHours: stableMinutes >= 60 ? Math.round(stableMinutes / 60 * 10) / 10 : null,
  };
}
