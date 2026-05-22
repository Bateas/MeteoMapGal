/**
 * Tests for thermalAlerts builders — inversion detection only.
 *
 * S136+1 day 4: removed the per-micro-zone `buildThermalAlerts` tests
 * along with the function itself (was spammy + redundant with the
 * thermal precursor service and the dedicated Thermal tab).
 *
 * Critical path: feeds frontend AlertPanel inversion entries. Capped
 * at 'moderate' severity by design (notable but not dangerous).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildInversionAlerts } from './thermalAlerts';
import type { ThermalProfile } from '../lapseRateService';
import type { TeleconnectionIndex } from '../../api/naoClient';

// Fixed daytime hour so isNight=false in tests (unless overridden)
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-26T14:00:00Z')); // 14:00 UTC = 16:00 local Spain summer
});

afterEach(() => {
  vi.useRealTimers();
});

// ── ThermalProfile builder ─────────────────────────────────

function profile(over: Partial<ThermalProfile> & {
  slopePerKm?: number;
  rSquared?: number;
  stationCount?: number;
}): ThermalProfile {
  const { slopePerKm = 3, rSquared = 0.7, stationCount = 5, ...rest } = over;
  return {
    stations: [],
    regression: { slopePerKm, interceptC: 15, rSquared, stationCount },
    overallLapseRate: slopePerKm,
    hasInversion: true,
    status: 'weak-inversion',
    summary: 'test',
    ...rest,
  };
}

function nao(value: number): TeleconnectionIndex {
  return { name: 'NAO', value, phase: value > 0 ? 'positive' : 'negative', updatedAt: new Date() };
}

// ── buildInversionAlerts ───────────────────────────────────

describe('buildInversionAlerts — empty cases', () => {
  it('returns [] when profile is null', () => {
    expect(buildInversionAlerts(null)).toEqual([]);
  });

  it('returns [] when hasInversion=false', () => {
    expect(buildInversionAlerts(profile({ hasInversion: false }))).toEqual([]);
  });

  it('returns [] when regression is null', () => {
    expect(buildInversionAlerts(profile({ regression: null }))).toEqual([]);
  });

  it('returns [] for weak nocturnal inversion (suppressed)', () => {
    vi.setSystemTime(new Date('2026-04-26T03:00:00Z')); // 5am local = night
    const p = profile({ slopePerKm: 2, status: 'weak-inversion' });
    expect(buildInversionAlerts(p)).toEqual([]);
  });

  it('emits strong-inversion even at night', () => {
    vi.setSystemTime(new Date('2026-04-26T03:00:00Z'));
    const p = profile({ slopePerKm: 8, status: 'strong-inversion', rSquared: 0.8 });
    expect(buildInversionAlerts(p)).toHaveLength(1);
  });
});

describe('buildInversionAlerts — content', () => {
  it('emits inversion-main with category=inversion', () => {
    const alerts = buildInversionAlerts(profile({ slopePerKm: 5 }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe('inversion-main');
    expect(alerts[0].category).toBe('inversion');
    expect(alerts[0].icon).toBe('thermometer');
  });

  it('uses "INVERSIÓN FUERTE" title for strong status', () => {
    const alerts = buildInversionAlerts(profile({
      slopePerKm: 8, status: 'strong-inversion', rSquared: 0.8,
    }));
    expect(alerts[0].title).toBe('INVERSIÓN FUERTE');
  });

  it('uses "Inversión térmica detectada" for weak status', () => {
    const alerts = buildInversionAlerts(profile({ slopePerKm: 3 }));
    expect(alerts[0].title).toBe('Inversión térmica detectada');
  });

  it('caps severity at moderate even with high score', () => {
    // slope=10 + R²=1.0 → high score, but cappedSeverity stops at 'moderate'
    const alerts = buildInversionAlerts(profile({
      slopePerKm: 10, rSquared: 1.0, status: 'strong-inversion',
    }));
    expect(['info', 'moderate']).toContain(alerts[0].severity);
    expect(alerts[0].severity).not.toBe('high');
    expect(alerts[0].severity).not.toBe('critical');
  });

  it('detail includes slope + station count + R²', () => {
    const alerts = buildInversionAlerts(profile({
      slopePerKm: 4.5, rSquared: 0.65, stationCount: 7,
    }));
    expect(alerts[0].detail).toContain('+4.5°C/km');
    expect(alerts[0].detail).toContain('7 est.');
    expect(alerts[0].detail).toContain('R²=0.65');
  });

  it('appends NAO− context when nao.value < -0.5', () => {
    const alerts = buildInversionAlerts(profile({ slopePerKm: 5 }), nao(-1.2));
    expect(alerts[0].detail).toContain('NAO−');
  });

  it('does NOT append NAO context when neutral', () => {
    const alerts = buildInversionAlerts(profile({ slopePerKm: 5 }), nao(0.2));
    expect(alerts[0].detail).not.toContain('NAO');
  });

  it('urgent=true for strong inversion with R²>=0.5', () => {
    const alerts = buildInversionAlerts(profile({
      slopePerKm: 8, status: 'strong-inversion', rSquared: 0.7,
    }));
    expect(alerts[0].urgent).toBe(true);
  });

  it('urgent=false for weak inversion regardless of R²', () => {
    const alerts = buildInversionAlerts(profile({ slopePerKm: 3, rSquared: 0.9 }));
    expect(alerts[0].urgent).toBe(false);
  });
});

