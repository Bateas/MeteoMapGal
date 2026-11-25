/**
 * Tests for fieldAlertEngine — pure checks of frost and rain/hail.
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
  rainLevelForHours,
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

// ── rainLevelForHours (the 48 h timeline) ────────────────

describe('rainLevelForHours', () => {
  it('judges a block 24 h ahead on its own hours (checkRainHail ignores past 12 h)', () => {
    const block = series(new Date(NOW.getTime() + 23 * 3600_000), 3, { precipitation: 3, precipProbability: 80 });
    expect(checkRainHail(block).level).toBe('none');
    expect(rainLevelForHours(block)).toBe('alto');
  });

  it('same bands as the imminent rule', () => {
    expect(rainLevelForHours(series(NOW, 3))).toBe('none');
    expect(rainLevelForHours(series(NOW, 3, { precipitation: 1.5 }))).toBe('riesgo');
    expect(rainLevelForHours(series(NOW, 3, { precipitation: 12 }))).toBe('alto');
    expect(rainLevelForHours(series(NOW, 3, { precipitation: 8, cape: 1500 }))).toBe('critico');
  });
});
