/**
 * Tests for thermalPrecursorService — early-warning detector for localized
 * thermal wind from 7 precursor signals (terral, ΔT water-air, solar ramp,
 * humidity gradient, wind divergence, forecast-favorable, WRF sky_state).
 *
 * Behaviour-focused: we assert the contract (shape, gates, level/confidence
 * thresholds, monotonicity) rather than pinning exact weighted scores, so the
 * tests survive minor weight tuning. The clock is injected (`now`) for
 * timezone stability — dates are built WITHOUT a `Z` suffix so `getHours()`
 * returns the literal local hour on any CI timezone.
 */
import { describe, it, expect } from 'vitest';
import { computeThermalPrecursors, formatThermalCountdown } from './thermalPrecursorService';
import type { ThermalPrecursorResult } from './thermalPrecursorService';
import type { NormalizedStation, NormalizedReading } from '../types/station';
import type { BuoyReading } from '../api/buoyClient';
import type { HourlyForecast } from '../types/forecast';
import { RIAS_SPOTS } from '../config/spots';

const cesantes = RIAS_SPOTS.find(s => s.id === 'cesantes')!;

// ── Fixtures ─────────────────────────────────────────────

function station(
  id: string,
  lat: number,
  lon: number,
  altitude = 10,
): NormalizedStation {
  return { id, name: id, lat, lon, altitude, source: 'meteogalicia', tempOnly: false };
}

function reading(
  stationId: string,
  opts: Partial<NormalizedReading> = {},
): NormalizedReading {
  return {
    stationId,
    timestamp: new Date(),
    windSpeed: null,
    windGust: null,
    windDirection: null,
    temperature: 18,
    humidity: null,
    precipitation: null,
    solarRadiation: null,
    pressure: 1015,
    dewPoint: 12,
    ...opts,
  };
}

function buoy(stationId: number, waterTemp: number | null): BuoyReading {
  return {
    stationId,
    stationName: `buoy-${stationId}`,
    timestamp: new Date().toISOString(),
    waveHeight: null, waveHeightMax: null, wavePeriod: null, wavePeriodMean: null, waveDir: null,
    windSpeed: null, windDir: null, windGust: null,
    waterTemp, airTemp: null, airPressure: null,
    currentSpeed: null, currentDir: null, salinity: null, seaLevel: null,
    humidity: null, dewPoint: null,
  };
}

// A clear July morning, 09h local — inside the terral / solar-ramp window.
const SUMMER_MORNING = new Date('2026-07-15T09:00:00');

/** Build a favorable morning thermal setup near Cesantes. */
function favorableMorning() {
  // Two coastal stations (lon < -8.5) showing light terral (offshore E ~70°)
  // + strong solar + humid coast; one inland (lon ≥ -8.5, alt ≥ 30) drier.
  const stations: NormalizedStation[] = [
    station('coastA', 42.30, -8.62, 10),
    station('coastB', 42.31, -8.60, 10),
    station('inland', 42.30, -8.45, 200),
  ];
  const readings = new Map<string, NormalizedReading>([
    ['coastA', reading('coastA', { windSpeed: 2, windDirection: 70, humidity: 75, solarRadiation: 600, temperature: 18 })],
    ['coastB', reading('coastB', { windSpeed: 2, windDirection: 70, humidity: 75, solarRadiation: 600, temperature: 18 })],
    ['inland', reading('inland', { windSpeed: 0.1, windDirection: 90, humidity: 50, solarRadiation: 600, temperature: 18 })],
  ]);
  const buoys: BuoyReading[] = [buoy(1251, 23)]; // water 23 vs air 18 → ΔT +5°C
  return { stations, readings, buoys };
}

// ── Empty / degenerate inputs ────────────────────────────

