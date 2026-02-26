import type {
  ThermalWindRule, RuleScore, ScoreBreakdown,
  ZoneAlert, AlertLevel, MicroZoneId,
} from '../types/thermal';
import type { NormalizedReading } from '../types/station';
import { isDirectionInRange, averageWindDirection } from './windUtils';

/**
 * Score a single rule against current zone readings.
 *
 * Breakdown (0-100 total):
 *   Temperature:     0-25 pts
 *   Humidity:        0-20 pts
 *   Time of day:     0-15 pts
 *   Season (month):  0-10 pts
 *   Wind direction:  0-15 pts
 *   Wind speed:      0-15 pts
 */
export function scoreRule(
  rule: ThermalWindRule,
  zoneReadings: NormalizedReading[],
  currentTime: Date = new Date()
): RuleScore {
  if (!rule.enabled || zoneReadings.length === 0) {
    return {
      ruleId: rule.id,
      score: 0,
      breakdown: { temperature: 0, humidity: 0, timeOfDay: 0, season: 0, windDirection: 0, windSpeed: 0 },
      matchedZone: rule.expectedWind.zone,
    };
  }

  // Average current conditions in the zone
  const temps = zoneReadings.filter((r) => r.temperature !== null).map((r) => r.temperature!);
  const humids = zoneReadings.filter((r) => r.humidity !== null).map((r) => r.humidity!);
  const speeds = zoneReadings.filter((r) => r.windSpeed !== null).map((r) => r.windSpeed!);
  const dirs = zoneReadings.filter((r) => r.windDirection !== null).map((r) => r.windDirection!);

  const avgTemp = temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
  const avgHumidity = humids.length > 0 ? humids.reduce((a, b) => a + b, 0) / humids.length : null;
  const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null;
  const avgDir = averageWindDirection(dirs);

  const hour = currentTime.getHours();
  const month = currentTime.getMonth() + 1;

  const breakdown: ScoreBreakdown = {
    temperature: 0,
    humidity: 0,
    timeOfDay: 0,
    season: 0,
    windDirection: 0,
    windSpeed: 0,
  };

  // ── Temperature (0-25) ───────────────────────────────
  if (avgTemp !== null) {
    const { minTemp, maxTemp } = rule.conditions;
    if (minTemp !== undefined && maxTemp !== undefined) {
      if (avgTemp >= minTemp && avgTemp <= maxTemp) {
        breakdown.temperature = 25;
      } else if (avgTemp >= minTemp - 2 && avgTemp <= (maxTemp ?? 50) + 2) {
        breakdown.temperature = 15; // Close
      } else if (avgTemp >= (minTemp ?? 0) - 5) {
        breakdown.temperature = 5; // Approaching
      }
    } else if (minTemp !== undefined) {
      if (avgTemp >= minTemp) {
        breakdown.temperature = 25;
      } else if (avgTemp >= minTemp - 3) {
        breakdown.temperature = Math.round(25 * (1 - (minTemp - avgTemp) / 3));
      }
    } else if (maxTemp !== undefined) {
      if (avgTemp <= maxTemp) {
        breakdown.temperature = 25;
      } else if (avgTemp <= maxTemp + 3) {
        breakdown.temperature = Math.round(25 * (1 - (avgTemp - maxTemp) / 3));
      }
    } else {
      breakdown.temperature = 15; // No temp constraint → partial match
    }
  }

  // ── Humidity (0-20) ──────────────────────────────────
  if (avgHumidity !== null) {
    const { minHumidity, maxHumidity } = rule.conditions;
    if (minHumidity !== undefined && avgHumidity >= minHumidity) {
      breakdown.humidity = 20;
    } else if (minHumidity !== undefined && avgHumidity >= minHumidity - 10) {
      breakdown.humidity = Math.round(20 * (1 - (minHumidity - avgHumidity) / 10));
    } else if (maxHumidity !== undefined && avgHumidity <= maxHumidity) {
      breakdown.humidity = 20;
    } else if (minHumidity === undefined && maxHumidity === undefined) {
      breakdown.humidity = 12; // No constraint → partial
    }
  }

  // ── Time of day (0-15) ───────────────────────────────
  const { timeWindow } = rule.conditions;
  if (timeWindow) {
    const { from, to } = timeWindow;
    if (from <= to) {
      if (hour >= from && hour <= to) {
        breakdown.timeOfDay = 15;
      } else {
        const dist = Math.min(Math.abs(hour - from), Math.abs(hour - to));
        if (dist <= 2) breakdown.timeOfDay = Math.round(15 * (1 - dist / 2));
      }
    } else {
      // Overnight (e.g., 22-6)
      if (hour >= from || hour <= to) {
        breakdown.timeOfDay = 15;
      } else {
        const distFrom = Math.min(Math.abs(hour - from), 24 - Math.abs(hour - from));
        const distTo = Math.min(Math.abs(hour - to), 24 - Math.abs(hour - to));
        const dist = Math.min(distFrom, distTo);
        if (dist <= 2) breakdown.timeOfDay = Math.round(15 * (1 - dist / 2));
      }
    }
  } else {
    breakdown.timeOfDay = 10; // No time constraint → partial
  }

  // ── Season / month (0-10) ────────────────────────────
  if (rule.conditions.months && rule.conditions.months.length > 0) {
    if (rule.conditions.months.includes(month)) {
      breakdown.season = 10;
    } else {
      // Adjacent month
      const adjacent = rule.conditions.months.some(
        (m) => Math.abs(m - month) === 1 || Math.abs(m - month) === 11
      );
      if (adjacent) breakdown.season = 5;
    }
  } else {
    breakdown.season = 7; // No month constraint → partial
  }

  // ── Wind direction (0-15) ────────────────────────────
  if (avgDir !== null) {
    if (isDirectionInRange(avgDir, rule.expectedWind.directionRange)) {
      breakdown.windDirection = 15;
    } else {
      // Partial: within ±30° of range boundary
      const { from, to } = rule.expectedWind.directionRange;
      const distFrom = Math.abs(((avgDir - from + 180) % 360) - 180);
      const distTo = Math.abs(((avgDir - to + 180) % 360) - 180);
      const minDist = Math.min(distFrom, distTo);
      if (minDist <= 30) {
        breakdown.windDirection = Math.round(15 * (1 - minDist / 30));
      }
    }
  }

  // ── Wind speed (0-15) ────────────────────────────────
  if (avgSpeed !== null) {
    if (avgSpeed >= rule.expectedWind.minSpeed) {
      breakdown.windSpeed = 15;
    } else if (avgSpeed >= rule.expectedWind.minSpeed * 0.5) {
      const ratio = avgSpeed / rule.expectedWind.minSpeed;
      breakdown.windSpeed = Math.round(15 * ratio);
    }
  }

  const score = breakdown.temperature + breakdown.humidity + breakdown.timeOfDay +
    breakdown.season + breakdown.windDirection + breakdown.windSpeed;

  return {
    ruleId: rule.id,
    score: Math.min(100, score),
    breakdown,
    matchedZone: rule.expectedWind.zone,
  };
}

