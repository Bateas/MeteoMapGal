import { describe, it, expect } from 'vitest';
import { predictStorm } from './stormPredictor';
import type { HourlyForecast } from '../types/forecast';
import type { StormAlert } from '../types/lightning';
import type { StormShadow } from './stormShadowDetector';

// ── Helpers ──────────────────────────────────────────────

function makeForecast(overrides: Partial<HourlyForecast> = {}): HourlyForecast {
  return {
    time: new Date(Date.now() + 30 * 60_000), // 30min from now
    temperature: 20,
    humidity: 60,
    windSpeed: 5,
    windDirection: 180,
    windGusts: 8,
    precipitation: 0,
    precipProbability: 10,
    cloudCover: 30,
    pressure: 1013,
    solarRadiation: 400,
    cape: 100,
    liftedIndex: 0,
    cin: 0,
    boundaryLayerHeight: 1000,
    visibility: 15000,
    snowLevel: null,
    skyState: null,
    isDay: true,
    ...overrides,
  };
}

const NO_ALERT: StormAlert = {
  level: 'none',
  nearestKm: Infinity,
  recentCount: 0,
  trend: 'none',
  etaMinutes: null,
  speedKmh: null,
  bearingDeg: null,
  clusters: [],
  updatedAt: new Date(),
};

