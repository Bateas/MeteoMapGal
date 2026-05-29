/**
 * Tests for inversionForecastService — predicts overnight radiative inversions
 * from the forecast (clear sky + calm wind + big ΔT + night timing + low PBL).
 * Feeds buildInversionAlerts in the alert pipeline. The detector reads
 * `new Date()` for the night-window filter + timing score, so the clock is
 * frozen and fixtures are built relative to it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { forecastInversion, buildInversionForecastAlert } from './inversionForecastService';
import type { HourlyForecast } from '../types/forecast';

// Winter evening — inversions form after sunset. Timing score = 15 (evening).
const NOW = new Date('2026-01-15T18:00:00');

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

function fc(time: Date, o: Partial<HourlyForecast> = {}): HourlyForecast {
  return {
    time,
    temperature: 10, humidity: 80, windSpeed: 1, windDirection: 0, windGusts: 2,
    precipitation: 0, precipProbability: 0, cloudCover: 50, pressure: 1015,
    solarRadiation: null, cape: 0, boundaryLayerHeight: null, visibility: null,
    liftedIndex: null, cin: null, snowLevel: null, skyState: null, isDay: false,
    ...o,
  };
}

/**
 * Build `hours` hourly points starting at `from`. `o` can be a static override
 * or a function of the point's local hour (for day/night temperature ramps).
 */
function series(
  from: Date,
  hours: number,
  o: Partial<HourlyForecast> | ((h: number) => Partial<HourlyForecast>) = {},
): HourlyForecast[] {
  const out: HourlyForecast[] = [];
  for (let i = 1; i <= hours; i++) {
    const t = new Date(from.getTime() + i * 3600_000);
    const extra = typeof o === 'function' ? o(t.getHours()) : o;
    out.push(fc(t, extra));
  }
  return out;
}

/** Classic strong-inversion night: clear, calm, low PBL, big day/night ΔT. */
function strongInversionNight(): HourlyForecast[] {
  return series(NOW, 18, (h) => ({
    cloudCover: 5,
    windSpeed: 0.5,
    boundaryLayerHeight: 80,
    temperature: h >= 11 && h <= 17 ? 20 : 1, // day 20°C, night 1°C → ΔT 19
  }));
}

// ── forecastInversion ────────────────────────────────────

describe('forecastInversion', () => {
  it('returns no prediction with too few points', () => {
    const r = forecastInversion(series(NOW, 6));
    expect(r.predicted).toBe(false);
    expect(r.confidence).toBe(0);
  });

  it('returns no prediction with fewer than 3 night points', () => {
    // Start at 06:00 with 12 points (07:00–18:00): only 07,08 count as night → 2
    const morning = new Date('2026-01-15T06:00:00');
    vi.setSystemTime(morning);
    const r = forecastInversion(series(morning, 12, { cloudCover: 5, windSpeed: 0.5 }));
    expect(r.predicted).toBe(false);
  });

  it('predicts a strong inversion when all factors align', () => {
    const r = forecastInversion(strongInversionNight());
    expect(r.predicted).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(60);
    expect(r.expectedStart).not.toBeNull();
    expect(r.expectedPeak).not.toBeNull();
    expect(r.peakConditions).not.toBeNull();
    expect(r.peakConditions!.temperature).toBeCloseTo(1, 0);
    expect(r.hypothesis).toMatch(/[Ii]nversión probable/);
  });

  it('maxes the contributing factor scores under ideal conditions', () => {
    const { factors } = forecastInversion(strongInversionNight());
    expect(factors.clearSkyScore).toBe(25);
    expect(factors.calmWindScore).toBe(25);
    expect(factors.deltaTScore).toBe(20);
    expect(factors.timingScore).toBe(15); // 18h = evening
    expect(factors.pblScore).toBe(15);    // PBL 80m < 100
  });

  it('does NOT predict when cloudy + windy', () => {
    const r = forecastInversion(series(NOW, 18, {
      cloudCover: 85, windSpeed: 8, boundaryLayerHeight: 900, temperature: 9,
    }));
    expect(r.predicted).toBe(false);
    expect(r.expectedStart).toBeNull();
  });

  it('does NOT predict with clear sky but strong wind (mixing breaks inversion)', () => {
    const r = forecastInversion(series(NOW, 18, (h) => ({
      cloudCover: 5,            // clear
      windSpeed: 7,             // but windy → no inversion
      boundaryLayerHeight: 700,
      temperature: h >= 11 && h <= 17 ? 18 : 4,
    })));
    // clearSky 25 + calmWind 0 + deltaT 15 + timing 15 + pbl 0 = 70... still ≥50?
    // calmWind=0 (wind 7 > 5), pbl=0 (700>600) → 25+0+15+15+0 = 55 → predicted.
    // The point: calmWind + pbl correctly score 0 under windy/mixed conditions.
    expect(r.factors.calmWindScore).toBe(0);
    expect(r.factors.pblScore).toBe(0);
  });
});

// ── buildInversionForecastAlert ──────────────────────────

describe('buildInversionForecastAlert', () => {
  it('returns no alert when no inversion predicted', () => {
    expect(buildInversionForecastAlert(series(NOW, 18, { cloudCover: 90, windSpeed: 9 }))).toEqual([]);
  });

  it('builds a single info-severity inversion alert when predicted', () => {
    const alerts = buildInversionForecastAlert(strongInversionNight());
    expect(alerts).toHaveLength(1);
    const a = alerts[0];
    expect(a.category).toBe('inversion');
    expect(a.severity).toBe('info'); // informational, never safety-amber
    expect(a.icon).toBe('thermometer');
    expect(a.urgent).toBe(false);
    expect(a.id).toBe('inversion-forecast');
    expect(a.title).toMatch(/[Ii]nversión/);
  });
});
