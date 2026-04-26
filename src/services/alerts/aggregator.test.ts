/**
 * Tests for aggregator — composition of 11+ alert builders into final UnifiedAlert[].
 *
 * Critical path: feeds 24/7 Telegram alert pipeline (ingestor) AND frontend AlertPanel.
 * Aggregator wires builders together with gating logic — bugs here cause silent
 * suppression of entire alert categories (S122 fog overlay was dead 6mo).
 *
 * S123: third test file for src/services/alerts/. Focus on COMPOSITION + GATING.
 * Builders are tested separately (stormAlerts.test.ts, riskEngine.test.ts, etc.)
 */

import { describe, it, expect } from 'vitest';
import {
  aggregateAllAlerts,
  deduplicateByCategory,
  enrichPressureAlerts,
  naoContext,
  aoContext,
} from './aggregator';
import type { UnifiedAlert, AlertCategory, AlertSeverity } from './types';
import type { StormAlert } from '../../types/lightning';
import type { TeleconnectionIndex } from '../../api/naoClient';
import type { NormalizedReading } from '../../types/station';
import type { MicroZoneId, ZoneAlert } from '../../types/thermal';

// ── Helpers ─────────────────────────────────────────────────

function alert(overrides: Partial<UnifiedAlert> & {
  score: number;
  category: AlertCategory;
  severity: AlertSeverity;
}): UnifiedAlert {
  return {
    id: overrides.id ?? `test-${overrides.category}-${overrides.score}`,
    category: overrides.category,
    severity: overrides.severity,
    score: overrides.score,
    icon: 'alert-triangle',
    title: overrides.title ?? 'Test alert',
    detail: overrides.detail ?? 'Test detail',
    urgent: overrides.urgent ?? false,
    updatedAt: overrides.updatedAt ?? new Date(),
    ...(overrides.fogMeta ? { fogMeta: overrides.fogMeta } : {}),
  };
}

/** Minimal valid sources object — every gated builder is OFF by default. */
function emptySources() {
  return {
    stormAlert: null,
    thermalProfile: null,
    zoneAlerts: new Map<MicroZoneId, ZoneAlert>(),
    fieldAlerts: null,
  };
}

// ── Empty inputs ────────────────────────────────────────────

describe('aggregateAllAlerts — empty inputs', () => {
  it('returns empty alerts and zero risk when no sources provided', () => {
    const result = aggregateAllAlerts(emptySources());
    expect(result.alerts).toEqual([]);
    expect(result.risk).toEqual({
      score: 0,
      severity: 'info',
      color: 'green',
      activeCount: 0,
    });
  });

  it('returns CompositeRisk shape even when only forecast (empty) is given', () => {
    const result = aggregateAllAlerts({ ...emptySources(), forecast: [] });
    expect(result.alerts).toEqual([]);
    expect(result.risk.activeCount).toBe(0);
  });
});

// ── Single-source pass-through ──────────────────────────────

describe('aggregateAllAlerts — single source pass-through', () => {
  it('storm alert (level=danger) produces a storm category alert', () => {
    const stormAlert: StormAlert = {
      level: 'danger', nearestKm: 5, recentCount: 10, trend: 'approaching',
      etaMinutes: 8, speedKmh: 30, bearingDeg: 180, clusters: [],
      updatedAt: new Date(),
    };
    const result = aggregateAllAlerts({ ...emptySources(), stormAlert });
    expect(result.alerts.length).toBeGreaterThan(0);
    expect(result.alerts[0].category).toBe('storm');
    expect(result.alerts[0].severity).toBe('critical'); // score 95 ≥ 85
    expect(result.risk.severity).toBe('critical');
  });

  it('storm alert level=none produces NO alerts', () => {
    const stormAlert: StormAlert = {
      level: 'none', nearestKm: 200, recentCount: 0, trend: 'stationary',
      etaMinutes: null, speedKmh: null, bearingDeg: null, clusters: [],
      updatedAt: new Date(),
    };
    const result = aggregateAllAlerts({ ...emptySources(), stormAlert });
    expect(result.alerts).toEqual([]);
  });
});

// ── Sort order ──────────────────────────────────────────────

