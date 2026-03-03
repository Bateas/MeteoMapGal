import type {
  ThermalWindRule, RuleScore, ScoreBreakdown,
  ZoneAlert, AlertLevel, MicroZoneId, DailyContext, AtmosphericContext,
} from '../types/thermal';
import type { NormalizedReading } from '../types/station';
import { isDirectionInRange, averageWindDirection, msToKnots } from './windUtils';

/**
 * Thermal Scoring Engine v2.2 — Data-driven weights from AEMET analysis.
 *
 * Weight redistribution based on 1,412 daily records from Ribadavia (1701X),
 * Ourense (1690A), and Carballiño (1700X), 2022-2025 summers.
 *
 * ═══════════════════════════════════════════════════════════════
 * v2.2 (2026-03): FRONTAL-FILTERED ANALYSIS
 * ═══════════════════════════════════════════════════════════════
 * Cross-referenced Ourense "sol" (sunshine hours, 459 records) with
 * Ribadavia wind data. Separated TRUE thermal from FRONTAL/SYNOPTIC:
 *   OLD "thermal" (T≥25, SW, afternoon, dry):   156/478 days (32.6%)
 *   CLEAN thermal (T≥28, SW, dry, clear ΔT):    119/478 days (24.9%)
 *   ❌ Removed as frontal contamination:          37 false positives
 *
 * KEY FINDINGS (frontal-filtered):
 *
 *   HUMIDITY (strongest discriminator, CONFIRMED by clean filter):
 *     HR 40-50% → 43% clean thermal probability
 *     HR 50-60% → 38% clean thermal probability
 *     HR 60-70% → 18% clean thermal probability  ← CLIFF
 *     HR 70-80% → 7% clean thermal probability
 *     HR >80%   → 0% clean thermal probability  ← DEAD
 *
 *   TEMPERATURE (complex: hotter = more thermal days BUT less wind!):
 *     T <28°C    → 0% clean thermal (ALL were frontal/synoptic!)
 *     T 28-30°C  → 23% clean thermal, vel 2.0 m/s ⭐ BEST WIND
 *     T 30-32°C  → 29% clean thermal, vel 1.7 m/s ⭐
 *     T 32-34°C  → 31% clean thermal, vel 1.8 m/s
 *     T 34-36°C  → 37% clean thermal, vel 1.7 m/s
 *     T 36-38°C  → 49% clean thermal, vel 1.6 m/s ⚠️
 *     T >38°C    → 60% clean thermal, vel 1.4 m/s ⚠️ "sofocante parado"
 *     Paradox: hot = more thermal days but WEAKER surface wind!
 *     Scoring optimizes for SAILING quality (vel×probability), not just detection.
 *
 *   ΔT (VALIDATED spectacularly with Ourense sunshine hours):
 *     ΔT <8°C:   0% clean thermal, avg sol 1.8h (overcast!)
 *     ΔT 8-10°C: 0% clean thermal, avg sol 4.5h
 *     ΔT 10-12°C: 0% clean thermal, avg sol 5.8h
 *     ΔT 14-16°C: 23% clean thermal, avg sol 8.7h
 *     ΔT 16-18°C: 33% clean thermal, avg sol 10.2h
 *     ΔT 18-20°C: 39% clean thermal, avg sol 11.1h
 *     ΔT >20°C:  44% clean thermal, avg sol 11.8h
 *     → Perfect correlation ΔT↔sol confirms ΔT as sky clarity proxy.
 *
 *   SUNSHINE HOURS cross-validation (Ourense "sol"):
 *     sol <4h (overcast):     0% clean thermal
 *     sol 4-7h (cloudy):      4% clean thermal
 *     sol 7-10h (partly):    25% clean thermal
 *     sol 10-13h (clear):    35% clean thermal
 *     sol >13h (full sun):   37% clean thermal
 *
 *   CROSS-STATION (when Ribadavia clean thermal):
 *     Ourense also thermal: 69% (W 66%, NW 16%)
 *     Carballiño also thermal: 52% (NW 45%, W 36%)
 *
 * Score weights (0-100 base + 10 bonus):
 *   Temperature:      0-20 pts  (sweet spot 28-32°C, penalty >36°C)
 *   Humidity:         0-20 pts  (doubled, strongest signal)
 *   Time of day:      0-15 pts
 *   Season (month):   0-15 pts
 *   Wind direction:   0-10 pts  (synoptic can mislead)
 *   Wind speed:       0-10 pts  (confirms, doesn't predict)
 *   ΔT context:       0-10 pts  (validated sky clarity proxy)
 *   Gust bonus:       0-5 pts
 *   Environment:      0-5 pts
 *   TOTAL:           max 110 → capped at 100
 *
 * Hard gates (score → 0):
 *   1. Season: far out of range
 *   2. Temperature: < 18°C
 *   3. Humidity: > 85% (0% thermals at >80% in clean analysis)
 *   4. Precipitation: > 2mm
 *   5. ΔT < 8°C (0% thermals, avg sol 1.8h = overcast)
 */

