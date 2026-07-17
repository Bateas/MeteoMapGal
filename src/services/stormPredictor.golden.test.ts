/**
 * Golden master for the storm predictor.
 *
 * WHY THIS FILE EXISTS
 * The regular test suite asserts ranges (`toBeGreaterThanOrEqual(40)`), never
 * exact probabilities — so silently changing a signal weight keeps all of it
 * green. Before the outcome-based calibration (934 evaluated predictions,
 * Apr-Jul 2026) starts moving weights around, these snapshots freeze what the
 * predictor answers TODAY for a spread of representative inputs.
 *
 * HOW TO USE IT
 * - Refactors that must NOT change behaviour (e.g. extracting the inline
 *   weights into a config object): these snapshots must stay byte-identical.
 * - Calibration that intentionally changes a weight: run with `-u` and READ
 *   the diff — it is the report of exactly which scenarios moved and by how
 *   much. Never update blind.
 *
 * The signal list also pins the ORDER of `signals`, which is a storage
 * contract: stormPredictionLogger serialises `signals.map(s => s.weight)`
 * positionally and the ingestor writes signals[0..8] into the
 * storm_predictions.signal_* columns. Reordering silently misaligns four
 * months of calibration data.
 */
import { describe, it, expect } from 'vitest';
import { predictStorm } from './stormPredictor';
import type { HourlyForecast } from '../types/forecast';
import type { StormAlert } from '../types/lightning';
import type { StormShadow } from './stormShadowDetector';
import type { MGWarning } from '../api/mgWarningsClient';

// ── Fixtures ─────────────────────────────────────────────

