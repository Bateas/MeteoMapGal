import type {
  ThermalWindRule, RuleScore, ScoreBreakdown,
  ZoneAlert, AlertLevel, MicroZoneId, DailyContext,
} from '../types/thermal';
import type { NormalizedReading } from '../types/station';
import { isDirectionInRange, averageWindDirection } from './windUtils';

/**
 * ΔT (diurnal range) scaling factor based on AEMET station analysis.
 * AEMET findings: ΔT > 20°C → 42% thermal probability, ΔT < 8°C → very low.
 */
function deltaTScaling(deltaT: number | null): number {
  if (deltaT === null) return 1.0; // no data → neutral
  if (deltaT >= 20) return 1.15;   // strong convection → 15% bonus
  if (deltaT >= 16) return 1.08;
  if (deltaT >= 12) return 1.0;    // normal → neutral
  if (deltaT >= 8) return 0.85;    // weak convection → penalty
  return 0.6;                      // very low ΔT → major penalty
}

/**
 * Month-proportional thermal score based on 7-year Open-Meteo Archive analysis.
 *
 * Historical thermal probability (valley avg):
 *   Aug: 48-50% (peak)  → 15 pts
 *   Jul: 40-43%         → 14 pts
 *   Jun: 20-24%         → 9 pts
 *   Sep: 18-22%         → 8 pts
 *   May/Oct (adjacent)  → 3 pts
 *
 * Source: openMeteoArchiveAnalysis.json, 854 days/point, 7 locations, 2019-2025
 */
function monthThermalScore(month: number, ruleMonths: number[]): number {
  if (!ruleMonths.includes(month)) {
    // Adjacent month (already passed hard gate, so it IS adjacent)
    return 3;
  }
  // Month-proportional scoring based on historical valley thermal probability
  switch (month) {
    case 8: return 15;  // Aug: 48-50% — peak reliability
    case 7: return 14;  // Jul: 40-43% — strong
    case 6: return 9;   // Jun: 20-24% — moderate, shorter days early month
    case 9: return 8;   // Sep: 18-22% — declining daylight/temps
    default: return 10; // Fallback for any other in-season month
  }
}

/**
 * Absolute minimum temperature (°C) for any thermal activity.
 * Below this, thermal wind is physically impossible regardless of other conditions.
 * Historical analysis: thermals never observed below ~20°C at valley stations.
 */
const ABSOLUTE_TEMP_FLOOR = 18;

/**
 * Score a single rule against current zone readings.
 *
 * HARD GATES (score = 0 immediately if any fails):
 *   1. Season: if months specified and current month is far outside range → 0
 *   2. Temperature floor: if avg temp < 18°C → 0 for thermal rules
 *   3. High humidity: if HR > 90% → 0 for thermal rules (fog/rain)
 *      Note: sensors spike to 100% easily with fog. 90% avg across zone
 *      stations is genuinely saturated.
 *
 * Soft scoring (0-100 total, weights based on historical reliability):
 *   Temperature:     0-25 pts  (reliable, strong thermal predictor)
 *   Time of day:     0-20 pts  (very reliable, anchored to solar cycle)
 *   Season (month):  0-15 pts  (month-proportional from 7yr data)
 *   Wind direction:  0-15 pts  (W dominant 74% at embalse, but can mislead)
 *   Wind speed:      0-15 pts  (thermal = 0→7-12kt ramp, key signal)
 *   Humidity:        0-10 pts  (sensors unreliable, reduced weight)
 *
 * After breakdown, score is scaled by ΔT factor (0.6 - 1.15) if daily context available.
 */