// ═══════════════════════════════════════════════════════════
// Data-driven humidity scoring
// ═══════════════════════════════════════════════════════════

/**
 * Data-driven humidity position score based on AEMET Ribadavia analysis.
 * Returns 0-10 based on how close humidity is to the thermal sweet spot.
 *
 * CLEAN thermal data (frontal-filtered, 478 summer days):
 *   HR 40-50%: 43% clean thermal probability → 10/10
 *   HR 50-60%: 38% clean thermal probability → 9/10
 *   HR 60-70%: 18% clean thermal probability → 5/10 (steep cliff!)
 *   HR 70-80%:  7% clean thermal probability → 3/10
 *   HR >80%:    0% clean thermal probability → hard gate
 *   HR <40%:   insufficient data → 7/10 (likely good if dry)
 */
function humidityPositionScore(hr: number): number {
  if (hr >= 40 && hr <= 50) return 10;  // Peak: 43% clean thermal
  if (hr > 50 && hr <= 60) return 9;    // Excellent: 38% clean thermal
  if (hr > 60 && hr <= 70) return 5;    // CLIFF: drops to 18% clean thermal
  if (hr >= 30 && hr < 40) return 7;    // Dry side, likely good (sparse data)
  if (hr > 70 && hr <= 80) return 3;    // Poor: only 7% clean thermal
  if (hr > 80 && hr <= 85) return 1;    // Near-zero: 0% at >80% in clean data
  if (hr < 30) return 5;                // Very dry (rare, insufficient data)
  return 0;                              // >85% — hard gate catches this
}

// ═══════════════════════════════════════════════════════════
// Data-driven temperature scoring (CORRECTED v2.1)
// ═══════════════════════════════════════════════════════════

/**
 * Data-driven temperature score for SAILING QUALITY during thermal wind.
 * Returns 0-10 balancing thermal probability AND surface wind strength.
 *
 * PROVEN by frontal-filtered analysis (2026-03):
 *   T <28°C:   0% clean thermal (ALL SW wind at <28°C was frontal!)
 *   T 28-30°C: 23% clean thermal, vel 2.0 m/s → 10/10 (best sailing wind)
 *   T 30-32°C: 29% clean thermal, vel 1.7 m/s → 9/10
 *   T 32-34°C: 31% clean thermal, vel 1.8 m/s → 7/10
 *   T 34-36°C: 37% clean thermal, vel 1.7 m/s → 5/10
 *   T 36-38°C: 49% clean thermal, vel 1.6 m/s → 3/10 (thermal exists, wind weak)
 *   T >38°C:   60% clean thermal, vel 1.4 m/s → 1/10 ("sofocante parado")
 *
 * PARADOX: Hotter → MORE likely thermal but LESS surface wind for sailing.
 * At >38°C, 60% of days have thermal patterns but only 1.4 m/s avg wind.
 * The thermal column is so broad at extreme heat that horizontal surface
 * flow is minimal. Scoring prioritizes SAILING quality, not detection.
 *
 *   T 25-28°C → 3/10   CONFIRMED FRONTAL: 0% clean thermal after filtering.
 *                        Removed from ambiguous → proven frontal contamination.
 *   T 22-25°C → 2/10   Very unlikely thermal
 *   T 18-22°C → 1/10   Near hard gate
 */