function makeForecast(overrides: Partial<HourlyForecast> = {}): HourlyForecast {
  return {
    time: new Date(Date.now() + 30 * 60_000), // inside the 3h window the predictor reads
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

const alert = (o: Partial<StormAlert> = {}): StormAlert => ({ ...NO_ALERT, ...o });

/** Real shapes, not casts: a wrong field name would freeze a fixture the
 *  predictor silently reads as absent (MGWarning uses maxLevel, not level). */
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

/** maxLevel: 1=amarillo, 2=naranja, 3=rojo */
function makeWarning(maxLevel: number, type = 'Tormenta'): MGWarning {
  return {
    type,
    typeId: 1,
    maxLevel,
    zones: [{
      name: 'Miño',
      id: 336,
      level: maxLevel,
      startTime: new Date(),
      endTime: new Date(Date.now() + 6 * 3600_000),
      comment: '',
    }],
    publishedAt: new Date(),
    link: 'https://example.test/warning',
  };
}

/** Only what the predictor reads is pinned — summary/eta stay free. */
function golden(p: ReturnType<typeof predictStorm>) {
  return {
    probability: p.probability,
    horizon: p.horizon,
    severity: p.severity,
    signals: p.signals.map((s) => `${s.name}=${s.weight}`),
  };
}

// ── Golden scenarios ─────────────────────────────────────

describe('stormPredictor golden master (v2.90.0 — shadow/gusts measured at zero lift)', () => {
  it('signal order is the storage contract for storm_predictions.signal_*', () => {
    const p = predictStorm([makeForecast()], NO_ALERT, null);
    expect(p.signals.map((s) => s.name)).toEqual([
      'CAPE',
      'Lluvia prevista',
      'Nubosidad',
      'Rayos detectados',
      'Tormenta acercandose',
      'Sombra de tormenta',
      'Rachas previstas',
      'Aviso MG oficial',
      'WRF prevé tormentas',
    ]);
  });

  it('clear sky, nothing going on', () => {
    expect(golden(predictStorm([makeForecast()], NO_ALERT, null))).toMatchInlineSnapshot(`
      {
        "horizon": "none",
        "probability": 0,
        "severity": "none",
        "signals": [
          "CAPE=0",
          "Lluvia prevista=0",
          "Nubosidad=0",
          "Rayos detectados=0",
          "Tormenta acercandose=0",
          "Sombra de tormenta=0",
          "Rachas previstas=0",
          "Aviso MG oficial=0",
          "WRF prevé tormentas=0",
        ],
      }
    `);
  });

  it('CAPE alone — moderate', () => {
    expect(golden(predictStorm([makeForecast({ cape: 500 })], NO_ALERT, null))).toMatchInlineSnapshot(`
      {
        "horizon": "none",
        "probability": 10,
        "severity": "none",
        "signals": [
          "CAPE=0.1",
          "Lluvia prevista=0",
          "Nubosidad=0",
          "Rayos detectados=0",
          "Tormenta acercandose=0",
          "Sombra de tormenta=0",
          "Rachas previstas=0",
          "Aviso MG oficial=0",
          "WRF prevé tormentas=0",
        ],
      }
    `);
  });

  it('CAPE alone — high', () => {
    expect(golden(predictStorm([makeForecast({ cape: 1000 })], NO_ALERT, null))).toMatchInlineSnapshot(`
      {
        "horizon": "none",
        "probability": 20,
        "severity": "moderate",
        "signals": [
          "CAPE=0.2",
          "Lluvia prevista=0",
          "Nubosidad=0",
          "Rayos detectados=0",
          "Tormenta acercandose=0",
          "Sombra de tormenta=0",
          "Rachas previstas=0",
          "Aviso MG oficial=0",
          "WRF prevé tormentas=0",
        ],
      }
    `);
  });

  it('CAPE alone — severe', () => {
    expect(golden(predictStorm([makeForecast({ cape: 1800 })], NO_ALERT, null))).toMatchInlineSnapshot(`
      {
        "horizon": "none",
        "probability": 30,
        "severity": "moderate",
        "signals": [
          "CAPE=0.3",
          "Lluvia prevista=0",
          "Nubosidad=0",
          "Rayos detectados=0",
          "Tormenta acercandose=0",
          "Sombra de tormenta=0",
          "Rachas previstas=0",
          "Aviso MG oficial=0",
          "WRF prevé tormentas=0",
        ],
      }
    `);
  });

  it('CAPE high but capped by CIN', () => {
    expect(golden(predictStorm([makeForecast({ cape: 1800, cin: 250 })], NO_ALERT, null))).toMatchInlineSnapshot(`
      {
        "horizon": "none",
        "probability": 15,
        "severity": "moderate",
        "signals": [
          "CAPE=0.15",
          "Lluvia prevista=0",
          "Nubosidad=0",
          "Rayos detectados=0",
          "Tormenta acercandose=0",
          "Sombra de tormenta=0",
          "Rachas previstas=0",
          "Aviso MG oficial=0",
          "WRF prevé tormentas=0",
        ],
      }
    `);
  });

  it('CAPE high with strong lifted index boost', () => {
    expect(golden(predictStorm([makeForecast({ cape: 1800, liftedIndex: -7 })], NO_ALERT, null))).toMatchInlineSnapshot(`
      {
        "horizon": "possible",
        "probability": 40,
        "severity": "moderate",
        "signals": [
          "CAPE=0.4",
          "Lluvia prevista=0",
          "Nubosidad=0",
          "Rayos detectados=0",
          "Tormenta acercandose=0",
          "Sombra de tormenta=0",
          "Rachas previstas=0",
          "Aviso MG oficial=0",
          "WRF prevé tormentas=0",
        ],
      }
    `);
  });

  it('CAPE + heavy rain forecast', () => {
    expect(golden(predictStorm([makeForecast({ cape: 1000, precipitation: 12, precipProbability: 80 })], NO_ALERT, null))).toMatchInlineSnapshot(`
      {
        "horizon": "possible",
        "probability": 45,
        "severity": "moderate",
        "signals": [
          "CAPE=0.2",
          "Lluvia prevista=0.25",
          "Nubosidad=0",
          "Rayos detectados=0",
          "Tormenta acercandose=0",
          "Sombra de tormenta=0",
          "Rachas previstas=0",
          "Aviso MG oficial=0",
          "WRF prevé tormentas=0",
        ],
      }
    `);
  });

  it('clouds only amplify when another signal is live', () => {
    expect(golden(predictStorm([makeForecast({ cloudCover: 97 })], NO_ALERT, null))).toMatchInlineSnapshot(`
      {
        "horizon": "none",
        "probability": 0,
        "severity": "none",
        "signals": [
          "CAPE=0",
          "Lluvia prevista=0",
          "Nubosidad=0",
          "Rayos detectados=0",
          "Tormenta acercandose=0",
          "Sombra de tormenta=0",
          "Rachas previstas=0",
          "Aviso MG oficial=0",
          "WRF prevé tormentas=0",
        ],
      }
    `);
  });

  it('CAPE + full cloud cover', () => {
    expect(golden(predictStorm([makeForecast({ cape: 1000, cloudCover: 97 })], NO_ALERT, null))).toMatchInlineSnapshot(`
      {
        "horizon": "none",
        "probability": 28,
        "severity": "moderate",
        "signals": [
          "CAPE=0.2",
          "Lluvia prevista=0",
          "Nubosidad=0.08",
          "Rayos detectados=0",
          "Tormenta acercandose=0",
          "Sombra de tormenta=0",
          "Rachas previstas=0",
          "Aviso MG oficial=0",
          "WRF prevé tormentas=0",
        ],
      }
    `);
  });

  it('lightning danger + approaching', () => {
    expect(golden(predictStorm([makeForecast({ cape: 1000 })], alert({ level: 'danger', trend: 'approaching', nearestKm: 8, recentCount: 40 }), null))).toMatchInlineSnapshot(`
      {
        "horizon": "imminent",
        "probability": 70,
        "severity": "severe",
        "signals": [
          "CAPE=0.2",
          "Lluvia prevista=0",
          "Nubosidad=0",
          "Rayos detectados=0.35",
          "Tormenta acercandose=0.15",
          "Sombra de tormenta=0",
          "Rachas previstas=0",
          "Aviso MG oficial=0",
          "WRF prevé tormentas=0",
        ],
      }
    `);
  });

  it('lightning watch, not approaching', () => {
    expect(golden(predictStorm([makeForecast()], alert({ level: 'watch', nearestKm: 60, recentCount: 3 }), null))).toMatchInlineSnapshot(`
      {
        "horizon": "none",
        "probability": 20,
        "severity": "moderate",
        "signals": [
          "CAPE=0",
          "Lluvia prevista=0",
          "Nubosidad=0",
          "Rayos detectados=0.2",
          "Tormenta acercandose=0",
          "Sombra de tormenta=0",
          "Rachas previstas=0",
          "Aviso MG oficial=0",
          "WRF prevé tormentas=0",
        ],
      }
    `);
  });

  it('storm shadow with high confidence', () => {
    const shadow = makeShadow({ confidence: 70 });
    expect(golden(predictStorm([makeForecast({ cape: 500 })], NO_ALERT, shadow))).toMatchInlineSnapshot(`
      {
        "horizon": "none",
        "probability": 10,
        "severity": "none",
        "signals": [
          "CAPE=0.1",
          "Lluvia prevista=0",
          "Nubosidad=0",
          "Rayos detectados=0",
          "Tormenta acercandose=0",
          "Sombra de tormenta=0",
          "Rachas previstas=0",
          "Aviso MG oficial=0",
          "WRF prevé tormentas=0",
        ],
      }
    `);
  });

  it('strong gusts forecast', () => {
    expect(golden(predictStorm([makeForecast({ cape: 500, windGusts: 18 })], NO_ALERT, null))).toMatchInlineSnapshot(`
      {
        "horizon": "none",
        "probability": 10,
        "severity": "none",
        "signals": [
          "CAPE=0.1",
          "Lluvia prevista=0",
          "Nubosidad=0",
          "Rayos detectados=0",
          "Tormenta acercandose=0",
          "Sombra de tormenta=0",
          "Rachas previstas=0",
          "Aviso MG oficial=0",
          "WRF prevé tormentas=0",
        ],
      }
    `);
  });

  it('official MG warning — orange', () => {
    const w = [makeWarning(2)]; // naranja
    expect(golden(predictStorm([makeForecast()], NO_ALERT, null, w))).toMatchInlineSnapshot(`
      {
        "horizon": "none",
        "probability": 20,
        "severity": "none",
        "signals": [
          "CAPE=0",
          "Lluvia prevista=0",
          "Nubosidad=0",
          "Rayos detectados=0",
          "Tormenta acercandose=0",
          "Sombra de tormenta=0",
          "Rachas previstas=0",
          "Aviso MG oficial=0.2",
          "WRF prevé tormentas=0",
        ],
      }
    `);
  });

  it('WRF sky state predicting storms', () => {
    const f = [makeForecast({ skyState: 'storm' as never }), makeForecast({ skyState: 'storm' as never })];
    expect(golden(predictStorm(f, NO_ALERT, null))).toMatchInlineSnapshot(`
      {
        "horizon": "none",
        "probability": 0,
        "severity": "none",
        "signals": [
          "CAPE=0",
          "Lluvia prevista=0",
          "Nubosidad=0",
          "Rayos detectados=0",
          "Tormenta acercandose=0",
          "Sombra de tormenta=0",
          "Rachas previstas=0",
          "Aviso MG oficial=0",
          "WRF prevé tormentas=0",
        ],
      }
    `);
  });

  it('everything at once — should cap at 100', () => {
    const f = [
      makeForecast({ cape: 2500, liftedIndex: -8, precipitation: 20, precipProbability: 95, cloudCover: 100, windGusts: 25, skyState: 'storm' as never }),
      makeForecast({ cape: 2500, skyState: 'storm' as never }),
    ];
    const shadow = makeShadow({ confidence: 80 });
    const w = [makeWarning(3)]; // rojo
    expect(golden(predictStorm(f, alert({ level: 'danger', trend: 'approaching', nearestKm: 5, recentCount: 99 }), shadow, w))).toMatchInlineSnapshot(`
      {
        "horizon": "imminent",
        "probability": 100,
        "severity": "extreme",
        "signals": [
          "CAPE=0.4",
          "Lluvia prevista=0.25",
          "Nubosidad=0.08",
          "Rayos detectados=0.35",
          "Tormenta acercandose=0.15",
          "Sombra de tormenta=0",
          "Rachas previstas=0",
          "Aviso MG oficial=0.3",
          "WRF prevé tormentas=0",
        ],
      }
    `);
  });

  it('empty forecast', () => {
    expect(golden(predictStorm([], NO_ALERT, null))).toMatchInlineSnapshot(`
      {
        "horizon": "none",
        "probability": 0,
        "severity": "none",
        "signals": [
          "CAPE=0",
          "Lluvia prevista=0",
          "Nubosidad=0",
          "Rayos detectados=0",
          "Tormenta acercandose=0",
          "Sombra de tormenta=0",
          "Rachas previstas=0",
          "Aviso MG oficial=0",
          "WRF prevé tormentas=0",
        ],
      }
    `);
  });
});