export function scoreRule(
  rule: ThermalWindRule,
  zoneReadings: NormalizedReading[],
  currentTime: Date = new Date(),
  dailyContext?: DailyContext
): RuleScore {
  const zeroScore: RuleScore = {
    ruleId: rule.id,
    score: 0,
    breakdown: { temperature: 0, humidity: 0, timeOfDay: 0, season: 0, windDirection: 0, windSpeed: 0 },
    matchedZone: rule.expectedWind.zone,
  };

  if (!rule.enabled || zoneReadings.length === 0) {
    return zeroScore;
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

  // ══════════════════════════════════════════════════════
  // HARD GATE 1: Season — completely out of season → score = 0
  // Only truly adjacent months get any credit (May for Jun rules, Oct for Sep rules)
  // February with summer rules → absolute zero
  // ══════════════════════════════════════════════════════
  if (rule.conditions.months && rule.conditions.months.length > 0) {
    const inSeason = rule.conditions.months.includes(month);
    const isAdjacent = rule.conditions.months.some(
      (m) => Math.abs(m - month) === 1 || Math.abs(m - month) === 11
    );
    if (!inSeason && !isAdjacent) {
      return zeroScore;
    }
  }

  // ══════════════════════════════════════════════════════
  // HARD GATE 2: Temperature floor — thermals physically impossible below 18°C
  // ══════════════════════════════════════════════════════
  if (avgTemp !== null && avgTemp < ABSOLUTE_TEMP_FLOOR && rule.id.startsWith('thermal_')) {
    return zeroScore;
  }

  // ══════════════════════════════════════════════════════
  // HARD GATE 3: Extreme humidity — fog/rain kills thermals
  // Sensors are unreliable (spike to 100% with fog), but if the
  // AVERAGE across zone stations is >90%, it's genuinely saturated.
  // ══════════════════════════════════════════════════════
  if (avgHumidity !== null && avgHumidity > 90 && rule.id.startsWith('thermal_')) {
    return zeroScore;
  }

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
      } else if (avgTemp >= minTemp - 2 && avgTemp <= maxTemp + 2) {
        breakdown.temperature = 12; // Close but not ideal
      }
    } else if (minTemp !== undefined) {
      if (avgTemp >= minTemp) {
        breakdown.temperature = 25;
      } else if (avgTemp >= minTemp - 2) {
        breakdown.temperature = Math.round(12 * (1 - (minTemp - avgTemp) / 2));
      }
    } else if (maxTemp !== undefined) {
      if (avgTemp <= maxTemp) {
        breakdown.temperature = 25;
      } else if (avgTemp <= maxTemp + 2) {
        breakdown.temperature = Math.round(12 * (1 - (avgTemp - maxTemp) / 2));
      }
    } else {
      breakdown.temperature = 15; // No temp constraint → partial match
    }
  }

  // ── Humidity (0-10) ──────────────────────────────────
  // Reduced weight: sensors are unreliable (spike to 100% with fog,
  // drop fast with sun). Good as discard gate (>90%), less reliable
  // for fine-grained scoring. Tolerance widened to ±10.
  if (avgHumidity !== null) {
    const { minHumidity, maxHumidity } = rule.conditions;
    if (minHumidity !== undefined && maxHumidity !== undefined) {
      if (avgHumidity >= minHumidity && avgHumidity <= maxHumidity) {
        breakdown.humidity = 10;
      } else if (avgHumidity >= minHumidity - 10 && avgHumidity <= maxHumidity + 10) {
        const distMin = minHumidity - avgHumidity;
        const distMax = avgHumidity - maxHumidity;
        const dist = Math.max(distMin, distMax, 0);
        breakdown.humidity = Math.round(10 * (1 - dist / 10));
      }
    } else if (minHumidity !== undefined && avgHumidity >= minHumidity) {
      breakdown.humidity = 10;
    } else if (minHumidity !== undefined && avgHumidity >= minHumidity - 10) {
      breakdown.humidity = Math.round(10 * (1 - (minHumidity - avgHumidity) / 10));
    } else if (maxHumidity !== undefined && avgHumidity <= maxHumidity) {
      breakdown.humidity = 10;
    } else if (maxHumidity !== undefined && avgHumidity <= maxHumidity + 10) {
      breakdown.humidity = Math.round(10 * (1 - (avgHumidity - maxHumidity) / 10));
    } else if (minHumidity === undefined && maxHumidity === undefined) {
      breakdown.humidity = 5; // No constraint → minimal credit
    }
  }

  // ── Time of day (0-20) ───────────────────────────────
  // Increased weight: time is the most reliable predictor of thermal activity.
  // Peak gust timing 14.9h (AEMET). Thermals possible until 19-20h in Jun/Jul
  // (sunset ~22:00 Galicia). Time window in rules defines the valid range.
  const { timeWindow } = rule.conditions;
  if (timeWindow) {
    const { from, to } = timeWindow;
    if (from <= to) {
      if (hour >= from && hour <= to) {
        breakdown.timeOfDay = 20;
      } else {
        const dist = Math.min(Math.abs(hour - from), Math.abs(hour - to));
        if (dist <= 2) breakdown.timeOfDay = Math.round(10 * (1 - dist / 2));
      }
    } else {
      // Overnight (e.g., 22-6)
      if (hour >= from || hour <= to) {
        breakdown.timeOfDay = 20;
      } else {
        const distFrom = Math.min(Math.abs(hour - from), 24 - Math.abs(hour - from));
        const distTo = Math.min(Math.abs(hour - to), 24 - Math.abs(hour - to));
        const dist = Math.min(distFrom, distTo);
        if (dist <= 2) breakdown.timeOfDay = Math.round(10 * (1 - dist / 2));
      }
    }
  } else {
    breakdown.timeOfDay = 12; // No time constraint → partial
  }

  // ── Season / month (0-15) ────────────────────────────
  // Month-proportional scoring based on 7-year historical analysis.
  // Aug/Jul score highest (48-50% / 40-43% thermal probability),
  // Jun/Sep lower (20-24% / 18-22%), adjacent months (May/Oct) minimal.
  if (rule.conditions.months && rule.conditions.months.length > 0) {
    breakdown.season = monthThermalScore(month, rule.conditions.months);
  } else {
    breakdown.season = 10; // No month constraint → partial
  }

  // ── Wind direction (0-15) ────────────────────────────
  // W is dominant (74% at embalse) but can mislead — synoptic W
  // winds exist without thermal activity. Direction alone is not
  // conclusive; the combination of all factors determines score.
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
  // Thermal pattern: calm (0) → rapid ramp to 7-12 kt (3.6-6.2 m/s).
  // minSpeed is the threshold for "navigable thermal has started".
  // Below that, the tendency detector handles the "building" phase.
  if (avgSpeed !== null) {
    if (avgSpeed >= rule.expectedWind.minSpeed) {
      breakdown.windSpeed = 15;
    } else if (avgSpeed >= rule.expectedWind.minSpeed * 0.5) {
      const ratio = avgSpeed / rule.expectedWind.minSpeed;
      breakdown.windSpeed = Math.round(15 * ratio);
    }
  }

  let score = breakdown.temperature + breakdown.humidity + breakdown.timeOfDay +
    breakdown.season + breakdown.windDirection + breakdown.windSpeed;

  // ── ΔT scaling (AEMET-derived) ────────────────────────
  // Only apply to thermal rules, in-season months
  if (dailyContext?.deltaT !== null && dailyContext?.deltaT !== undefined
    && rule.id.startsWith('thermal_')
    && rule.conditions.months?.includes(month)) {
    score = Math.round(score * deltaTScaling(dailyContext.deltaT));
  }

  return {
    ruleId: rule.id,
    score: Math.min(100, Math.max(0, score)),
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
  currentTime: Date = new Date(),
  dailyContext?: DailyContext
): RuleScore[] {
  const scores: RuleScore[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const readings = zoneReadingsMap.get(rule.expectedWind.zone) || [];
    scores.push(scoreRule(rule, readings, currentTime, dailyContext));
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