function makeShadow(overrides: Partial<StormShadow> = {}): StormShadow {
  return {
    center: [-8.1, 42.2],
    movementVector: null,
    movementSpeedKmh: null,
    movementBearing: null,
    shadowedStations: [{
      stationId: 'test-1',
      lat: 42.2,
      lon: -8.1,
      radiation: 100,
      previousRadiation: 400,
      dropRate: -300,
      isShadowed: true,
      shadowOnsetTime: new Date(),
    }],
    clearStations: [],
    windContext: null,
    etaMinutes: null,
    lightningNearby: 0,
    confidence: 70,
    analyzedAt: new Date(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────

describe('stormPredictor', () => {
  describe('predictStorm', () => {
    it('returns zero probability with clear conditions', () => {
      const result = predictStorm([makeForecast()], NO_ALERT, null);
      expect(result.probability).toBe(0);
      expect(result.horizon).toBe('none');
      expect(result.severity).toBe('none');
      expect(result.summary).toContain('Sin indicios');
    });

    it('detects moderate CAPE signal', () => {
      const forecast = [makeForecast({ cape: 500 })];
      const result = predictStorm(forecast, NO_ALERT, null);
      expect(result.probability).toBeGreaterThan(0);
      expect(result.signals.find(s => s.name === 'CAPE')?.active).toBe(true);
    });

    it('detects high CAPE + heavy rain', () => {
      const forecast = [makeForecast({ cape: 1000, precipitation: 12, precipProbability: 85 })];
      const result = predictStorm(forecast, NO_ALERT, null);
      // CAPE 1000 (0.2) + precip 12mm (0.25) = 45%
      expect(result.probability).toBeGreaterThanOrEqual(40);
      expect(result.horizon).toBe('possible');
      // Without lightning, severity stays moderate (CAPE alone doesn't confirm severe)
      expect(result.severity).toBe('moderate');
    });

    it('flags imminent when danger-level lightning approaching', () => {
      const alert: StormAlert = {
        level: 'danger',
        nearestKm: 3,
        recentCount: 15,
        trend: 'approaching',
        etaMinutes: 8,
        speedKmh: 40,
        bearingDeg: 225,
        clusters: [],
        updatedAt: new Date(),
      };
      const result = predictStorm([makeForecast({ cape: 800 })], alert, null);
      expect(result.horizon).toBe('imminent');
      expect(result.probability).toBeGreaterThanOrEqual(60);
      expect(result.action).toContain('Salir del agua');
    });

    it('flags imminent when warning + approaching', () => {
      const alert: StormAlert = {
        level: 'warning',
        nearestKm: 18,
        recentCount: 8,
        trend: 'approaching',
        etaMinutes: 25,
        speedKmh: 35,
        bearingDeg: 200,
        clusters: [],
        updatedAt: new Date(),
      };
      const result = predictStorm([makeForecast()], alert, null);
      expect(result.horizon).toBe('imminent');
      expect(result.probability).toBeGreaterThan(30);
    });

    it('includes storm shadow in computation', () => {
      const shadow = makeShadow({ confidence: 70, etaMinutes: 40 });
      const result = predictStorm([makeForecast()], NO_ALERT, shadow);
      expect(result.signals.find(s => s.name === 'Sombra de tormenta')?.active).toBe(true);
      expect(result.probability).toBeGreaterThan(0);
    });

    it('caps probability at 100', () => {
      const alert: StormAlert = {
        level: 'danger',
        nearestKm: 2,
        recentCount: 50,
        trend: 'approaching',
        etaMinutes: 3,
        speedKmh: 60,
        bearingDeg: 180,
        clusters: [],
        updatedAt: new Date(),
      };
      const forecast = [makeForecast({ cape: 2000, precipitation: 20, precipProbability: 95, cloudCover: 100, windGusts: 20 })];
      const shadow = makeShadow({ confidence: 90, etaMinutes: 5 });
      const result = predictStorm(forecast, alert, shadow);
      expect(result.probability).toBeLessThanOrEqual(100);
      expect(result.severity).toBe('extreme');
    });

    it('severity is extreme with severe CAPE + danger lightning + heavy rain', () => {
      const alert: StormAlert = {
        level: 'danger',
        nearestKm: 4,
        recentCount: 20,
        trend: 'approaching',
        etaMinutes: 5,
        speedKmh: 50,
        bearingDeg: 210,
        clusters: [],
        updatedAt: new Date(),
      };
      const forecast = [makeForecast({ cape: 1600, precipitation: 15 })];
      const result = predictStorm(forecast, alert, null);
      expect(result.severity).toBe('extreme');
    });

    it('returns ETA from lightning when available', () => {
      const alert: StormAlert = {
        level: 'watch',
        nearestKm: 40,
        recentCount: 3,
        trend: 'approaching',
        etaMinutes: 50,
        speedKmh: 30,
        bearingDeg: 250,
        clusters: [],
        updatedAt: new Date(),
      };
      const result = predictStorm([makeForecast()], alert, null);
      expect(result.etaMinutes).toBe(50);
    });

    it('wind gusts contribute to probability', () => {
      const forecast = [makeForecast({ windGusts: 18 })]; // >15 m/s
      const result = predictStorm(forecast, NO_ALERT, null);
      expect(result.signals.find(s => s.name === 'Rachas previstas')?.active).toBe(true);
    });

    it('all 9 signals are always present in output', () => {
      const result = predictStorm([makeForecast()], NO_ALERT, null);
      expect(result.signals).toHaveLength(9);
      const names = result.signals.map(s => s.name);
      expect(names).toContain('CAPE');
      expect(names).toContain('Lluvia prevista');
      expect(names).toContain('Nubosidad');
      expect(names).toContain('Rayos detectados');
      expect(names).toContain('Tormenta acercandose');
      expect(names).toContain('Sombra de tormenta');
      expect(names).toContain('Rachas previstas');
      expect(names).toContain('Aviso MG oficial');
    });

    it('handles empty forecast gracefully', () => {
      const result = predictStorm([], NO_ALERT, null);
      expect(result.probability).toBe(0);
      expect(result.horizon).toBe('none');
    });

    // ── CIN / LI tests ──

    it('CIN suppresses CAPE signal when high', () => {
      // High CAPE but strong CIN lid
      const forecastNoCin = [makeForecast({ cape: 1000, cin: 0 })];
      const forecastHighCin = [makeForecast({ cape: 1000, cin: 250 })];
      const resultNoCin = predictStorm(forecastNoCin, NO_ALERT, null);
      const resultHighCin = predictStorm(forecastHighCin, NO_ALERT, null);
      // High CIN should produce lower probability
      expect(resultHighCin.probability).toBeLessThan(resultNoCin.probability);
    });

    it('negative Lifted Index boosts probability', () => {
      const forecastNeutralLI = [makeForecast({ cape: 500, liftedIndex: 0 })];
      const forecastStrongLI = [makeForecast({ cape: 500, liftedIndex: -7 })];
      const resultNeutral = predictStorm(forecastNeutralLI, NO_ALERT, null);
      const resultStrong = predictStorm(forecastStrongLI, NO_ALERT, null);
      // Strong negative LI should boost probability
      expect(resultStrong.probability).toBeGreaterThan(resultNeutral.probability);
    });

    it('CAPE-only (no lightning) severity capped at moderate', () => {
      // High CAPE but no lightning — should not say "severe"
      const forecast = [makeForecast({ cape: 900 })];
      const result = predictStorm(forecast, NO_ALERT, null);
      expect(result.severity).toBe('moderate');
      expect(result.summary).not.toContain('electrica');
    });

    it('severity severe requires lightning confirmation', () => {
      // CAPE high + lightning warning = severe
      const alert: StormAlert = {
        level: 'danger',
        nearestKm: 8,
        recentCount: 10,
        trend: 'stationary',
        etaMinutes: null,
        speedKmh: null,
        bearingDeg: null,
        clusters: [],
        updatedAt: new Date(),
      };
      const forecast = [makeForecast({ cape: 900 })];
      const result = predictStorm(forecast, alert, null);
      expect(result.severity).toBe('severe');
    });

    it('stale forecast (all past entries) produces zero signals', () => {
      const staleForecast = [makeForecast({ time: new Date(Date.now() - 3600_000) })];
      const result = predictStorm(staleForecast, NO_ALERT, null);
      expect(result.probability).toBe(0);
    });

    it('precipProbability alone can trigger signal', () => {
      const forecast = [makeForecast({ precipitation: 0, precipProbability: 85 })];
      const result = predictStorm(forecast, NO_ALERT, null);
      expect(result.signals.find(s => s.name === 'Lluvia prevista')?.active).toBe(true);
    });

    it('summary includes active signal names', () => {
      const forecast = [makeForecast({ cape: 500, precipitation: 5, cloudCover: 90 })];
      const result = predictStorm(forecast, NO_ALERT, null);
      expect(result.summary).toContain('CAPE');
    });

    // ── MG Warning signal tests ──

    it('MG yellow storm warning contributes to probability', () => {
      const warnings = [{
        type: 'Tormenta',
        typeId: 7,
        maxLevel: 1,
        zones: [{ name: 'Interior Pontevedra', id: 335, level: 1, startTime: new Date(), endTime: new Date(Date.now() + 6 * 3600_000), comment: 'Tormentas' }],
        publishedAt: new Date(),
        link: '',
      }];
      const result = predictStorm([makeForecast()], NO_ALERT, null, warnings);
      const mgSignal = result.signals.find(s => s.name === 'Aviso MG oficial');
      expect(mgSignal?.active).toBe(true);
      expect(mgSignal?.value).toBe('Amarillo');
      expect(result.probability).toBeGreaterThan(0);
    });

    it('MG orange warning has higher weight than yellow', () => {
      const yellowWarnings = [{
        type: 'Tormenta', typeId: 7, maxLevel: 1,
        zones: [{ name: 'Test', id: 335, level: 1, startTime: new Date(), endTime: new Date(Date.now() + 3600_000), comment: '' }],
        publishedAt: new Date(), link: '',
      }];
      const orangeWarnings = [{
        type: 'Tormenta', typeId: 7, maxLevel: 2,
        zones: [{ name: 'Test', id: 335, level: 2, startTime: new Date(), endTime: new Date(Date.now() + 3600_000), comment: '' }],
        publishedAt: new Date(), link: '',
      }];
      const yellowResult = predictStorm([makeForecast()], NO_ALERT, null, yellowWarnings);
      const orangeResult = predictStorm([makeForecast()], NO_ALERT, null, orangeWarnings);
      expect(orangeResult.probability).toBeGreaterThan(yellowResult.probability);
    });

    it('no MG warnings = inactive signal', () => {
      const result = predictStorm([makeForecast()], NO_ALERT, null, []);
      const mgSignal = result.signals.find(s => s.name === 'Aviso MG oficial');
      expect(mgSignal?.active).toBe(false);
      expect(mgSignal?.value).toBe('Ninguno');
    });
  });

  // ── Temporal hysteresis (2026-04-28 audit fixes) ──────
  describe('lightning hysteresis', () => {
    it('holds moderate when alert is none but storm was active in last 30min (lull, not over)', () => {
      // The 18:02 case: severe(98%) at 18:01 → none at 18:02 with 262 strikes.
      // Instantaneous alert dropped but 30min activity is heavy.
      const calm = makeForecast({ cape: 200 });
      const result = predictStorm([calm], NO_ALERT, null, [], {
        count30m: 120, count15m: 40, count5m: 0,
      });
      expect(result.severity).not.toBe('none');
      expect(['moderate', 'severe']).toContain(result.severity);
    });

    it('escalates to severe with heavy recent activity + instability even if last poll calm', () => {
      // The 17:07 case: none(10%) with 468 strikes/window.
      const unstable = makeForecast({ cape: 1000, liftedIndex: -5 });
      const result = predictStorm([unstable], NO_ALERT, null, [], {
        count30m: 250, count15m: 90, count5m: 5,
      });
      expect(result.severity).toBe('severe');
    });

    it('anticipates: high CAPE + LI + overcast, NO strikes yet → moderate (not none)', () => {
      // The 11:00-13:00 miss: CAPE 1500+/LI<-4/overcast for hours at "none".
      const building = makeForecast({ cape: 1600, liftedIndex: -5, cloudCover: 90 });
      const result = predictStorm([building], NO_ALERT, null, [], {
        count30m: 0, count15m: 0, count5m: 0,
      });
      expect(result.severity).toBe('moderate');
    });

    it('no hysteresis param = original behaviour (backwards compatible)', () => {
      // Existing callers without recentActivity must behave exactly as before.
      const calm = makeForecast({ cape: 100 });
      const result = predictStorm([calm], NO_ALERT, null, []);
      expect(result.severity).toBe('none');
    });

    it('low recent activity (<30 in 30min) does NOT trigger the floor', () => {
      // A few isolated strikes shouldn't keep severity elevated.
      const calm = makeForecast({ cape: 100 });
      const result = predictStorm([calm], NO_ALERT, null, [], {
        count30m: 10, count15m: 2, count5m: 0,
      });
      expect(result.severity).toBe('none');
    });

    it('does not downgrade an active instantaneous alert', () => {
      // When the alert IS firing, hysteresis only adds, never weakens.
      const unstable = makeForecast({ cape: 1600, liftedIndex: -5 });
      const dangerAlert: StormAlert = {
        ...NO_ALERT, level: 'danger', nearestKm: 3, recentCount: 50, trend: 'approaching',
      };
      const result = predictStorm([unstable], dangerAlert, null, [], {
        count30m: 300, count15m: 100, count5m: 20,
      });
      expect(['severe', 'extreme']).toContain(result.severity);
    });
  });
});
