import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { detectThermalForecast } from './thermalForecastDetector';
import type { HourlyForecast } from '../types/forecast';

const KT_TO_MS = 1 / 1.94384;

/**
 * Build one day of forecast over the thermal window (11-19h local).
 *
 * Defaults reproduce Castrelo on 14 Aug 2026, the day this gate came from:
 * every thermal ingredient present (32C, HR 45%, clear sky) and a model that
 * never gets past 9.5kt.
 */
function day(opts: {
  offsetDays?: number;
  peakTempC?: number;
  minHumidity?: number;
  cloudPct?: number;
  windKt?: number[];
} = {}): HourlyForecast[] {
  const {
    offsetDays = 0,
    peakTempC = 32,
    minHumidity = 45,
    cloudPct = 5,
    windKt = [2.7, 2.5, 1.9, 0.9, 5.1, 6.5, 9.5, 9.2],
  } = opts;

  const base = new Date();
  base.setDate(base.getDate() + offsetDays);
  base.setHours(12, 0, 0, 0);

  return windKt.map((kt, i) => {
    const t = new Date(base);
    t.setHours(12 + i);
    return {
      time: t,
      // Peak in the middle, cooler at the edges — shape does not matter, only the max.
      temperature: i === 4 ? peakTempC : peakTempC - 3,
      humidity: i === 4 ? minHumidity : minHumidity + 15,
      windSpeed: kt * KT_TO_MS,
      cloudCover: cloudPct,
    } as HourlyForecast;
  });
}

/**
 * Freeze the clock in the MORNING. The detector only counts the hours of
 * today that are still ahead of `new Date()`, and the fixture above builds
 * 12-19h, so with a real clock every `today()` assertion here passed before
 * lunch and failed after 19:00 — which is how these seven were first seen
 * failing, in a run that had nothing to do with them.
 *
 * 07:00Z is 09:00 in Galicia and 07:00 on a UTC runner: in both zones the
 * whole window is still in the future, so the test says the same thing on
 * both machines. The fixture and the detector both use LOCAL hours, so the
 * two stay consistent with each other whatever the zone.
 */
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-14T07:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

/** The signal for today, or undefined if the detector stayed quiet. */
function today(hours: HourlyForecast[]) {
  return detectThermalForecast(hours).find((s) => s.day === 'hoy');
}

describe('detectThermalForecast — the model gets the last word on wording', () => {
  it('does not promise strong wind when its own forecast tops out at 9kt', () => {
    // Every ingredient says epic. The wind does not. This is the real 14 Aug.
    const s = today(day());
    expect(s).toBeDefined();
    expect(s!.maxWindKt).toBeLessThan(12);
    expect(s!.label).not.toMatch(/fuerte/i);
    expect(s!.label).not.toMatch(/épico|epico/i);
    // It still speaks — the ingredients ARE there, it just stops overselling.
    expect(s!.label).toMatch(/probable|favorables/i);
  });

  it('still calls it epic when the model actually backs it', () => {
    const s = today(day({ windKt: [6, 8, 11, 14, 17, 18, 16, 12] }));
    expect(s).toBeDefined();
    expect(s!.maxWindKt).toBeGreaterThanOrEqual(12);
    expect(s!.label).toMatch(/épico|epico/i);
    expect(s!.label).toMatch(/fuerte/i);
  });

  it('holds the line right at the threshold', () => {
    // 11kt: one knot short, no claim.
    expect(today(day({ windKt: [2, 4, 6, 8, 10, 11, 11, 9] }))!.label).not.toMatch(/fuerte/i);
    // 12kt: the model reaches the band the engine calls good, claim allowed.
    expect(today(day({ windKt: [2, 4, 6, 8, 10, 12, 12, 9] }))!.label).toMatch(/fuerte/i);
  });

  it('will not claim strong wind when the forecast carries no wind at all', () => {
    const hours = day().map((h) => ({ ...h, windSpeed: null }) as HourlyForecast);
    const s = today(hours);
    expect(s).toBeDefined();
    // maxWindKt would be 0 here, which must read as "unknown", never as "calm
    // enough to be epic". Absence of evidence is not evidence.
    expect(s!.label).not.toMatch(/fuerte/i);
  });

  it('does not let the gate silence the detector entirely', () => {
    // The whole point is downgrading the WORDING, not suppressing the warning:
    // the ingredients are real information and the user still wants them.
    expect(detectThermalForecast(day())).not.toHaveLength(0);
  });
});

describe('detectThermalForecast — the ingredients still rule everything else', () => {
  it('stays silent on a cold day whatever the wind does', () => {
    expect(today(day({ peakTempC: 16, windKt: [15, 16, 18, 20, 22, 20, 18, 15] }))).toBeUndefined();
  });

  it('reports both today and tomorrow when both qualify', () => {
    const signals = detectThermalForecast([...day(), ...day({ offsetDays: 1 })]);
    expect(signals.map((s) => s.day)).toEqual(['hoy', 'manana']);
  });

  it('keeps carrying the wind figure it computes, gate or no gate', () => {
    // maxWindKt was computed and returned but read by nothing — which is how a
    // label could contradict it for months. Anything consuming it should find
    // it populated.
    expect(today(day())!.maxWindKt).toBeGreaterThan(0);
  });
});