function temperatureNavigabilityScore(temp: number): number {
  if (temp >= 28 && temp <= 30) return 10;  // BEST: 23% thermal, vel 2.0 m/s
  if (temp > 30 && temp <= 32) return 9;    // Great: 29% thermal, vel 1.7 m/s
  if (temp > 32 && temp <= 34) return 7;    // Good: 31% thermal, vel 1.8 m/s
  if (temp > 34 && temp <= 36) return 5;    // Declining: 37% thermal but surface calming
  if (temp > 36 && temp <= 38) return 3;    // Weak surface wind: 49% thermal, vel 1.6 m/s
  if (temp > 38) return 1;                  // "Sofocante parado": 60% thermal but vel 1.4 m/s
  // Below 28°C: PROVEN 0% clean thermal — ALL SW wind was frontal!
  if (temp >= 25 && temp < 28) return 3;    // Frontal contamination zone (0% clean thermal)
  if (temp >= 22 && temp < 25) return 2;    // Very unlikely thermal
  if (temp >= 18 && temp < 22) return 1;    // Near hard gate
  return 0;                                  // <18°C hard gate
}

// ═══════════════════════════════════════════════════════════
// ΔT scoring — promoted from multiplier to primary component
// ═══════════════════════════════════════════════════════════

/**
 * ΔT (diurnal temperature range) scoring — VALIDATED with sunshine hours.
 *
 * Spectacular correlation between ΔT and Ourense "sol" confirms
 * ΔT as a reliable sky clarity proxy:
 *
 *   ΔT <8°C:    0% clean thermal, sol 1.8h (overcast!)    → HARD GATE
 *   ΔT 8-10°C:  0% clean thermal, sol 4.5h               → 1/10
 *   ΔT 10-12°C: 0% clean thermal, sol 5.8h               → 1/10
 *   ΔT 12-14°C: 0% clean thermal, sol 6.9h               → 2/10
 *   ΔT 14-16°C: 23% clean thermal, sol 8.7h              → 5/10
 *   ΔT 16-18°C: 33% clean thermal, sol 10.2h             → 7/10
 *   ΔT 18-20°C: 39% clean thermal, sol 11.1h             → 9/10
 *   ΔT >20°C:   44% clean thermal, sol 11.8h             → 10/10
 *
 * KEY: ΔT < 14°C = zero clean thermal days in Ribadavia data!
 * This is a stronger gate than previously thought.
 */
function deltaTScore(deltaT: number | null): number {
  if (deltaT === null) return 5;  // No data → neutral
  if (deltaT >= 20) return 10;    // Peak: 44% clean thermal, sol 11.8h
  if (deltaT >= 18) return 9;     // Excellent: 39%, sol 11.1h
  if (deltaT >= 16) return 7;     // Good: 33%, sol 10.2h
  if (deltaT >= 14) return 5;     // Fair: 23%, sol 8.7h
  if (deltaT >= 12) return 2;     // Weak: 0% in Ribadavia (but borderline)
  if (deltaT >= 8) return 1;      // Very weak: 0% and cloudy
  return 0;                        // <8°C → hard gate (overcast, sol <2h)
}

// ═══════════════════════════════════════════════════════════
// Month scoring (unchanged — well-calibrated)
// ═══════════════════════════════════════════════════════════

/**
 * Month-proportional thermal score based on 7-year Open-Meteo Archive analysis.
 *
 * Ribadavia AEMET confirms:
 *   Aug: 39.5% thermal → 15 pts
 *   Jul: 32.5% → 14 pts
 *   Sep: 31.7% → 12 pts
 *   Jun: 22.5% → 9 pts
 *   May/Oct (adjacent): → 3 pts
 */
function monthThermalScore(month: number, ruleMonths: number[]): number {
  if (!ruleMonths.includes(month)) {
    return 3; // Adjacent month
  }
  switch (month) {
    case 8: return 15;  // Aug: peak thermal reliability
    case 7: return 14;  // Jul: strong
    case 9: return 12;  // Sep: still good (AEMET: 31.7%)
    case 6: return 9;   // Jun: moderate, shorter days early month
    default: return 10; // Fallback for any other in-season month
  }
}

/**
 * Absolute minimum temperature (°C) for any thermal activity.
 * Below this, thermal wind is physically impossible.
 * AEMET: T<25°C days with SW are synoptic/frontal, NOT thermal.
 * Floor at 18°C for real-time readings (current temp, not Tmax).
 */
const ABSOLUTE_TEMP_FLOOR = 18;

/**
 * Score a single rule against current zone readings.
 *
 * HARD GATES (score = 0 immediately if any fails):
 *   1. Season: month far outside range → 0
 *   2. Temperature: avg temp < 18°C → 0 (thermal rules only)
 *   3. Humidity: avg HR > 85% → 0 (AEMET: 0% thermals at >85%)
 *   4. Precipitation: avg > 2mm → 0
 *   5. ΔT < 8°C → 0 (AEMET: 0% thermals, thermal rules only)
 */
