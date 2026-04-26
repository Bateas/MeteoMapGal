/**
 * Tests for dewPointService — pure dew point math + analyzeFog() prediction engine.
 *
 * Critical path: feeds FogOverlay (visual) and FieldDrawer fog section. Bugs cause
 * either silent overlay (S122 require() bug) or false PELIGRO (S114 dewPoint
 * critico cap). Both well-known incidents — these tests guard the regressions.
 */

import { describe, it, expect } from 'vitest';
import { calculateDewPoint, calculateSpread, analyzeFog } from './dewPointService';
import type { NormalizedReading } from '../types/station';
import type { HourlyForecast } from '../types/forecast';

// ── Builder helpers ───────────────────────────────────────────

function reading(over: Partial<NormalizedReading> & { stationId: string; timestamp: Date }): NormalizedReading {
  return {
    windSpeed: 0.5,
    windGust: null,
    windDirection: 200, // SW (non-continental)
    temperature: 12,
    humidity: 95,
    precipitation: null,
    solarRadiation: null,
    pressure: null,
    dewPoint: null,
    ...over,
  };
}

/** Build N readings spaced 30 min apart for one station, ending at `now`. */
function history(stationId: string, now: Date, opts: Partial<NormalizedReading> & { temp: number; humidity: number }, n = 6): NormalizedReading[] {
  const out: NormalizedReading[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(reading({
      stationId,
      timestamp: new Date(now.getTime() - i * 30 * 60 * 1000),
      temperature: opts.temp,
      humidity: opts.humidity,
      windSpeed: opts.windSpeed ?? 0.5,
      windDirection: opts.windDirection ?? 200,
      windGust: opts.windGust ?? null,
      solarRadiation: opts.solarRadiation ?? null,
    }));
  }
  return out;
}

const NOW = new Date('2026-04-26T03:00:00Z'); // 03:00 UTC = night-ish, hour=3

// ── calculateDewPoint — Magnus formula ────────────────────────

describe('calculateDewPoint', () => {
  it('returns ~temp at 100% humidity (saturation)', () => {
    expect(calculateDewPoint(15, 100)).toBeCloseTo(15, 1);
  });

  it('drops below temp as humidity decreases', () => {
    const dp50 = calculateDewPoint(20, 50);
    expect(dp50).toBeLessThan(20);
    expect(dp50).toBeGreaterThan(8); // ~9.3°C
  });

  it('clamps humidity at 1% (Math.log guard)', () => {
    // humidity=0 would Math.log(0) = -Infinity
    expect(Number.isFinite(calculateDewPoint(15, 0))).toBe(true);
  });

  it('clamps humidity at 100% (no super-saturation)', () => {
    expect(calculateDewPoint(15, 150)).toBeCloseTo(calculateDewPoint(15, 100), 1);
  });
});

describe('calculateSpread', () => {
  it('returns 0 at saturation', () => {
    expect(calculateSpread(15, 100)).toBeCloseTo(0, 1);
  });

  it('returns positive when air is unsaturated', () => {
    expect(calculateSpread(20, 50)).toBeGreaterThan(5);
  });
});

// ── analyzeFog — empty / insufficient data ────────────────────

describe('analyzeFog — insufficient data', () => {
  it('returns level=none for empty readings map', () => {
    const result = analyzeFog(new Map(), NOW);
    expect(result.level).toBe('none');
    expect(result.confidence).toBe(0);
  });

  it('returns level=none with <3 valid readings', () => {
    const map = new Map<string, NormalizedReading[]>();
    map.set('s1', [reading({ stationId: 's1', timestamp: NOW, temperature: 12, humidity: 95 })]);
    expect(analyzeFog(map, NOW).level).toBe('none');
  });

  it('skips readings missing temp or humidity', () => {
    const map = new Map<string, NormalizedReading[]>();
    map.set('s1', [
      reading({ stationId: 's1', timestamp: NOW, temperature: null }),
      reading({ stationId: 's1', timestamp: NOW, humidity: null }),
    ]);
    expect(analyzeFog(map, NOW).level).toBe('none');
  });
});

