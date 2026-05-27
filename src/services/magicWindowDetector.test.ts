/**
 * Tests for magicWindowDetector — rare optimal sailing convergence detector.
 *
 * Covers score breakdown, lightning veto, sector gating, and edge cases.
 */
import { describe, it, expect } from 'vitest';
import { evaluateMagicWindow, MAGIC_WINDOW_THRESHOLD } from './magicWindowDetector';
import type { BuoyReading } from '../api/buoyClient';

// ── Fixtures ──────────────────────────────────────────

function makeBuoy(overrides: Partial<BuoyReading> = {}): BuoyReading {
  return {
    stationId: 2248, // Cabo Silleiro by default
    stationName: 'Cabo Silleiro',
    timestamp: new Date().toISOString(),
    waveHeight: null,
    waveHeightMax: null,
    wavePeriod: null,
    wavePeriodMean: null,
    waveDir: null,
    windSpeed: 8, // ~15.5kt SW
    windDir: 225,
    windGust: null,
    waterTemp: 16,
    airTemp: null,
    airPressure: null,
    currentSpeed: null,
    currentDir: null,
    salinity: null,
    seaLevel: null,
    humidity: null,
    dewPoint: null,
    ...overrides,
  };
}

// ── Sector gating ─────────────────────────────────────

describe('evaluateMagicWindow — sector gating', () => {
  it('returns null for Embalse (thermal sailing, no magic window concept)', () => {
    const result = evaluateMagicWindow({
      sector: 'embalse',
      buoys: [makeBuoy()],
      mouthHumidity: 85,
      airTempLocal: 22,
      recentStrikesNearby: 0,
      hour: 15,
    });
    expect(result).toBeNull();
  });

  it('evaluates Rías sector', () => {
    const result = evaluateMagicWindow({
      sector: 'rias',
      buoys: [makeBuoy()],
      mouthHumidity: 85,
      airTempLocal: 22,
      recentStrikesNearby: 0,
      hour: 15,
    });
    expect(result).not.toBeNull();
    expect(result!.sector).toBe('rias');
  });
});

// ── Active window — full alignment ────────────────────

describe('evaluateMagicWindow — active window (full alignment)', () => {
  it('triggers when ALL signals align in thermal hour', () => {
    const result = evaluateMagicWindow({
      sector: 'rias',
      buoys: [makeBuoy({ windSpeed: 10, windDir: 225, waterTemp: 16 })],
      mouthHumidity: 85,
      airTempLocal: 22, // ΔT = +6
      recentStrikesNearby: 0,
      hour: 15,
    });
    expect(result!.active).toBe(true);
    expect(result!.score).toBeGreaterThanOrEqual(MAGIC_WINDOW_THRESHOLD);
    expect(result!.summary).toMatch(/MÁGICA|favorable/i);
    expect(result!.estimatedHours).toBeGreaterThan(0);
  });

  it('peak score >= 90 produces "MÁGICA" wording', () => {
    const result = evaluateMagicWindow({
      sector: 'rias',
      buoys: [makeBuoy({ windSpeed: 12, windDir: 230, waterTemp: 14 })],
      mouthHumidity: 92,
      airTempLocal: 23, // ΔT = +9 capped at 25pts
      recentStrikesNearby: 0,
      hour: 15,
    });
    expect(result!.score).toBeGreaterThanOrEqual(90);
    expect(result!.summary).toContain('MÁGICA');
  });
});

// ── Inactive window — missing signals ─────────────────

describe('evaluateMagicWindow — inactive window', () => {
  it('returns inactive when no synoptic SW', () => {
    const result = evaluateMagicWindow({
      sector: 'rias',
      buoys: [makeBuoy({ windSpeed: 2, windDir: 90 })], // 4kt E, not SW
      mouthHumidity: 85,
      airTempLocal: 22,
      recentStrikesNearby: 0,
      hour: 15,
    });
    expect(result!.active).toBe(false);
    expect(result!.signals.hasSynopticSW).toBe(false);
    expect(result!.summary).toContain('Sin ventana');
  });

  it('inactive when out of thermal hour despite synoptic + ΔT', () => {
    const result = evaluateMagicWindow({
      sector: 'rias',
      buoys: [makeBuoy({ windSpeed: 10, windDir: 225, waterTemp: 16 })],
      mouthHumidity: 85,
      airTempLocal: 22,
      recentStrikesNearby: 0,
      hour: 6, // pre-thermal
    });
    // Score should be sub-threshold without the 15pt thermal-hour bonus
    expect(result!.active).toBe(false);
  });

  it('inactive without humidity confirmation (synoptic exists but no inflow signal)', () => {
    const result = evaluateMagicWindow({
      sector: 'rias',
      buoys: [makeBuoy({ windSpeed: 7, windDir: 230, waterTemp: 16 })],
      mouthHumidity: 50, // dry — no canalization confirmation
      airTempLocal: 19, // ΔT = +3 minimum
      recentStrikesNearby: 0,
      hour: 15,
    });
    // Score: 18 (synoptic) + 0 (humidity) + 15 (ΔT) + 15 (hour) + 10 (no lightning) = 58
    expect(result!.active).toBe(false);
    expect(result!.score).toBeLessThan(MAGIC_WINDOW_THRESHOLD);
  });
});

