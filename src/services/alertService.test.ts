/**
 * Alert Service tests — aggregation, scoring, and sorting.
 */
import { describe, it, expect } from 'vitest';
import {
  buildStormAlerts,
  buildInversionAlerts,
  buildThermalAlerts,
  buildFieldAlerts,
  computeCompositeRisk,
  aggregateAllAlerts,
  type UnifiedAlert,
} from './alertService';
import type { StormAlert } from '../types/lightning';
import type { ThermalProfile } from './lapseRateService';
import type { ZoneAlert, MicroZoneId } from '../types/thermal';
import type { FieldAlerts } from '../types/campo';

// ── Storm alerts ────────────────────────────────────────

describe('buildStormAlerts', () => {
  it('returns empty for level "none"', () => {
    const storm: StormAlert = {
      level: 'none',
      nearestKm: 999,
      recentCount: 0,
      trend: 'stable',
      rings: [],
      updatedAt: new Date(),
    };
    expect(buildStormAlerts(storm)).toEqual([]);
  });

  it('returns critical alert for "danger" level', () => {
    const storm: StormAlert = {
      level: 'danger',
      nearestKm: 5,
      recentCount: 12,
      trend: 'approaching',
      etaMinutes: 3,
      rings: [],
      updatedAt: new Date(),
    };
    const alerts = buildStormAlerts(storm);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].category).toBe('storm');
    expect(alerts[0].urgent).toBe(true);
    expect(alerts[0].score).toBe(95);
  });

  it('returns high alert for "warning" level approaching', () => {
    const storm: StormAlert = {
      level: 'warning',
      nearestKm: 15,
      recentCount: 5,
      trend: 'approaching',
      etaMinutes: 10,
      rings: [],
      updatedAt: new Date(),
    };
    const alerts = buildStormAlerts(storm);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('high');
    expect(alerts[0].urgent).toBe(true);
    expect(alerts[0].detail).toContain('ETA');
  });

  it('shows "alejándose" for receding storms', () => {
    const storm: StormAlert = {
      level: 'watch',
      nearestKm: 40,
      recentCount: 3,
      trend: 'receding',
      rings: [],
      updatedAt: new Date(),
    };
    const alerts = buildStormAlerts(storm);
    expect(alerts[0].detail).toContain('alejándose');
  });
});

// ── Inversion alerts ────────────────────────────────────

describe('buildInversionAlerts', () => {
  it('returns empty for null profile', () => {
    expect(buildInversionAlerts(null)).toEqual([]);
  });

  it('returns empty for no inversion', () => {
    const profile: ThermalProfile = {
      hasInversion: false,
      status: 'normal' as ThermalProfile['status'],
      regression: null,
      stations: [],
    };
    expect(buildInversionAlerts(profile)).toEqual([]);
  });

  it('returns alert for strong inversion', () => {
    const profile: ThermalProfile = {
      hasInversion: true,
      status: 'strong-inversion',
      regression: {
        slopePerKm: 5.0,
        interceptC: 20,
        rSquared: 0.85,
        stationCount: 4,
      },
      stations: [],
    };
    const alerts = buildInversionAlerts(profile);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('high');
    expect(alerts[0].category).toBe('inversion');
    expect(alerts[0].title).toContain('FUERTE');
  });
});

// ── Thermal alerts ──────────────────────────────────────

describe('buildThermalAlerts', () => {
  it('returns empty for empty zones', () => {
    expect(buildThermalAlerts(new Map())).toEqual([]);
  });

  it('skips zones with alertLevel "none"', () => {
    const zones = new Map<MicroZoneId, ZoneAlert>();
    zones.set('carballiño' as MicroZoneId, {
      alertLevel: 'none',
      maxScore: 0,
      activeRules: [],
    } as ZoneAlert);
    expect(buildThermalAlerts(zones)).toEqual([]);
  });

  it('returns high alert for zone with high alert level', () => {
    const zones = new Map<MicroZoneId, ZoneAlert>();
    zones.set('ribadavia' as MicroZoneId, {
      alertLevel: 'high',
      maxScore: 75,
      activeRules: [{ id: 'r1' }, { id: 'r2' }],
    } as unknown as ZoneAlert);
    const alerts = buildThermalAlerts(zones);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('high');
    expect(alerts[0].score).toBe(75);
    expect(alerts[0].title).toContain('ALTO');
  });
});

// ── Composite risk ──────────────────────────────────────

describe('computeCompositeRisk', () => {
  it('returns zero risk for no alerts', () => {
    const risk = computeCompositeRisk([]);
    expect(risk.score).toBe(0);
    expect(risk.severity).toBe('info');
    expect(risk.color).toBe('green');
    expect(risk.activeCount).toBe(0);
  });

  it('returns critical for storm danger alert', () => {
    const alerts: UnifiedAlert[] = [{
      id: 'storm-main',
      category: 'storm',
      severity: 'critical',
      score: 95,
      icon: '⛈️',
      title: 'PELIGRO',
      detail: '5 km',
      urgent: true,
      updatedAt: new Date(),
    }];
    const risk = computeCompositeRisk(alerts);
    expect(risk.severity).toBe('critical');
    expect(risk.color).toBe('red');
    expect(risk.activeCount).toBe(1);
    expect(risk.score).toBeGreaterThanOrEqual(95);
  });

  it('counts only non-info alerts as active', () => {
    const alerts: UnifiedAlert[] = [
      {
        id: 'a1', category: 'thermal', severity: 'info', score: 10,
        icon: '', title: '', detail: '', urgent: false, updatedAt: new Date(),
      },
      {
        id: 'a2', category: 'frost', severity: 'high', score: 55,
        icon: '', title: '', detail: '', urgent: false, updatedAt: new Date(),
      },
    ];
    const risk = computeCompositeRisk(alerts);
    expect(risk.activeCount).toBe(1);
  });
});

// ── Aggregator ──────────────────────────────────────────

describe('aggregateAllAlerts', () => {
  it('returns sorted alerts with risk', () => {
    const storm: StormAlert = {
      level: 'danger', nearestKm: 3, recentCount: 20,
      trend: 'approaching', etaMinutes: 2, rings: [], updatedAt: new Date(),
    };
    const { alerts, risk } = aggregateAllAlerts({
      stormAlert: storm,
      thermalProfile: null,
      zoneAlerts: new Map(),
      fieldAlerts: null,
    });
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].category).toBe('storm');
    expect(risk.severity).toBe('critical');
  });

  it('handles null/empty sources gracefully', () => {
    const { alerts, risk } = aggregateAllAlerts({
      stormAlert: null,
      thermalProfile: null,
      zoneAlerts: new Map(),
      fieldAlerts: null,
    });
    expect(alerts).toEqual([]);
    expect(risk.score).toBe(0);
  });

  it('sorts alerts by score descending', () => {
    const zones = new Map<MicroZoneId, ZoneAlert>();
    zones.set('ribadavia' as MicroZoneId, {
      alertLevel: 'medium',
      maxScore: 45,
      activeRules: [{ id: 'r1' }],
    } as unknown as ZoneAlert);

    const storm: StormAlert = {
      level: 'watch', nearestKm: 40, recentCount: 2,
      trend: 'stable', rings: [], updatedAt: new Date(),
    };

    const { alerts } = aggregateAllAlerts({
      stormAlert: storm,
      thermalProfile: null,
      zoneAlerts: zones,
      fieldAlerts: null,
    });

    // Should be sorted descending
    for (let i = 1; i < alerts.length; i++) {
      expect(alerts[i - 1].score).toBeGreaterThanOrEqual(alerts[i].score);
    }
  });
});