describe('computeThermalPrecursors — empty inputs', () => {
  it('returns level none / probability 0 / low confidence with no data', () => {
    const r = computeThermalPrecursors(cesantes, [], new Map(), [], null, SUMMER_MORNING);
    expect(r.probability).toBe(0);
    expect(r.level).toBe('none');
    expect(r.confidence).toBe('low');
    expect(r.eta).toBeNull();
    expect(r.summary).toMatch(/[Ss]in indicios/);
  });

  it('produces a well-formed result shape with all 7 signals', () => {
    const r = computeThermalPrecursors(cesantes, [], new Map(), [], null, SUMMER_MORNING);
    expect(r.spotId).toBe('cesantes');
    expect(r.computedAt).toBe(SUMMER_MORNING);
    expect(r.signals.terral).toBeDefined();
    expect(r.signals.deltaTWaterAir).toBeDefined();
    expect(r.signals.solarRamp).toBeDefined();
    expect(r.signals.humidityGradient).toBeDefined();
    expect(r.signals.windDivergence).toBeDefined();
    expect(r.signals.forecastFavorable).toBeDefined();
    expect(r.signals.skyStateClear).toBeDefined();
    // every signal carries its weight even when inactive
    expect(r.signals.terral.weight).toBeGreaterThan(0);
    expect(r.signals.solarRamp.weight).toBeGreaterThan(0);
  });
});

// ── Favorable setup raises probability + confidence ──────

describe('computeThermalPrecursors — favorable morning', () => {
  it('lifts probability into probable+ with multiple active signals', () => {
    const { stations, readings, buoys } = favorableMorning();
    const r = computeThermalPrecursors(cesantes, stations, readings, buoys, null, SUMMER_MORNING);

    expect(r.probability).toBeGreaterThanOrEqual(40); // probable or higher
    expect(['probable', 'imminent', 'active']).toContain(r.level);
    expect(r.confidence).toBe('high'); // ≥4 active signals
    expect(r.eta).not.toBeNull();
  });

  it('detects the morning terral (offshore E) before noon', () => {
    const { stations, readings, buoys } = favorableMorning();
    const r = computeThermalPrecursors(cesantes, stations, readings, buoys, null, SUMMER_MORNING);
    expect(r.signals.terral.active).toBe(true);
    expect(r.signals.terral.score).toBeGreaterThan(0);
  });

  it('detects warm-water ΔT and strong solar ramp', () => {
    const { stations, readings, buoys } = favorableMorning();
    const r = computeThermalPrecursors(cesantes, stations, readings, buoys, null, SUMMER_MORNING);
    expect(r.signals.deltaTWaterAir.active).toBe(true);
    expect(r.signals.solarRamp.active).toBe(true);
  });

  it('detects coast-inland humidity gradient', () => {
    const { stations, readings, buoys } = favorableMorning();
    const r = computeThermalPrecursors(cesantes, stations, readings, buoys, null, SUMMER_MORNING);
    expect(r.signals.humidityGradient.active).toBe(true);
  });

  it('is deterministic regardless of machine timezone', () => {
    const { stations, readings, buoys } = favorableMorning();
    const a = computeThermalPrecursors(cesantes, stations, readings, buoys, null, SUMMER_MORNING);
    const b = computeThermalPrecursors(cesantes, stations, readings, buoys, null, SUMMER_MORNING);
    expect(a.probability).toBe(b.probability);
    expect(a.level).toBe(b.level);
  });
});

// ── Terral morning gate ──────────────────────────────────

describe('computeThermalPrecursors — terral time gate', () => {
  it('does not credit terral after the morning window (15h)', () => {
    const { stations, readings, buoys } = favorableMorning();
    const afternoon = new Date('2026-07-15T15:00:00');
    const r = computeThermalPrecursors(cesantes, stations, readings, buoys, null, afternoon);
    expect(r.signals.terral.active).toBe(false);
    expect(r.signals.terral.value).toMatch(/matutina pasada/);
  });
});

// ── ΔT water-air monotonicity ────────────────────────────

describe('computeThermalPrecursors — ΔT monotonicity', () => {
  it('warmer water scores >= cooler water', () => {
    const { stations, readings } = favorableMorning();
    const warm = computeThermalPrecursors(cesantes, stations, readings, [buoy(1251, 25)], null, SUMMER_MORNING);
    const cool = computeThermalPrecursors(cesantes, stations, readings, [buoy(1251, 20)], null, SUMMER_MORNING);
    expect(warm.signals.deltaTWaterAir.score).toBeGreaterThanOrEqual(cool.signals.deltaTWaterAir.score);
  });

  it('water colder than air does not activate the ΔT signal', () => {
    const { stations, readings } = favorableMorning();
    const r = computeThermalPrecursors(cesantes, stations, readings, [buoy(1251, 14)], null, SUMMER_MORNING);
    expect(r.signals.deltaTWaterAir.active).toBe(false);
  });

  it('ignores buoys that are not preferred for the spot', () => {
    const { stations, readings } = favorableMorning();
    const r = computeThermalPrecursors(cesantes, stations, readings, [buoy(9999, 25)], null, SUMMER_MORNING);
    expect(r.signals.deltaTWaterAir.active).toBe(false);
    expect(r.signals.deltaTWaterAir.value).toMatch(/[Ss]in datos boya/);
  });
});

