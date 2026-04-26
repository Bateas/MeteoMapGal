/**
 * Tests for thermalAlerts builders — inversions + thermal wind zone alerts.
 *
 * Critical path: feeds frontend AlertPanel + ThermalWindPanel. Pure
 * transformation, capped at 'moderate' severity by design (notable but
 * not dangerous — never orange/red).
 *
 * S123: fifth test file in src/services/alerts/.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildInversionAlerts, buildThermalAlerts } from './thermalAlerts';
import type { ThermalProfile } from '../lapseRateService';
import type { ZoneAlert, MicroZoneId } from '../../types/thermal';
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

// ── buildThermalAlerts ─────────────────────────────────────

function zoneAlert(over: Partial<ZoneAlert> & {
  zoneId: MicroZoneId;
  maxScore: number;
  alertLevel: ZoneAlert['alertLevel'];
}): ZoneAlert {
  return {
    activeRules: [],
    ...over,
  };
}

describe('buildThermalAlerts', () => {
  it('returns [] for empty Map', () => {
    expect(buildThermalAlerts(new Map())).toEqual([]);
  });

  it('skips zones with alertLevel=none', () => {
    const map = new Map<MicroZoneId, ZoneAlert>([
      ['embalse', zoneAlert({ zoneId: 'embalse', maxScore: 10, alertLevel: 'none' })],
    ]);
    expect(buildThermalAlerts(map)).toEqual([]);
  });

  it('emits one alert per active zone', () => {
    const map = new Map<MicroZoneId, ZoneAlert>([
      ['embalse', zoneAlert({ zoneId: 'embalse', maxScore: 70, alertLevel: 'high' })],
      ['ourense', zoneAlert({ zoneId: 'ourense', maxScore: 50, alertLevel: 'medium' })],
      ['norte', zoneAlert({ zoneId: 'norte', maxScore: 5, alertLevel: 'none' })],
    ]);
    const alerts = buildThermalAlerts(map);
    expect(alerts).toHaveLength(2); // 'norte' skipped (none)
    expect(alerts.map(a => a.id).sort()).toEqual([
      'thermal-embalse', 'thermal-ourense',
    ]);
  });

  it('formats title with level label + zone id', () => {
    const map = new Map<MicroZoneId, ZoneAlert>([
      ['embalse', zoneAlert({ zoneId: 'embalse', maxScore: 75, alertLevel: 'high' })],
    ]);
    expect(buildThermalAlerts(map)[0].title).toBe('Térmico ALTO — embalse');
  });

  it('maps alertLevel to label: high=ALTO, medium=MEDIO, low=BAJO', () => {
    const map = new Map<MicroZoneId, ZoneAlert>([
      ['embalse', zoneAlert({ zoneId: 'embalse', maxScore: 30, alertLevel: 'low' })],
    ]);
    expect(buildThermalAlerts(map)[0].title).toContain('BAJO');
  });

  it('caps severity at moderate (info or moderate, never high/critical)', () => {
    const map = new Map<MicroZoneId, ZoneAlert>([
      ['embalse', zoneAlert({ zoneId: 'embalse', maxScore: 95, alertLevel: 'high' })],
    ]);
    const sev = buildThermalAlerts(map)[0].severity;
    expect(['info', 'moderate']).toContain(sev);
  });

  it('includes zoneId metadata field', () => {
    const map = new Map<MicroZoneId, ZoneAlert>([
      ['ourense', zoneAlert({ zoneId: 'ourense', maxScore: 60, alertLevel: 'medium' })],
    ]);
    expect(buildThermalAlerts(map)[0].zoneId).toBe('ourense');
  });

  it('urgent=true only when level=high AND score>=70', () => {
    const map = new Map<MicroZoneId, ZoneAlert>([
      ['embalse', zoneAlert({ zoneId: 'embalse', maxScore: 75, alertLevel: 'high' })],
    ]);
    expect(buildThermalAlerts(map)[0].urgent).toBe(true);

    const map2 = new Map<MicroZoneId, ZoneAlert>([
      ['embalse', zoneAlert({ zoneId: 'embalse', maxScore: 65, alertLevel: 'high' })],
    ]);
    expect(buildThermalAlerts(map2)[0].urgent).toBe(false); // score<70
  });
});
