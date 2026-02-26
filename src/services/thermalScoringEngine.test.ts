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

  it('HARD GATE: returns 0 when humidity > 90% for thermal rules', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading({ humidity: 95 });
    const result = scoreRule(makeSummerRule(), [reading], july);
    expect(result.score).toBe(0);
  });

  it('does NOT apply thermal hard gates to non-thermal rules', () => {
    const rule = makeSummerRule({ id: 'synoptic_test' });
    const reading = makeReading({ temperature: 15 });
    const july = new Date('2025-07-15T17:00:00');
    const result = scoreRule(rule, [reading], july);
    expect(result.score).toBeGreaterThan(0);
  });

  // ── Score components ──

  it('gives high score for perfect conditions', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading({
      temperature: 32,
      humidity: 55,
      windSpeed: 4.0,
      windDirection: 250,
    });
    const result = scoreRule(makeSummerRule(), [reading], july);
    // All factors should be high: temp 25, humidity 10, time 20, season 14, dir 15, speed 15 = 99
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it('gives temperature score 25 when in range', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading({ temperature: 30 });
    const result = scoreRule(makeSummerRule(), [reading], july);
    expect(result.breakdown.temperature).toBe(25);
  });

  it('gives partial temperature score when close to range', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading({ temperature: 27 }); // 1° below minTemp=28
    const result = scoreRule(makeSummerRule(), [reading], july);
    expect(result.breakdown.temperature).toBeGreaterThan(0);
    expect(result.breakdown.temperature).toBeLessThan(25);
  });

  it('gives time score 20 when inside window', () => {
    const july17h = new Date('2025-07-15T17:00:00');
    const result = scoreRule(makeSummerRule(), [makeReading()], july17h);
    expect(result.breakdown.timeOfDay).toBe(20);
  });

  it('gives time score 0 when far outside window', () => {
    const july6h = new Date('2025-07-15T06:00:00');
    const result = scoreRule(makeSummerRule(), [makeReading()], july6h);
    expect(result.breakdown.timeOfDay).toBe(0);
  });

  it('gives wind direction 15 when inside range', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading({ windDirection: 250 }); // WSW, in 200-290
    const result = scoreRule(makeSummerRule(), [reading], july);
    expect(result.breakdown.windDirection).toBe(15);
  });

  it('gives wind direction 0 when far outside range', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading({ windDirection: 90 }); // E, outside 200-290
    const result = scoreRule(makeSummerRule(), [reading], july);
    expect(result.breakdown.windDirection).toBe(0);
  });

  it('gives wind speed 15 when above minSpeed', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading({ windSpeed: 5.0 }); // > 2.5 minSpeed
    const result = scoreRule(makeSummerRule(), [reading], july);
    expect(result.breakdown.windSpeed).toBe(15);
  });

  it('gives partial speed when 50-100% of minSpeed', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading({ windSpeed: 1.5 }); // 60% of 2.5
    const result = scoreRule(makeSummerRule(), [reading], july);
    expect(result.breakdown.windSpeed).toBeGreaterThan(0);
    expect(result.breakdown.windSpeed).toBeLessThan(15);
  });

  // ── ΔT scaling ──

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

  it('applies ΔT penalty for low diurnal range', () => {
    const july = new Date('2025-07-15T17:00:00');
    const reading = makeReading();
    const noCtx = scoreRule(makeSummerRule(), [reading], july);
    const withCtx = scoreRule(makeSummerRule(), [reading], july, {
      deltaT: 5,
      tempMin: 18,
      tempMax: 23,
    });
    expect(withCtx.score).toBeLessThan(noCtx.score);
  });

  // ── Multiple readings (zone averaging) ──

  it('averages multiple station readings', () => {
    const july = new Date('2025-07-15T17:00:00');
    const readings = [
      makeReading({ temperature: 30, windSpeed: 3 }),
      makeReading({ temperature: 34, windSpeed: 5 }),
    ];
    const result = scoreRule(makeSummerRule(), readings, july);
    // avgTemp = 32, avgSpeed = 4 → both above thresholds
    expect(result.breakdown.temperature).toBe(25);
    expect(result.breakdown.windSpeed).toBe(15);
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
  it('assigns none for scores below threshold', () => {
    const scores: RuleScore[] = [{
      ruleId: 'thermal_1',
      score: 20,
      breakdown: { temperature: 5, humidity: 5, timeOfDay: 5, season: 3, windDirection: 2, windSpeed: 0 },
      matchedZone: 'embalse',
    }];
    const alerts = computeZoneAlerts(scores);
    expect(alerts.get('embalse')?.alertLevel).toBe('none');
  });

  it('assigns low for scores 30-55', () => {
    const scores: RuleScore[] = [{
      ruleId: 'thermal_1',
      score: 45,
      breakdown: { temperature: 10, humidity: 5, timeOfDay: 10, season: 10, windDirection: 5, windSpeed: 5 },
      matchedZone: 'embalse',
    }];
    const alerts = computeZoneAlerts(scores);
    expect(alerts.get('embalse')?.alertLevel).toBe('low');
  });

  it('assigns medium for scores 55-75', () => {
    const scores: RuleScore[] = [{
      ruleId: 'thermal_1',
      score: 65,
      breakdown: { temperature: 20, humidity: 8, timeOfDay: 15, season: 10, windDirection: 7, windSpeed: 5 },
      matchedZone: 'embalse',
    }];
    const alerts = computeZoneAlerts(scores);
    expect(alerts.get('embalse')?.alertLevel).toBe('medium');
  });

  it('assigns high for scores >= 75', () => {
    const scores: RuleScore[] = [{
      ruleId: 'thermal_1',
      score: 85,
      breakdown: { temperature: 25, humidity: 10, timeOfDay: 20, season: 15, windDirection: 10, windSpeed: 5 },
      matchedZone: 'embalse',
    }];
    const alerts = computeZoneAlerts(scores);
    expect(alerts.get('embalse')?.alertLevel).toBe('high');
  });

  it('keeps highest score when multiple rules match same zone', () => {
    const scores: RuleScore[] = [
      {
        ruleId: 'thermal_1', score: 40,
        breakdown: { temperature: 10, humidity: 5, timeOfDay: 10, season: 5, windDirection: 5, windSpeed: 5 },
        matchedZone: 'embalse',
      },
      {
        ruleId: 'thermal_2', score: 70,
        breakdown: { temperature: 20, humidity: 10, timeOfDay: 15, season: 10, windDirection: 10, windSpeed: 5 },
        matchedZone: 'embalse',
      },
    ];
    const alerts = computeZoneAlerts(scores);
    expect(alerts.get('embalse')?.maxScore).toBe(70);
    expect(alerts.get('embalse')?.alertLevel).toBe('medium');
    expect(alerts.get('embalse')?.activeRules).toHaveLength(2);
  });
});