/**
 * Score all rules against current readings, grouped by zone.
 */
export function scoreAllRules(
  rules: ThermalWindRule[],
  zoneReadingsMap: Map<MicroZoneId, NormalizedReading[]>,
  currentTime: Date = new Date()
): RuleScore[] {
  const scores: RuleScore[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const readings = zoneReadingsMap.get(rule.expectedWind.zone) || [];
    scores.push(scoreRule(rule, readings, currentTime));
  }

  return scores;
}

/**
 * Compute zone alert levels from rule scores.
 */
export function computeZoneAlerts(
  scores: RuleScore[],
  threshold = 30
): Map<MicroZoneId, ZoneAlert> {
  const alerts = new Map<MicroZoneId, ZoneAlert>();

  // Group scores by zone
  const byZone = new Map<MicroZoneId, RuleScore[]>();
  for (const score of scores) {
    const zone = score.matchedZone;
    const list = byZone.get(zone) || [];
    list.push(score);
    byZone.set(zone, list);
  }

  for (const [zoneId, zoneScores] of byZone) {
    const activeRules = zoneScores.filter((s) => s.score >= threshold);
    const maxScore = zoneScores.reduce((max, s) => Math.max(max, s.score), 0);

    let alertLevel: AlertLevel = 'none';
    if (maxScore >= 75) alertLevel = 'high';
    else if (maxScore >= 55) alertLevel = 'medium';
    else if (maxScore >= 30) alertLevel = 'low';

    alerts.set(zoneId, {
      zoneId,
      maxScore,
      activeRules,
      alertLevel,
    });
  }

  return alerts;
}