export function scoreRule(
  rule: ThermalWindRule,
  zoneReadings: NormalizedReading[],
  currentTime: Date = new Date(),
  dailyContext?: DailyContext,
  atmosphericContext?: AtmosphericContext | null,
): RuleScore {
  const zeroScore: RuleScore = {
    ruleId: rule.id,
    score: 0,
    breakdown: {
      temperature: 0, humidity: 0, timeOfDay: 0, season: 0,
      windDirection: 0, windSpeed: 0, deltaTContext: 0,
      gustBonus: 0, environmentBonus: 0,
    },
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

  const isThermalRule = rule.id.startsWith('thermal_');

  // ══════════════════════════════════════════════════════
  // HARD GATE 1: Season — completely out of season → 0
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
  // HARD GATE 2: Temperature floor — thermals impossible below 18°C
  // ══════════════════════════════════════════════════════
  if (avgTemp !== null && avgTemp < ABSOLUTE_TEMP_FLOOR && isThermalRule) {
    return zeroScore;
  }

  // ══════════════════════════════════════════════════════
  // HARD GATE 3: Humidity — AEMET data: 0% thermals at HR >85%
  // Tightened from 90%: at Ribadavia, 15 days with HR>85% had
  // ZERO thermal days. At Ourense, 0% thermals at HR>75%.
  // Using 85% as compromise (Ribadavia sensors are valley-level).
  // ══════════════════════════════════════════════════════
  if (avgHumidity !== null && avgHumidity > 85 && isThermalRule) {
    return zeroScore;
  }

  // ══════════════════════════════════════════════════════
  // HARD GATE 4: Active precipitation — rain kills thermals
  // ══════════════════════════════════════════════════════
  if (isThermalRule) {
    const precipReadings = zoneReadings.filter((r) => r.precipitation !== null && r.precipitation! > 0);
    if (precipReadings.length > 0) {
      const avgPrecip = precipReadings.reduce((sum, r) => sum + r.precipitation!, 0) / precipReadings.length;
      if (avgPrecip > 2) return zeroScore;
    }
  }

  // ══════════════════════════════════════════════════════
  // HARD GATE 5: ΔT < 8°C — AEMET: 0% thermals at ΔT <8°C
  // Only apply when we have ΔT data and it's a thermal rule
  // in-season (don't penalize when forecast is unavailable)
  // ══════════════════════════════════════════════════════
  if (dailyContext?.deltaT !== null && dailyContext?.deltaT !== undefined
    && dailyContext.deltaT < 8
    && isThermalRule
    && rule.conditions.months?.includes(month)) {
    return zeroScore;
  }

  const breakdown: ScoreBreakdown = {
    temperature: 0,
    humidity: 0,
    timeOfDay: 0,
    season: 0,
    windDirection: 0,
    windSpeed: 0,
    deltaTContext: 0,
    gustBonus: 0,
    environmentBonus: 0,
  };

  // ── Temperature (0-20) ─────────────────────────────────
  // CORRECTED v2.1: Data shows >36°C = stifling calm, NOT better!
  // AEMET Ribadavia: vel_media at T>38°C = 1.4 m/s (LOWEST of all bands).
  // Sweet spot 25-32°C confirmed by user sailing experience AND data.
  //
  // Two-part scoring (mirrors humidity pattern):
  //   Part A (0-10): Rule compliance — does temp match rule constraints?
  //   Part B (0-10): Data-driven navigability — how favorable for sailing?
  if (avgTemp !== null) {
    const { minTemp, maxTemp } = rule.conditions;

    // Part A: Rule compliance (0-10)
    let tempRuleCompliance = 0;
    if (minTemp !== undefined && maxTemp !== undefined) {
      if (avgTemp >= minTemp && avgTemp <= maxTemp) {
        tempRuleCompliance = 10;
      } else {
        const distMin = Math.max(0, minTemp - avgTemp);
        const distMax = Math.max(0, avgTemp - maxTemp);
        const dist = Math.max(distMin, distMax);
        if (dist <= 5) {
          tempRuleCompliance = Math.round(10 * (1 - dist / 5));
        }
      }
    } else if (minTemp !== undefined) {
      if (avgTemp >= minTemp) {
        tempRuleCompliance = 10;
      } else if (avgTemp >= minTemp - 5) {
        tempRuleCompliance = Math.round(10 * (1 - (minTemp - avgTemp) / 5));
      }
    } else if (maxTemp !== undefined) {
      if (avgTemp <= maxTemp) {
        tempRuleCompliance = 10;
      } else if (avgTemp <= maxTemp + 5) {
        tempRuleCompliance = Math.round(10 * (1 - (avgTemp - maxTemp) / 5));
      }
    } else {
      tempRuleCompliance = 5; // No constraint → neutral
    }

    // Part B: Data-driven navigability position (0-10)
    const tempPositionScore = temperatureNavigabilityScore(avgTemp);

    breakdown.temperature = tempRuleCompliance + tempPositionScore;
  }

  // ── Humidity (0-20) ────────────────────────────────────
  // DOUBLED from 10 → 20. Based on AEMET data: humidity is the
  // single strongest thermal discriminator.
  //
  // Two-part scoring:
  //   Part A (0-10): Rule compliance — does HR match the rule's constraints?
  //   Part B (0-10): Data-driven position — how close to the 45-65% sweet spot?
  //
  // This captures BOTH rule-specific knowledge (e.g., hot-day rule expects <65%)
  // AND the universal AEMET insight about optimal humidity ranges.
  if (avgHumidity !== null) {
    const { minHumidity, maxHumidity } = rule.conditions;

    // Part A: Rule compliance (0-10)
    let ruleCompliance = 0;
    if (minHumidity !== undefined && maxHumidity !== undefined) {
      if (avgHumidity >= minHumidity && avgHumidity <= maxHumidity) {
        ruleCompliance = 10;
      } else {
        const distMin = Math.max(0, minHumidity - avgHumidity);
        const distMax = Math.max(0, avgHumidity - maxHumidity);
        const dist = Math.max(distMin, distMax);
        if (dist <= 10) {
          ruleCompliance = Math.round(10 * (1 - dist / 10));
        }
      }
    } else if (maxHumidity !== undefined) {
      if (avgHumidity <= maxHumidity) {
        ruleCompliance = 10;
      } else if (avgHumidity <= maxHumidity + 10) {
        ruleCompliance = Math.round(10 * (1 - (avgHumidity - maxHumidity) / 10));
      }
    } else if (minHumidity !== undefined) {
      if (avgHumidity >= minHumidity) {
        ruleCompliance = 10;
      } else if (avgHumidity >= minHumidity - 10) {
        ruleCompliance = Math.round(10 * (1 - (minHumidity - avgHumidity) / 10));
      }
    } else {
      ruleCompliance = 5; // No constraint → neutral
    }

    // Part B: Data-driven sweet spot position (0-10)
    const positionScore = humidityPositionScore(avgHumidity);

    breakdown.humidity = ruleCompliance + positionScore;
  } else {
    // No humidity data — give neutral partial credit
    breakdown.humidity = 10;
  }

  // ── Time of day (0-15) ─────────────────────────────────
  // Reduced from 20 → 15. Still reliable predictor (solar cycle)
  // but temperature and humidity have more discriminating power.
  // AEMET: peak gust at 15:48h, thermals possible until 20-21h in Jun/Jul.
  const { timeWindow } = rule.conditions;
  if (timeWindow) {
    const { from, to } = timeWindow;
    if (from <= to) {
      if (hour >= from && hour <= to) {
        breakdown.timeOfDay = 15;
      } else {
        const dist = Math.min(Math.abs(hour - from), Math.abs(hour - to));
        if (dist <= 2) breakdown.timeOfDay = Math.round(8 * (1 - dist / 2));
      }
    } else {
      // Overnight (e.g., 22-6)
      if (hour >= from || hour <= to) {
        breakdown.timeOfDay = 15;
      } else {
        const distFrom = Math.min(Math.abs(hour - from), 24 - Math.abs(hour - from));
        const distTo = Math.min(Math.abs(hour - to), 24 - Math.abs(hour - to));
        const dist = Math.min(distFrom, distTo);
        if (dist <= 2) breakdown.timeOfDay = Math.round(8 * (1 - dist / 2));
      }
    }
  } else {
    breakdown.timeOfDay = 10; // No time constraint → partial
  }

  // ── Season / month (0-15) ──────────────────────────────
  // Unchanged — well-calibrated from 7-year analysis.
  if (rule.conditions.months && rule.conditions.months.length > 0) {
    breakdown.season = monthThermalScore(month, rule.conditions.months);
  } else {
    breakdown.season = 10; // No month constraint → partial
  }

  // ── Wind direction (0-10) ──────────────────────────────
  // Reduced from 15 → 10. AEMET: W dominant 74% at embalse, BUT
  // synoptic W winds exist without thermal activity. Direction
  // alone isn't conclusive — the combination of all factors matters.
  if (avgDir !== null) {
    if (isDirectionInRange(avgDir, rule.expectedWind.directionRange)) {
      breakdown.windDirection = 10;
    } else {
      // Partial: within ±30° of range boundary
      const { from, to } = rule.expectedWind.directionRange;
      const distFrom = Math.abs(((avgDir - from + 180) % 360) - 180);
      const distTo = Math.abs(((avgDir - to + 180) % 360) - 180);
      const minDist = Math.min(distFrom, distTo);
      if (minDist <= 30) {
        breakdown.windDirection = Math.round(10 * (1 - minDist / 30));
      }
    }
  }

  // ── Wind speed (0-10) ──────────────────────────────────
  // Reduced from 15 → 10. At Castrelo, the thermal arrives
  // abruptly (calm → 7-12 kt fast). Speed confirms the thermal
  // is already blowing but doesn't predict onset well.
  if (avgSpeed !== null) {
    if (avgSpeed >= rule.expectedWind.minSpeed) {
      breakdown.windSpeed = 10;
    } else if (avgSpeed >= rule.expectedWind.minSpeed * 0.5) {
      const ratio = avgSpeed / rule.expectedWind.minSpeed;
      breakdown.windSpeed = Math.round(10 * ratio);
    }
  }

  // ── ΔT context (0-10) ─────────────────────────────────
  // NEW primary component. Promoted from post-hoc multiplier
  // because ΔT is one of the strongest predictors in AEMET data.
  // Only apply to thermal rules in-season months.
  if (isThermalRule && rule.conditions.months?.includes(month)) {
    breakdown.deltaTContext = deltaTScore(dailyContext?.deltaT ?? null);
  } else if (dailyContext?.deltaT !== null && dailyContext?.deltaT !== undefined) {
    // For non-thermal rules (drainage, precursors), give partial credit
    breakdown.deltaTContext = Math.min(5, deltaTScore(dailyContext.deltaT));
  }

  // ── Gust bonus (0-5) ──────────────────────────────────
  // Strong gusts (>10 kt) confirm established thermal convection.
  // AEMET: thermal days have 46% gusts 8-11 m/s, 13% gusts 11-14 m/s.
  const gusts = zoneReadings.filter((r) => r.windGust !== null).map((r) => r.windGust!);
  if (gusts.length > 0 && avgSpeed !== null && avgSpeed > 1) {
    const avgGustKt = msToKnots(gusts.reduce((a, b) => a + b, 0) / gusts.length);
    if (avgGustKt >= 15) breakdown.gustBonus = 5;
    else if (avgGustKt >= 10) breakdown.gustBonus = 3;
    else if (avgGustKt >= 6) breakdown.gustBonus = 1;
  }

  // ── Environment bonus (0-5) ────────────────────────────
  // Clear sky + strong radiation = conditions for thermal convection.
  if (atmosphericContext && isThermalRule) {
    const { cloudCover, solarRadiation } = atmosphericContext;
    if (cloudCover !== null && cloudCover < 20) {
      breakdown.environmentBonus += 2; // Clear sky
    } else if (cloudCover !== null && cloudCover < 40) {
      breakdown.environmentBonus += 1; // Mostly clear
    }
    if (solarRadiation !== null && solarRadiation > 600) {
      breakdown.environmentBonus += 3; // Strong radiation
    } else if (solarRadiation !== null && solarRadiation > 400) {
      breakdown.environmentBonus += 1; // Moderate radiation
    }
    breakdown.environmentBonus = Math.min(5, breakdown.environmentBonus);
  }

  const score = breakdown.temperature + breakdown.humidity + breakdown.timeOfDay +
    breakdown.season + breakdown.windDirection + breakdown.windSpeed +
    breakdown.deltaTContext + breakdown.gustBonus + breakdown.environmentBonus;

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
  dailyContext?: DailyContext,
  atmosphericContext?: AtmosphericContext | null,
): RuleScore[] {
  const scores: RuleScore[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const readings = zoneReadingsMap.get(rule.expectedWind.zone) || [];
    scores.push(scoreRule(rule, readings, currentTime, dailyContext, atmosphericContext));
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
