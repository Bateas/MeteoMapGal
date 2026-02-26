import type { MicroZone, PropagationEvent, MicroZoneId } from '../types/thermal';
import type { NormalizedReading } from '../types/station';
import { angleDifference, averageWindDirection } from './windUtils';
import { PROPAGATION_AXIS } from '../config/thermalZones';

/**
 * Compute wind direction trend for a zone over a time window.
 * Returns the direction shift in degrees (positive = clockwise rotation).
 */
function computeDirectionTrend(
  readings: NormalizedReading[],
  windowMs: number
): { shift: number; currentDir: number | null; previousDir: number | null } {
  const now = Date.now();
  const cutoff = now - windowMs;
  const midpoint = now - windowMs / 2;

  // Split readings into first half and second half of the window
  const recentDirs: (number | null)[] = [];
  const olderDirs: (number | null)[] = [];

  for (const r of readings) {
    const ts = r.timestamp.getTime();
    if (ts < cutoff) continue;

    if (ts >= midpoint) {
      recentDirs.push(r.windDirection);
    } else {
      olderDirs.push(r.windDirection);
    }
  }

  const avgRecent = averageWindDirection(recentDirs);
  const avgOlder = averageWindDirection(olderDirs);

  if (avgRecent === null || avgOlder === null) {
    return { shift: 0, currentDir: avgRecent, previousDir: avgOlder };
  }

  // Signed angle difference (positive = clockwise)
  let diff = avgRecent - avgOlder;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;

  return { shift: diff, currentDir: avgRecent, previousDir: avgOlder };
}

/**
 * Detect wind direction propagation between zones.
 *
 * Checks if an upstream zone has shifted direction by >30° while
 * a downstream zone hasn't yet, suggesting the shift will propagate.
 */
export function detectPropagation(
  zones: MicroZone[],
  readingHistory: Map<string, NormalizedReading[]>,
  stationToZone: Map<string, MicroZoneId>,
  windowMin = 60
): PropagationEvent[] {
  const events: PropagationEvent[] = [];
  const windowMs = windowMin * 60 * 1000;

  // Group readings by zone
  const zoneReadings = new Map<MicroZoneId, NormalizedReading[]>();
  for (const [stationId, history] of readingHistory) {
    const zoneId = stationToZone.get(stationId);
    if (!zoneId) continue;

    const existing = zoneReadings.get(zoneId) || [];
    existing.push(...history);
    zoneReadings.set(zoneId, existing);
  }

  // Compute trends for each zone
  const zoneTrends = new Map<
    MicroZoneId,
    { shift: number; currentDir: number | null; previousDir: number | null }
  >();

  for (const zone of zones) {
    const readings = zoneReadings.get(zone.id) || [];
    const trend = computeDirectionTrend(readings, windowMs);
    zoneTrends.set(zone.id, trend);
  }

  // Check propagation axis for direction shift events
  for (const [sourceId, targetId, distKm] of PROPAGATION_AXIS) {
    const sourceTrend = zoneTrends.get(sourceId as MicroZoneId);
    const targetTrend = zoneTrends.get(targetId as MicroZoneId);

    if (!sourceTrend || !targetTrend) continue;

    const sourceShift = Math.abs(sourceTrend.shift);
    const targetShift = Math.abs(targetTrend.shift);

    // Source zone shifted >30° but target hasn't (>15° less shift)
    if (sourceShift > 30 && targetShift < sourceShift - 15) {
      // Estimate arrival time: ~15 km/h wind propagation speed
      const estimatedArrivalMin = Math.round((distKm / 15) * 60);

      events.push({
        sourceZone: sourceId as MicroZoneId,
        targetZone: targetId as MicroZoneId,
        directionShift: sourceTrend.shift,
        estimatedArrivalMin,
        detectedAt: new Date(),
      });
    }
  }

  return events;
}
