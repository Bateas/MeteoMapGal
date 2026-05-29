/**
 * Tests for fieldAlertEngine — pure agricultural alert checks (frost, rain/hail,
 * drone conditions, ET₀ evapotranspiration, grapevine disease risk).
 *
 * Several functions read `Date.now()` / `new Date()` internally for their
 * "from now" forecast windows, so the clock is frozen with fake timers and
 * fixtures are built relative to that fixed instant — keeps the suite stable
 * across CI (UTC) vs local (CEST).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  checkFrost,
  checkRainHail,
  checkDroneConditions,
  computeET0,
  checkDiseaseRisk,
} from './fieldAlertEngine';
import type { HourlyForecast } from '../types/forecast';

// Fixed clock: noon, 15 July 2026 (local). Summer so sunset ~21h / sunrise ~7h.
const NOW = new Date('2026-07-15T12:00:00');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

// ── Forecast factory ─────────────────────────────────────

function fc(time: Date, o: Partial<HourlyForecast> = {}): HourlyForecast {
  return {
    time,
    temperature: 15, humidity: 60, windSpeed: 1, windDirection: 0, windGusts: 2,
    precipitation: 0, precipProbability: 0, cloudCover: 50, pressure: 1015,
    solarRadiation: null, cape: 0, boundaryLayerHeight: null, visibility: null,
    liftedIndex: null, cin: null, snowLevel: null, skyState: null, isDay: true,
    ...o,
  };
}

/** N hourly points starting 1h after `from`. */
function series(from: Date, hours: number, o: Partial<HourlyForecast> = {}): HourlyForecast[] {
  const out: HourlyForecast[] = [];
  for (let i = 1; i <= hours; i++) {
    out.push(fc(new Date(from.getTime() + i * 3600_000), o));
  }
  return out;
}

// ── checkFrost ───────────────────────────────────────────

describe('checkFrost', () => {
  it('empty forecast → none', () => {
    expect(checkFrost([]).level).toBe('none');
  });

  it('cold + clear + calm night → critico', () => {
    // Build a clear, calm, freezing night (hours 22→06)
    const night: HourlyForecast[] = [];
    for (let h = 22; h <= 30; h++) {
      const t = new Date('2026-07-15T00:00:00');
      t.setHours(h % 24);
      night.push(fc(t, { temperature: 0, cloudCover: 10, windSpeed: 0 }));
    }
    const r = checkFrost(night);
    expect(r.level).toBe('critico');
    expect(r.minTemp).toBe(0);
    expect(r.timeWindow).not.toBeNull();
  });

  it('cold but windy/cloudy → downgraded (not critico)', () => {
    const night: HourlyForecast[] = [];
    for (let h = 22; h <= 30; h++) {
      const t = new Date('2026-07-15T00:00:00');
      t.setHours(h % 24);
      night.push(fc(t, { temperature: 0, cloudCover: 80, windSpeed: 6 }));
    }
    const r = checkFrost(night);
    expect(r.level).toBe('alto'); // <=0 but not clear+calm
  });

  it('warm night → none', () => {
    const night: HourlyForecast[] = [];
    for (let h = 22; h <= 30; h++) {
      const t = new Date('2026-07-15T00:00:00');
      t.setHours(h % 24);
      night.push(fc(t, { temperature: 14, cloudCover: 10, windSpeed: 0 }));
    }
    expect(checkFrost(night).level).toBe('none');
  });
});

// ── checkRainHail ────────────────────────────────────────

describe('checkRainHail', () => {
  it('empty forecast → none', () => {
    expect(checkRainHail([]).level).toBe('none');
  });

  it('no rain → none', () => {
    expect(checkRainHail(series(NOW, 12)).level).toBe('none');
  });

  it('imminent hail (CAPE>1000 + heavy precip within 3h) → critico', () => {
    const f = series(NOW, 12);
    f[0] = fc(f[0].time, { cape: 1500, precipitation: 8, precipProbability: 90 });
    const r = checkRainHail(f);
    expect(r.level).toBe('critico');
    expect(r.hailRisk).toBe(true);
  });

  it('imminent heavy rain → alto', () => {
    const f = series(NOW, 12);
    f[0] = fc(f[0].time, { precipitation: 12, precipProbability: 85 });
    expect(checkRainHail(f).level).toBe('alto');
  });

  it('skips past hours (negative elapsed)', () => {
    const past = fc(new Date(NOW.getTime() - 3600_000), { precipitation: 50, precipProbability: 100, cape: 2000 });
    const r = checkRainHail([past, ...series(NOW, 6)]);
    expect(r.level).toBe('none'); // the heavy past hour is ignored
  });

  it('reports hoursUntilRain for first significant rain', () => {
    const f = series(NOW, 12);
    f[2] = fc(f[2].time, { precipitation: 2, precipProbability: 80 }); // 3h out
    const r = checkRainHail(f);
    expect(r.firstRainAt).not.toBeNull();
    expect(r.hoursUntilRain).toBeGreaterThan(0);
  });
});