// ── analyzeFog — fog detection at small spread ────────────────

describe('analyzeFog — fog at small spread', () => {
  it('detects fog at high humidity / small spread', () => {
    const map = new Map<string, NormalizedReading[]>();
    map.set('s1', history('s1', NOW, { temp: 12, humidity: 99 }));
    map.set('s2', history('s2', NOW, { temp: 11.5, humidity: 99 }));
    map.set('s3', history('s3', NOW, { temp: 12.2, humidity: 98 }));
    const r = analyzeFog(map, NOW);
    // Spread ~0.1°C → 'alto' but night downgrades to 'riesgo'
    expect(r.level).not.toBe('none');
    expect(r.spread).toBeLessThan(0.5);
  });

  it('caps at "alto" max — never returns "critico"', () => {
    // Regression guard: S114 dewPointService critico uncapped → false PELIGRO
    const map = new Map<string, NormalizedReading[]>();
    for (const id of ['s1', 's2', 's3', 's4']) {
      map.set(id, history(id, NOW, { temp: 10, humidity: 100 }));
    }
    const r = analyzeFog(map, NOW);
    expect(r.level).not.toBe('critico');
  });

  it('large spread → level=none', () => {
    const map = new Map<string, NormalizedReading[]>();
    map.set('s1', history('s1', NOW, { temp: 25, humidity: 30 }));
    map.set('s2', history('s2', NOW, { temp: 26, humidity: 32 }));
    map.set('s3', history('s3', NOW, { temp: 24, humidity: 35 }));
    const r = analyzeFog(map, NOW);
    expect(r.level).toBe('none');
    expect(r.spread).toBeGreaterThan(8);
  });
});

// ── Suppressors: gust / continental wind / solar ──────────────

describe('analyzeFog — suppression', () => {
  it('suppresses fog when any station has gust ≥5 m/s', () => {
    // Even with sat humidity, strong gust kills fog
    const map = new Map<string, NormalizedReading[]>();
    map.set('s1', history('s1', NOW, { temp: 12, humidity: 99, windGust: 6 }));
    map.set('s2', history('s2', NOW, { temp: 12, humidity: 99 }));
    map.set('s3', history('s3', NOW, { temp: 12, humidity: 99 }));
    const r = analyzeFog(map, NOW);
    expect(r.level).toBe('none');
    expect(r.hypothesis).toContain('rachas');
  });

  it('suppresses fog with continental N wind + dry-ish HR', () => {
    // N wind (350°), 3 m/s, HR 75% → continental dry
    const map = new Map<string, NormalizedReading[]>();
    map.set('s1', history('s1', NOW, { temp: 12, humidity: 75, windDirection: 350, windSpeed: 3 }));
    map.set('s2', history('s2', NOW, { temp: 12, humidity: 75, windDirection: 0, windSpeed: 3 }));
    map.set('s3', history('s3', NOW, { temp: 12, humidity: 75, windDirection: 10, windSpeed: 3 }));
    const r = analyzeFog(map, NOW);
    expect(r.level).toBe('none');
    expect(r.hypothesis).toMatch(/continental|seco/);
  });

  it('suppresses fog when avgSolar > 200 W/m² (daytime)', () => {
    const noon = new Date('2026-04-26T13:00:00Z');
    const map = new Map<string, NormalizedReading[]>();
    map.set('s1', history('s1', noon, { temp: 18, humidity: 95, solarRadiation: 400 }));
    map.set('s2', history('s2', noon, { temp: 18, humidity: 96, solarRadiation: 350 }));
    map.set('s3', history('s3', noon, { temp: 18, humidity: 94, solarRadiation: 380 }));
    const r = analyzeFog(map, noon);
    expect(r.level).toBe('none');
    expect(r.hypothesis).toContain('radiación solar');
  });

  it('global N consensus suppresses regardless of physics', () => {
    // 4+ stations with N wind ≥1 m/s, ≥60% N → continental dry air
    const current = new Map<string, NormalizedReading>();
    for (let i = 0; i < 5; i++) {
      current.set(`s${i}`, reading({
        stationId: `s${i}`, timestamp: NOW,
        windDirection: 0, windSpeed: 6, windGust: 8,
        temperature: 12, humidity: 99,
      }));
    }
    const map = new Map<string, NormalizedReading[]>();
    for (let i = 0; i < 5; i++) {
      map.set(`s${i}`, history(`s${i}`, NOW, { temp: 12, humidity: 99 }));
    }
    const r = analyzeFog(map, NOW, undefined, current);
    expect(r.level).toBe('none');
    expect(r.hypothesis).toMatch(/norte|continental/);
  });
});