// ── Lightning veto ────────────────────────────────────

describe('evaluateMagicWindow — lightning veto', () => {
  it('VETOES the window when ≥3 strikes nearby (even with perfect alignment)', () => {
    const result = evaluateMagicWindow({
      sector: 'rias',
      buoys: [makeBuoy({ windSpeed: 12, windDir: 230, waterTemp: 14 })],
      mouthHumidity: 92,
      airTempLocal: 23,
      recentStrikesNearby: 5, // ≥3 = veto
      hour: 15,
    });
    expect(result!.active).toBe(false);
    expect(result!.score).toBe(0);
    expect(result!.summary).toMatch(/[Vv]eto eléctrico/i);
  });

  it('counts 1-2 strikes as warning but does NOT veto', () => {
    const result = evaluateMagicWindow({
      sector: 'rias',
      buoys: [makeBuoy({ windSpeed: 10, windDir: 225, waterTemp: 16 })],
      mouthHumidity: 85,
      airTempLocal: 22,
      recentStrikesNearby: 1, // <3 = no veto, partial credit
      hour: 15,
    });
    // Should still be evaluated, with 5pts partial instead of 10pts clear-sky
    expect(result!.summary).not.toContain('Veto');
  });
});

// ── Signal contributions ──────────────────────────────

describe('evaluateMagicWindow — signal contributions', () => {
  it('exposes signal breakdown for transparency / debugging', () => {
    const result = evaluateMagicWindow({
      sector: 'rias',
      buoys: [makeBuoy({ windSpeed: 8, windDir: 225, waterTemp: 16 })],
      mouthHumidity: 80,
      airTempLocal: 20,
      recentStrikesNearby: 0,
      hour: 14,
    });
    expect(result!.signals.hasSynopticSW).toBe(true);
    expect(result!.signals.synopticWindMs).toBe(8);
    expect(result!.signals.synopticDir).toBe(225);
    expect(result!.signals.mouthHumidity).toBe(80);
    expect(result!.signals.waterTemp).toBe(16);
    expect(result!.signals.airTemp).toBe(20);
    expect(result!.signals.deltaT).toBe(4);
    expect(result!.signals.hour).toBe(14);
    expect(result!.signals.recentStrikesNearby).toBe(0);
  });

  it('handles missing data gracefully (no airTemp → no ΔT but other signals still scored)', () => {
    const result = evaluateMagicWindow({
      sector: 'rias',
      buoys: [makeBuoy({ windSpeed: 10, windDir: 225 })],
      mouthHumidity: 85,
      airTempLocal: null,
      recentStrikesNearby: 0,
      hour: 15,
    });
    expect(result!.signals.deltaT).toBeNull();
    // Score: ~22 (synoptic 10) + 15 (HR 85) + 0 (no ΔT) + 15 (hour) + 10 (clear) = 62
    expect(result!.active).toBe(false);
  });
});

// ── estimatedHours ─────────────────────────────────────

describe('evaluateMagicWindow — estimatedHours', () => {
  it('returns 0 hours when window inactive', () => {
    const result = evaluateMagicWindow({
      sector: 'rias',
      buoys: [],
      mouthHumidity: null,
      airTempLocal: null,
      recentStrikesNearby: 0,
      hour: 15,
    });
    expect(result!.estimatedHours).toBe(0);
  });

  it('estimates remaining thermal window based on hour', () => {
    const at12 = evaluateMagicWindow({
      sector: 'rias',
      buoys: [makeBuoy({ windSpeed: 10, windDir: 225, waterTemp: 16 })],
      mouthHumidity: 85,
      airTempLocal: 22,
      recentStrikesNearby: 0,
      hour: 12,
    });
    const at18 = evaluateMagicWindow({
      sector: 'rias',
      buoys: [makeBuoy({ windSpeed: 10, windDir: 225, waterTemp: 16 })],
      mouthHumidity: 85,
      airTempLocal: 22,
      recentStrikesNearby: 0,
      hour: 18,
    });
    expect(at12!.estimatedHours).toBeGreaterThan(at18!.estimatedHours);
  });
});