// ── checkDroneConditions ─────────────────────────────────

describe('checkDroneConditions', () => {
  it('empty forecast → not flyable with reason', () => {
    const r = checkDroneConditions([]);
    expect(r.flyable).toBe(false);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it('calm clear → flyable', () => {
    const r = checkDroneConditions(series(NOW, 3, { windSpeed: 2, windGusts: 3, precipitation: 0, cape: 0 }));
    expect(r.flyable).toBe(true);
    expect(r.reasons).toHaveLength(0);
  });

  it('high wind → not flyable', () => {
    const r = checkDroneConditions(series(NOW, 3, { windSpeed: 10 })); // ~19kt > 15
    expect(r.flyable).toBe(false);
    expect(r.reasons.some((x) => /Viento/i.test(x))).toBe(true);
  });

  it('rain → not flyable', () => {
    const r = checkDroneConditions(series(NOW, 3, { windSpeed: 2, precipitation: 1 }));
    expect(r.flyable).toBe(false);
    expect(r.reasons.some((x) => /Lluvia/i.test(x))).toBe(true);
  });

  it('storm risk (high CAPE) → not flyable', () => {
    const r = checkDroneConditions(series(NOW, 3, { windSpeed: 2, cape: 800 }));
    expect(r.flyable).toBe(false);
    expect(r.reasons.some((x) => /tormenta/i.test(x))).toBe(true);
  });
});

// ── computeET0 ───────────────────────────────────────────

describe('computeET0', () => {
  it('too few points → noData', () => {
    expect(computeET0(series(NOW, 6)).et0Daily).toBeNull();
  });

  it('hot dry day → high ET₀ + alert level', () => {
    // 24h, temps 18-32, low humidity, with solar data
    const f: HourlyForecast[] = [];
    for (let i = 1; i <= 24; i++) {
      const t = new Date(NOW.getTime() + i * 3600_000);
      const temp = 18 + (i % 12); // 18..29
      f.push(fc(t, { temperature: temp, humidity: 35, solarRadiation: 700, windSpeed: 1 }));
    }
    const r = computeET0(f);
    expect(r.et0Daily).not.toBeNull();
    expect(r.et0Daily!).toBeGreaterThan(2);
    expect(['riesgo', 'alto', 'critico']).toContain(r.level);
  });

  it('🔑 TZ-fix: Ra fallback (no solar) uses the FORECAST month, deterministically', () => {
    // No solar data → ET₀ falls back to the per-month Ra table. The fix reads
    // `day[0].time.getMonth()` (the forecast's own date) instead of the wall
    // clock, so this test is stable regardless of when CI runs AND correct at a
    // month-boundary midnight. Clock + forecast both July (the realistic case:
    // a forecast is always ~today). July Ra=24 → summer-regime ET₀.
    const base = new Date('2026-07-15T13:00:00');
    const f: HourlyForecast[] = [];
    for (let i = 0; i < 24; i++) {
      const t = new Date(base.getTime() + i * 3600_000);
      const temp = 18 + (i % 14); // range ~13°C
      f.push(fc(t, { temperature: temp, humidity: 40, solarRadiation: null, windSpeed: 1 }));
    }
    const r = computeET0(f);
    expect(r.et0Daily).not.toBeNull();
    // July Ra (24) → ET₀ clearly in the summer regime (~3+). Winter Ra (8) for
    // the same temps would land ~1.2, so this asserts the warm-month Ra path.
    // Stable across CI timezones because the month comes from the forecast's
    // own timestamp (day[0].time), not the wall clock.
    expect(r.et0Daily!).toBeGreaterThan(2.5);
  });
});

// ── checkDiseaseRisk ─────────────────────────────────────

describe('checkDiseaseRisk', () => {
  it('too few points → no risk', () => {
    const r = checkDiseaseRisk(series(NOW, 4));
    expect(r.mildiu.risk).toBe(false);
    expect(r.oidio.risk).toBe(false);
  });

  it('mildiu conditions (warm + very humid + rain) sustained → critico', () => {
    const f = series(NOW, 12, { temperature: 16, humidity: 95, precipitation: 0.5 });
    const r = checkDiseaseRisk(f);
    expect(r.mildiu.risk).toBe(true);
    expect(r.mildiu.level).toBe('critico'); // >=6h
  });

  it('oidio conditions (moderate temp + humid + dry) sustained → risk', () => {
    const f = series(NOW, 12, { temperature: 20, humidity: 75, precipitation: 0 });
    const r = checkDiseaseRisk(f);
    expect(r.oidio.risk).toBe(true);
    expect(['riesgo', 'alto', 'critico']).toContain(r.oidio.level);
  });

  it('dry mild conditions → no disease risk', () => {
    const f = series(NOW, 12, { temperature: 12, humidity: 50, precipitation: 0 });
    const r = checkDiseaseRisk(f);
    expect(r.mildiu.risk).toBe(false);
    expect(r.oidio.risk).toBe(false);
  });
});