// ── Forecast-favorable signal ────────────────────────────

describe('computeThermalPrecursors — forecast signal', () => {
  function afternoonForecast(now: Date): HourlyForecast[] {
    const out: HourlyForecast[] = [];
    for (const h of [13, 14, 15, 16, 17, 18]) {
      const t = new Date(now);
      t.setHours(h, 0, 0, 0);
      out.push({
        time: t,
        temperature: 28, humidity: 50, windSpeed: 4, windDirection: 250, windGusts: 6,
        precipitation: 0, precipProbability: 5, cloudCover: 10, pressure: 1018,
        solarRadiation: 700, cape: null, boundaryLayerHeight: null, visibility: null,
        liftedIndex: null, cin: null, snowLevel: null, skyState: 'SUNNY', isDay: true,
      });
    }
    return out;
  }

  it('activates with a warm, clear, thermal-wind afternoon forecast', () => {
    const { stations, readings, buoys } = favorableMorning();
    const r = computeThermalPrecursors(cesantes, stations, readings, buoys, afternoonForecast(SUMMER_MORNING), SUMMER_MORNING);
    expect(r.signals.forecastFavorable.active).toBe(true);
    expect(r.signals.skyStateClear.active).toBe(true);
  });

  it('stays inactive with a null forecast', () => {
    const r = computeThermalPrecursors(cesantes, [], new Map(), [], null, SUMMER_MORNING);
    expect(r.signals.forecastFavorable.active).toBe(false);
    expect(r.signals.skyStateClear.active).toBe(false);
  });
});

describe('formatThermalCountdown', () => {
  const mk = (level: ThermalPrecursorResult['level'], etaMinutes: number | null): ThermalPrecursorResult =>
    ({ level, etaMinutes } as ThermalPrecursorResult);

  it('returns null when there is no thermal signal', () => {
    expect(formatThermalCountdown(mk('none', null))).toBeNull();
  });

  it('reports "ahora" + active tone when thermal is active', () => {
    const c = formatThermalCountdown(mk('active', 0))!;
    expect(c.text).toBe('Térmico activo ahora');
    expect(c.tone).toBe('active');
  });

  it('treats etaMinutes 0 (already in window) as "ahora"', () => {
    const c = formatThermalCountdown(mk('imminent', 0))!;
    expect(c.text).toMatch(/ahora/);
    expect(c.tone).toBe('soon');
  });

  it('says "ya" when onset is within 20 min', () => {
    const c = formatThermalCountdown(mk('imminent', 15))!;
    expect(c.text).toBe('Térmico entrando ya');
  });

  it('buckets 30-75 min to "~1h"', () => {
    expect(formatThermalCountdown(mk('imminent', 60))!.text).toBe('Térmico entrando en ~1h');
    expect(formatThermalCountdown(mk('probable', 45))!.text).toBe('Térmico probable en ~1h');
  });

  it('rounds longer waits to whole hours with a "~" prefix', () => {
    expect(formatThermalCountdown(mk('probable', 130))!.text).toBe('Térmico probable en ~2h');
    expect(formatThermalCountdown(mk('watch', 175))!.text).toBe('Posible térmico en ~3h');
  });

  it('uses the muted "watch" tone for low-confidence signals', () => {
    expect(formatThermalCountdown(mk('watch', 120))!.tone).toBe('watch');
  });

  it('never emits an exact clock time (only fuzzy buckets)', () => {
    for (const m of [25, 50, 90, 140, 200, 300]) {
      const c = formatThermalCountdown(mk('probable', m))!;
      expect(c.text).not.toMatch(/\d{1,2}:\d{2}/);   // no HH:MM
      expect(c.text).not.toMatch(/\b1[0-9]h\b/);     // no "13h"-style window time
      expect(c.text).toMatch(/~|ya|ahora/);          // always fuzzy
    }
  });

  it('omits the time phrase gracefully when etaMinutes is null', () => {
    const c = formatThermalCountdown(mk('probable', null))!;
    expect(c.text).toBe('Térmico probable');
  });
});
