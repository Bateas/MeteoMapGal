import { describe, it, expect } from 'vitest';
import { scoreRule, scoreAllRules, computeZoneAlerts } from './thermalScoringEngine';
import type { ThermalWindRule, RuleScore, MicroZoneId } from '../types/thermal';
import type { NormalizedReading } from '../types/station';

// ── Helpers ──────────────────────────────────────

function makeReading(overrides: Partial<NormalizedReading> = {}): NormalizedReading {
  return {
    stationId: 'test_station',
    timestamp: new Date('2025-07-15T17:00:00'),
    windSpeed: 4.0,        // ~8 kt
    windDirection: 250,    // WSW
    temperature: 32,
    humidity: 55,
    precipitation: 0,
    solarRadiation: null,
    pressure: null,
    dewPoint: null,
    ...overrides,
  };
}

function makeSummerRule(overrides: Partial<ThermalWindRule> = {}): ThermalWindRule {
  return {
    id: 'thermal_test',
    name: 'Test Thermal Rule',
    description: 'Test rule for scoring engine',
    enabled: true,
    source: 'manual',
    conditions: {
      minTemp: 28,
      maxHumidity: 75,
      timeWindow: { from: 14, to: 20 },
      months: [6, 7, 8, 9],
    },
    expectedWind: {
      zone: 'embalse' as MicroZoneId,
      directionRange: { from: 200, to: 290 },
      minSpeed: 2.5,
    },
    ...overrides,
  };
}

// ── scoreRule ─────────────────────────────────────