// ── Forecast cross-validation ─────────────────────────────────

function fc(over: Partial<HourlyForecast> & { hoursAhead: number }): HourlyForecast {
  return {
    time: new Date(NOW.getTime() + over.hoursAhead * 3_600_000),
    temperature: over.temperature ?? 12,
    humidity: over.humidity ?? 80,
    windSpeed: over.windSpeed ?? 1.5,
    windDirection: over.windDirection ?? 200,
    precipitation: over.precipitation ?? 0,
    cloudCover: over.cloudCover ?? 50,
    visibility: over.visibility ?? null,
  } as HourlyForecast;
}

describe('analyzeFog — forecast visibility cross-validation', () => {
  it('promotes to riesgo when forecast visibility <1km', () => {
    // Spread ~5 normally → none, but forecast vis <1km promotes
    const map = new Map<string, NormalizedReading[]>();
    map.set('s1', history('s1', NOW, { temp: 14, humidity: 78 }));
    map.set('s2', history('s2', NOW, { temp: 14, humidity: 79 }));
    map.set('s3', history('s3', NOW, { temp: 14, humidity: 80 }));
    const forecast = [
      fc({ hoursAhead: 1, visibility: 500 }),
      fc({ hoursAhead: 2, visibility: 800 }),
    ];
    const r = analyzeFog(map, NOW, forecast);
    expect(r.level).toBe('riesgo');
    expect(r.hypothesis).toContain('visibilidad prevista <1km');
  });

  it('reduces confidence when forecast visibility is excellent (>10km)', () => {
    const map = new Map<string, NormalizedReading[]>();
    map.set('s1', history('s1', NOW, { temp: 12, humidity: 96 }));
    map.set('s2', history('s2', NOW, { temp: 12, humidity: 96 }));
    map.set('s3', history('s3', NOW, { temp: 12, humidity: 96 }));
    const noForecast = analyzeFog(map, NOW);
    const withGoodVis = analyzeFog(map, NOW, [
      fc({ hoursAhead: 1, visibility: 20000 }),
      fc({ hoursAhead: 2, visibility: 22000 }),
    ]);
    if (noForecast.level !== 'none') {
      // Confidence should drop when forecast disagrees
      expect(withGoodVis.confidence).toBeLessThanOrEqual(noForecast.confidence);
    }
  });
});

// ── Output shape ──────────────────────────────────────────────

describe('analyzeFog — output shape', () => {
  it('returns full FogAlert shape with all fields', () => {
    const map = new Map<string, NormalizedReading[]>();
    map.set('s1', history('s1', NOW, { temp: 12, humidity: 95 }));
    map.set('s2', history('s2', NOW, { temp: 12, humidity: 95 }));
    map.set('s3', history('s3', NOW, { temp: 12, humidity: 95 }));
    const r = analyzeFog(map, NOW);
    expect(r).toHaveProperty('level');
    expect(r).toHaveProperty('dewPoint');
    expect(r).toHaveProperty('spread');
    expect(r).toHaveProperty('spreadTrend');
    expect(r).toHaveProperty('fogEta');
    expect(r).toHaveProperty('humidity');
    expect(r).toHaveProperty('windSpeed');
    expect(r).toHaveProperty('confidence');
    expect(r).toHaveProperty('hypothesis');
    expect(typeof r.hypothesis).toBe('string');
  });
});