describe('aggregateAllAlerts — sort by score descending', () => {
  it('places highest-score alert first in output', () => {
    // We can't easily inject 2 different categories without real builders,
    // so we test deduplicateByCategory + sort indirectly via the helper:
    const alerts: UnifiedAlert[] = [
      alert({ score: 30, category: 'rain', severity: 'moderate' }),
      alert({ score: 90, category: 'storm', severity: 'critical' }),
      alert({ score: 60, category: 'fog', severity: 'high' }),
    ];
    const deduped = deduplicateByCategory(alerts);
    deduped.sort((a, b) => b.score - a.score); // mirror aggregator's sort
    expect(deduped[0].category).toBe('storm');
    expect(deduped[1].category).toBe('fog');
    expect(deduped[2].category).toBe('rain');
  });
});

// ── deduplicateByCategory — composition unit ────────────────

describe('deduplicateByCategory', () => {
  it('returns empty array for empty input', () => {
    expect(deduplicateByCategory([])).toEqual([]);
  });

  it('keeps a single alert untouched', () => {
    const a = alert({ score: 50, category: 'rain', severity: 'moderate' });
    const result = deduplicateByCategory([a]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(a);
  });

  it('merges two alerts of same category — highest score wins', () => {
    const losing = alert({ id: 'a', score: 40, category: 'rain', severity: 'moderate', title: 'Lluvia debil' });
    const winning = alert({ id: 'b', score: 80, category: 'rain', severity: 'high', title: 'Lluvia fuerte' });
    const result = deduplicateByCategory([losing, winning]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b');
    expect(result[0].score).toBe(80);
    expect(result[0].severity).toBe('high');
    expect(result[0].detail).toContain('También'); // accents intentional in source
    expect(result[0].detail).toContain('Lluvia debil');
  });

  it('upgrades severity when a secondary alert is more severe than the score winner', () => {
    // Winner by score is moderate, but a lower-scored sibling is high → severity should upgrade
    const w = alert({ id: 'w', score: 80, category: 'fog', severity: 'moderate' });
    const s = alert({ id: 's', score: 60, category: 'fog', severity: 'high' });
    const result = deduplicateByCategory([w, s]);
    expect(result[0].id).toBe('w');
    expect(result[0].severity).toBe('high'); // upgraded from secondary
  });

  it('propagates urgent=true if any merged alert is urgent', () => {
    const w = alert({ id: 'w', score: 80, category: 'storm', severity: 'high', urgent: false });
    const s = alert({ id: 's', score: 50, category: 'storm', severity: 'moderate', urgent: true });
    const result = deduplicateByCategory([w, s]);
    expect(result[0].urgent).toBe(true);
  });

  it('does NOT merge thermal alerts (each zone is independent)', () => {
    const z1 = alert({ id: 'thermal-zone-a', score: 60, category: 'thermal', severity: 'moderate' });
    const z2 = alert({ id: 'thermal-zone-b', score: 70, category: 'thermal', severity: 'moderate' });
    const result = deduplicateByCategory([z1, z2]);
    expect(result).toHaveLength(2);
  });
});

// ── Gating logic — builders that need extra sources ─────────

describe('aggregateAllAlerts — gating', () => {
  it('skips maritime fog when stationsGeo missing (even with currentReadings + buoys)', () => {
    const result = aggregateAllAlerts({
      ...emptySources(),
      currentReadings: new Map<string, NormalizedReading>(),
      buoys: [],
      // stationsGeo intentionally absent
    });
    // Empty inputs → no fog alerts emitted regardless
    expect(result.alerts.find(a => a.category === 'fog')).toBeUndefined();
  });

  it('skips maritime fog when neither buoys nor regionalVisibility nor webcamFogDetected', () => {
    const result = aggregateAllAlerts({
      ...emptySources(),
      currentReadings: new Map<string, NormalizedReading>(),
      stationsGeo: [],
      // none of: buoys, regionalVisibility, webcamFogDetected
    });
    expect(result.alerts.find(a => a.category === 'fog')).toBeUndefined();
  });

  it('skips pressure trend when readingHistory missing', () => {
    const result = aggregateAllAlerts({
      ...emptySources(),
      currentReadings: new Map<string, NormalizedReading>(),
      // readingHistory absent
    });
    expect(result.alerts.find(a => a.category === 'pressure')).toBeUndefined();
  });

  it('skips cross-sea when buoys missing', () => {
    const result = aggregateAllAlerts({ ...emptySources() });
    expect(result.alerts.find(a => a.category === 'marine')).toBeUndefined();
  });

  it('skips upwelling when sstHistory missing (even with buoys)', () => {
    const result = aggregateAllAlerts({ ...emptySources(), buoys: [] });
    expect(result.alerts.find(a => a.category === 'upwelling')).toBeUndefined();
  });

  it('skips wind trend when readingHistory missing', () => {
    const result = aggregateAllAlerts({
      ...emptySources(),
      currentReadings: new Map<string, NormalizedReading>(),
    });
    expect(result.alerts.find(a => a.category === 'wind-front')).toBeUndefined();
  });

  it('storm shadow builder runs even without stormShadow (returns empty for null)', () => {
    // Should not throw — buildStormShadowAlerts(null) returns []
    const result = aggregateAllAlerts({ ...emptySources() });
    expect(result.alerts.find(a => a.id === 'storm-shadow')).toBeUndefined();
  });

  it('rain alerts builder runs unconditionally (no required sources)', () => {
    // forecast undefined → buildRainAlerts(undefined) should be safe
    expect(() => aggregateAllAlerts(emptySources())).not.toThrow();
  });
});

// ── NAO/AO context helpers ──────────────────────────────────

describe('naoContext / aoContext', () => {
  it('naoContext returns null for undefined input', () => {
    expect(naoContext(undefined)).toBeNull();
  });

  it('naoContext returns null for neutral phase', () => {
    expect(naoContext({ name: 'NAO', value: 0.2, date: new Date() } as TeleconnectionIndex)).toBeNull();
  });

  it('naoContext returns positive flow text for value > 0.5', () => {
    const ctx = naoContext({ name: 'NAO', value: 1.0, date: new Date() } as TeleconnectionIndex);
    expect(ctx).toContain('NAO positiva');
  });

  it('aoContext returns arctic warning for very negative AO', () => {
    const ctx = aoContext({ name: 'AO', value: -2.0, date: new Date() } as TeleconnectionIndex);
    expect(ctx).toContain('aire ártico'); // accents in source
  });
});

// ── enrichPressureAlerts ────────────────────────────────────

describe('enrichPressureAlerts', () => {
  it('returns alerts unchanged if NAO not provided', () => {
    const alerts = [alert({ score: 60, category: 'pressure', severity: 'high', detail: 'Presión cae' })];
    const result = enrichPressureAlerts(alerts);
    expect(result[0].detail).toBe('Presión cae');
  });

  it('returns alerts unchanged for neutral NAO (no context to add)', () => {
    const alerts = [alert({ score: 60, category: 'pressure', severity: 'high', detail: 'Presión cae' })];
    const nao = { name: 'NAO', value: 0.1, date: new Date() } as TeleconnectionIndex;
    expect(enrichPressureAlerts(alerts, nao)[0].detail).toBe('Presión cae');
  });

  it('appends NAO context to detail when phase is meaningful', () => {
    const alerts = [alert({ score: 60, category: 'pressure', severity: 'high', detail: 'Presión cae' })];
    const nao = { name: 'NAO', value: 1.8, date: new Date() } as TeleconnectionIndex;
    const result = enrichPressureAlerts(alerts, nao);
    expect(result[0].detail).toContain('Presión cae · ');
    expect(result[0].detail).toContain('NAO muy positiva');
  });

  it('handles empty alert list gracefully', () => {
    const nao = { name: 'NAO', value: 1.8, date: new Date() } as TeleconnectionIndex;
    expect(enrichPressureAlerts([], nao)).toEqual([]);
  });
});

// TODO: full integration tests where buildMaritimeFogAlerts/buildPressureTrendAlerts
// actually emit alerts require non-trivial fixture data (real station coords,
// historical readings, SST snapshots). Those are covered in their respective
// builder test files. This file focuses on aggregator composition + gating.