describe('scoreRule', () => {
  it('returns 0 for disabled rules', () => {
    const rule = makeSummerRule({ enabled: false });
    const result = scoreRule(rule, [makeReading()]);
    expect(result.score).toBe(0);
  });

  it('returns 0 for empty readings', () => {
    const result = scoreRule(makeSummerRule(), []);
    expect(result.score).toBe(0);
  });

  // ── Hard Gates ──

  it('HARD GATE: returns 0 when month is far outside season', () => {
    const feb = new Date('2025-02-15T17:00:00');
    const result = scoreRule(makeSummerRule(), [makeReading()], feb);
    expect(result.score).toBe(0);
  });

  it('allows adjacent month (May for Jun-Sep rule)', () => {
    const may = new Date('2025-05-15T17:00:00');
    const result = scoreRule(makeSummerRule(), [makeReading()], may);
    expect(result.score).toBeGreaterThan(0);
  });

  it('HARD GATE: returns 0 when temperature < 18°C for thermal rules', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading({ temperature: 15 });
    const result = scoreRule(makeSummerRule(), [reading], july);
    expect(result.score).toBe(0);
  });

  it('HARD GATE: returns 0 when humidity > 85% for thermal rules', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading({ humidity: 90 });
    const result = scoreRule(makeSummerRule(), [reading], july);
    expect(result.score).toBe(0);
  });

  it('HARD GATE: returns 0 when ΔT < 8°C for thermal rules in season', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading();
    const result = scoreRule(makeSummerRule(), [reading], july, {
      deltaT: 5,
      tempMin: 18,
      tempMax: 23,
    });
    expect(result.score).toBe(0);
  });

  it('does NOT apply thermal hard gates to non-thermal rules', () => {
    const rule = makeSummerRule({ id: 'synoptic_test' });
    const reading = makeReading({ temperature: 15 });
    const july = new Date('2025-07-15T17:00:00');
    const result = scoreRule(rule, [reading], july);
    expect(result.score).toBeGreaterThan(0);
  });

  // ── Score components (v2.1 weights — data-driven temperature) ──

  it('gives high score for perfect conditions', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading({
      temperature: 30,   // thermal sweet spot 28-30°C
      humidity: 55,      // humidity sweet spot
      windSpeed: 4.0,    // > minSpeed 2.5
      windDirection: 250, // in range 200-290
    });
    const result = scoreRule(makeSummerRule(), [reading], july);
    // v2.1: temp(10+10) + humidity(20) + time=15 + season=14 + dir=10 + speed=10 + deltaT=5 = 94
    expect(result.score).toBeGreaterThanOrEqual(75);
  });

  it('gives max temperature score (20) at 30°C — thermal sweet spot', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading({ temperature: 30 }); // 28-30°C = peak thermal
    const result = scoreRule(makeSummerRule(), [reading], july);
    // Rule compliance: 30 >= 28 → 10. Position: 28-30°C → 10. Total: 20
    expect(result.breakdown.temperature).toBe(20);
  });

  it('gives high temperature score (19) at 31°C — still excellent thermal', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading({ temperature: 31 }); // In sweet spot 30-32
    const result = scoreRule(makeSummerRule(), [reading], july);
    // Rule compliance: 10. Position: 30-32°C → 9. Total: 19
    expect(result.breakdown.temperature).toBeGreaterThanOrEqual(17);
    expect(result.breakdown.temperature).toBeLessThanOrEqual(20);
  });

  it('gives moderate temp score at 27°C — ambiguous, likely frontal not thermal', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading({ temperature: 27 }); // 1° below minTemp=28
    const result = scoreRule(makeSummerRule(), [reading], july);
    // Rule compliance: dist=1 → round(10*(1-1/5)) = 8. Position: 25-28°C → 5 (ambiguous!).
    // Total: 13. Wind at <28°C is often frontal/synoptic, NOT thermal.
    expect(result.breakdown.temperature).toBeGreaterThanOrEqual(10);
    expect(result.breakdown.temperature).toBeLessThanOrEqual(15);
  });

  it('PENALIZES extreme heat >36°C — stifling calm days', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading({ temperature: 38 }); // Extreme heat
    const result = scoreRule(makeSummerRule(), [reading], july);
    // Rule compliance: 38 >= 28 → 10. Position: 36-38°C → 2 (stifling!). Total: 12
    // KEY: Data shows vel_media 1.4 m/s (LOWEST), navigable only 20%
    expect(result.breakdown.temperature).toBeLessThanOrEqual(14);
    expect(result.breakdown.temperature).toBeGreaterThan(0);
  });

  it('gives low temperature score far below range (20°C)', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading({ temperature: 20 }); // 8° below minTemp=28
    const result = scoreRule(makeSummerRule(), [reading], july);
    // Rule compliance: dist=8 > 5 → 0. Position: 18-22°C → 1. Total: 1
    expect(result.breakdown.temperature).toBeLessThan(5);
    expect(result.breakdown.temperature).toBeGreaterThan(0);
  });

  it('gives humidity score ~20 for sweet spot (45-55%)', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading({ humidity: 50 }); // Peak sweet spot
    const result = scoreRule(makeSummerRule(), [reading], july);
    // rule compliance: 50 < 75 maxHumidity → 10. Position: 50 in 45-55 → 10. Total: 20
    expect(result.breakdown.humidity).toBe(20);
  });

  it('gives lower humidity score for cliff zone (75-85%)', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading({ humidity: 78 }); // In cliff zone
    const result = scoreRule(makeSummerRule(), [reading], july);
    // rule compliance: 78 > 75 maxHumidity → partial. Position: 75-80 → 4.
    expect(result.breakdown.humidity).toBeLessThan(15);
    expect(result.breakdown.humidity).toBeGreaterThan(0);
  });

  it('gives time score 15 when inside window', () => {
    const july17h = new Date('2025-07-15T17:00:00');
    const result = scoreRule(makeSummerRule(), [makeReading()], july17h);
    expect(result.breakdown.timeOfDay).toBe(15);
  });

  it('gives time score 0 when far outside window', () => {
    const july6h = new Date('2025-07-15T06:00:00');
    const result = scoreRule(makeSummerRule(), [makeReading()], july6h);
    expect(result.breakdown.timeOfDay).toBe(0);
  });

  it('gives wind direction 10 when inside range', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading({ windDirection: 250 }); // WSW, in 200-290
    const result = scoreRule(makeSummerRule(), [reading], july);
    expect(result.breakdown.windDirection).toBe(10);
  });

  it('gives wind direction 0 when far outside range', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading({ windDirection: 90 }); // E, outside 200-290
    const result = scoreRule(makeSummerRule(), [reading], july);
    expect(result.breakdown.windDirection).toBe(0);
  });

  it('gives wind speed 10 when above minSpeed', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading({ windSpeed: 5.0 }); // > 2.5 minSpeed
    const result = scoreRule(makeSummerRule(), [reading], july);
    expect(result.breakdown.windSpeed).toBe(10);
  });

  it('gives partial speed when 50-100% of minSpeed', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading({ windSpeed: 1.5 }); // 60% of 2.5
    const result = scoreRule(makeSummerRule(), [reading], july);
    expect(result.breakdown.windSpeed).toBeGreaterThan(0);
    expect(result.breakdown.windSpeed).toBeLessThan(10);
  });

  // ── ΔT scoring ──

  it('gives deltaTContext score based on daily context', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading();
    const result = scoreRule(makeSummerRule(), [reading], july, {
      deltaT: 22,
      tempMin: 14,
      tempMax: 36,
    });
    expect(result.breakdown.deltaTContext).toBe(10); // ΔT >= 20 → 10
  });

  it('gives neutral deltaTContext (5) when no daily context', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading();
    const result = scoreRule(makeSummerRule(), [reading], july);
    expect(result.breakdown.deltaTContext).toBe(5); // No data → neutral
  });

  it('applies ΔT bonus for high diurnal range', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading();
    const noCtx = scoreRule(makeSummerRule(), [reading], july);
    const withCtx = scoreRule(makeSummerRule(), [reading], july, {
      deltaT: 22,
      tempMin: 14,
      tempMax: 36,
    });
    expect(withCtx.score).toBeGreaterThan(noCtx.score);
  });

  // ── Multiple readings (zone averaging) ──

  it('averages multiple station readings', () => {
    const july = new Date('2025-07-15T17:00:00');
    const readings = [
      makeReading({ temperature: 30, windSpeed: 3 }),
      makeReading({ temperature: 34, windSpeed: 5 }),
    ];
    const result = scoreRule(makeSummerRule(), readings, july);
    // avgTemp = 32: compliance=10 (32>=28), position=9 (30-32°C) → 19
    expect(result.breakdown.temperature).toBeGreaterThanOrEqual(16);
    // avgSpeed = 4 > 2.5 minSpeed → 10
    expect(result.breakdown.windSpeed).toBe(10);
  });

  it('score is clamped to 0-100', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading();
    const result = scoreRule(makeSummerRule(), [reading], july, {
      deltaT: 25, tempMin: 10, tempMax: 35,
    });
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

// ── scoreAllRules ────────────────────────────────

describe('scoreAllRules', () => {
  it('scores enabled rules and skips disabled', () => {
    const rules = [
      makeSummerRule({ id: 'thermal_1', enabled: true }),
      makeSummerRule({ id: 'thermal_2', enabled: false }),
    ];
    const zoneReadings = new Map<MicroZoneId, NormalizedReading[]>([
      ['embalse', [makeReading()]],
    ]);
    const july = new Date('2025-07-15T17:00:00');
    const scores = scoreAllRules(rules, zoneReadings, july);
    expect(scores).toHaveLength(1);
    expect(scores[0].ruleId).toBe('thermal_1');
  });

  it('returns empty scores for empty zone readings', () => {
    const rules = [makeSummerRule()];
    const zoneReadings = new Map<MicroZoneId, NormalizedReading[]>();
    const scores = scoreAllRules(rules, zoneReadings);
    // Rule with no readings → score 0
    expect(scores).toHaveLength(1);
    expect(scores[0].score).toBe(0);
  });
});

// ── computeZoneAlerts ────────────────────────────

describe('computeZoneAlerts', () => {
  const zeroBreakdown = {
    temperature: 0, humidity: 0, timeOfDay: 0, season: 0,
    windDirection: 0, windSpeed: 0, deltaTContext: 0,
    gustBonus: 0, environmentBonus: 0,
  };

  it('assigns none for scores below threshold', () => {
    const scores: RuleScore[] = [{
      ruleId: 'thermal_1',
      score: 20,
      breakdown: { ...zeroBreakdown, temperature: 5, humidity: 5, timeOfDay: 5, season: 3, windDirection: 2 },
      matchedZone: 'embalse',
    }];
    const alerts = computeZoneAlerts(scores);
    expect(alerts.get('embalse')?.alertLevel).toBe('none');
  });

  it('assigns low for scores 30-55', () => {
    const scores: RuleScore[] = [{
      ruleId: 'thermal_1',
      score: 45,
      breakdown: { ...zeroBreakdown, temperature: 10, humidity: 10, timeOfDay: 10, season: 10, windDirection: 5 },
      matchedZone: 'embalse',
    }];
    const alerts = computeZoneAlerts(scores);
    expect(alerts.get('embalse')?.alertLevel).toBe('low');
  });

  it('assigns medium for scores 55-75', () => {
    const scores: RuleScore[] = [{
      ruleId: 'thermal_1',
      score: 65,
      breakdown: { ...zeroBreakdown, temperature: 15, humidity: 15, timeOfDay: 12, season: 10, windDirection: 7, windSpeed: 6 },
      matchedZone: 'embalse',
    }];
    const alerts = computeZoneAlerts(scores);
    expect(alerts.get('embalse')?.alertLevel).toBe('medium');
  });

  it('assigns high for scores >= 75', () => {
    const scores: RuleScore[] = [{
      ruleId: 'thermal_1',
      score: 85,
      breakdown: { ...zeroBreakdown, temperature: 20, humidity: 18, timeOfDay: 15, season: 15, windDirection: 10, windSpeed: 7 },
      matchedZone: 'embalse',
    }];
    const alerts = computeZoneAlerts(scores);
    expect(alerts.get('embalse')?.alertLevel).toBe('high');
  });

  it('keeps highest score when multiple rules match same zone', () => {
    const scores: RuleScore[] = [
      {
        ruleId: 'thermal_1', score: 40,
        breakdown: { ...zeroBreakdown, temperature: 10, humidity: 10, timeOfDay: 10, season: 5, windDirection: 5 },
        matchedZone: 'embalse',
      },
      {
        ruleId: 'thermal_2', score: 70,
        breakdown: { ...zeroBreakdown, temperature: 15, humidity: 15, timeOfDay: 15, season: 10, windDirection: 10, windSpeed: 5 },
        matchedZone: 'embalse',
      },
    ];
    const alerts = computeZoneAlerts(scores);
    expect(alerts.get('embalse')?.maxScore).toBe(70);
    expect(alerts.get('embalse')?.alertLevel).toBe('medium');
    expect(alerts.get('embalse')?.activeRules).toHaveLength(2);
  });
});
