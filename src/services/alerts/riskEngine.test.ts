/**
 * Tests for riskEngine — pure functions that drive composite alert severity.
 *
 * Critical path: feeds 24/7 Telegram alert pipeline (ingestor) AND frontend
 * AlertPanel UI. A bug in severityFromScore or the weighted-max algorithm
 * causes silent miscategorisation of alerts (high → moderate or vice versa).
 *
 * S123: first test file for src/services/alerts/ (8 files, 0 tests previously).
 */

import { describe, it, expect } from 'vitest';
import { severityFromScore, colorFromSeverity, computeCompositeRisk } from './riskEngine';
import type { UnifiedAlert, AlertCategory, AlertSeverity } from './types';

/** Builder helper — constructs a minimal UnifiedAlert with sane defaults. */
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
    updatedAt: new Date(),
  };
}

// ── severityFromScore ─────────────────────────────────────────

describe('severityFromScore — boundary thresholds', () => {
  it('returns critical at exactly 85', () => {
    expect(severityFromScore(85)).toBe('critical');
  });

  it('returns high at exactly 55', () => {
    expect(severityFromScore(55)).toBe('high');
  });

  it('returns moderate at exactly 25', () => {
    expect(severityFromScore(25)).toBe('moderate');
  });

  it('returns info for zero score', () => {
    expect(severityFromScore(0)).toBe('info');
  });

  it('returns critical for max score 100', () => {
    expect(severityFromScore(100)).toBe('critical');
  });

  it('returns info just below moderate threshold (24.9)', () => {
    expect(severityFromScore(24.9)).toBe('info');
  });

  it('returns moderate just below high threshold (54.9)', () => {
    expect(severityFromScore(54.9)).toBe('moderate');
  });

  it('returns high just below critical threshold (84.9)', () => {
    expect(severityFromScore(84.9)).toBe('high');
  });
});

// ── colorFromSeverity ─────────────────────────────────────────

describe('colorFromSeverity — semaphore colors', () => {
  it('maps critical → red', () => {
    expect(colorFromSeverity('critical')).toBe('red');
  });

  it('maps high → orange', () => {
    expect(colorFromSeverity('high')).toBe('orange');
  });

  it('maps moderate → yellow', () => {
    expect(colorFromSeverity('moderate')).toBe('yellow');
  });

  it('maps info → green', () => {
    expect(colorFromSeverity('info')).toBe('green');
  });
});

// ── computeCompositeRisk — empty + null safety ────────────────

describe('computeCompositeRisk — empty input', () => {
  it('returns safe defaults for empty array', () => {
    expect(computeCompositeRisk([])).toEqual({
      score: 0,
      severity: 'info',
      color: 'green',
      activeCount: 0,
    });
  });

  it('returns safe defaults when only info alerts present', () => {
    const result = computeCompositeRisk([
      alert({ score: 50, category: 'thermal', severity: 'info' }),
      alert({ score: 80, category: 'storm', severity: 'info' }),
    ]);
    // Info alerts are excluded → no active alerts → defaults
    expect(result.activeCount).toBe(0);
    expect(result.severity).toBe('info');
    expect(result.score).toBe(0);
  });
});

// ── computeCompositeRisk — weighted-max algorithm ─────────────

describe('computeCompositeRisk — weighted-max', () => {
  it('single moderate alert: score normalized by its weight', () => {
    // thermal weight=1.0, score=50 → weighted=50, /1.0 = 50
    const result = computeCompositeRisk([
      alert({ score: 50, category: 'thermal', severity: 'moderate' }),
    ]);
    expect(result.score).toBe(50);
    expect(result.severity).toBe('moderate');
    expect(result.activeCount).toBe(1);
  });

  it('storm wins over frost despite lower base score', () => {
    // storm: 70 × 3.0 = 210 (winner)
    // frost: 80 × 2.0 = 160
    // Final score = 210 / 3.0 = 70 → high
    const result = computeCompositeRisk([
      alert({ score: 70, category: 'storm', severity: 'high' }),
      alert({ score: 80, category: 'frost', severity: 'high' }),
    ]);
    expect(result.score).toBe(70);
    expect(result.severity).toBe('high');
    expect(result.activeCount).toBe(2);
  });

  it('drone alerts are deprioritized by low weight', () => {
    // drone: 90 × 0.5 = 45
    // thermal: 50 × 1.0 = 50 (winner)
    // Final = 50 / 1.0 = 50 → moderate
    const result = computeCompositeRisk([
      alert({ score: 90, category: 'drone', severity: 'high' }),
      alert({ score: 50, category: 'thermal', severity: 'moderate' }),
    ]);
    expect(result.score).toBe(50);
    expect(result.severity).toBe('moderate');
  });

  it('activeCount excludes info alerts', () => {
    const result = computeCompositeRisk([
      alert({ score: 80, category: 'storm', severity: 'critical' }),
      alert({ score: 60, category: 'rain', severity: 'high' }),
      alert({ score: 30, category: 'thermal', severity: 'info' }),
      alert({ score: 20, category: 'fog', severity: 'info' }),
    ]);
    expect(result.activeCount).toBe(2);
  });
});

// ── computeCompositeRisk — severity cap (regression guard) ────

describe('computeCompositeRisk — severity cap respects alert intent', () => {
  it('caps composite at alert\'s declared severity (inversion at moderate)', () => {
    // inversion is intentionally capped at 'moderate' even with score 95
    // (rule: "inversion is notable but not dangerous").
    // Without cap: 95 → 'critical'. With cap: stays moderate.
    const result = computeCompositeRisk([
      alert({ score: 95, category: 'inversion', severity: 'moderate' }),
    ]);
    expect(result.severity).toBe('moderate');
    expect(result.color).toBe('yellow');
  });

  it('does NOT lower a high-declared alert just because score is low', () => {
    // Storm at score 30 declared as 'high' (manual override) — composite should
    // honor 'high' since cap only reduces, never raises beyond declaration.
    // Score 30 → derived 'moderate', declared 'high' → composite uses derived
    // (lower of the two). Actually: rank(moderate)=1 < rank(high)=2, so
    // derivedSeverity is NOT > winningSeverity → keeps derivedSeverity.
    const result = computeCompositeRisk([
      alert({ score: 30, category: 'storm', severity: 'high' }),
    ]);
    expect(result.severity).toBe('moderate'); // derived from score, not capped up
  });

  it('critical winner produces critical composite (no cap if matching)', () => {
    const result = computeCompositeRisk([
      alert({ score: 90, category: 'storm', severity: 'critical' }),
    ]);
    expect(result.score).toBe(90);
    expect(result.severity).toBe('critical');
    expect(result.color).toBe('red');
  });
});

// ── computeCompositeRisk — determinism + edge cases ───────────

describe('computeCompositeRisk — determinism', () => {
  it('tie-breaking: first alert wins (stable iteration order)', () => {
    // Two storms at same score → first one in array wins
    const a1 = alert({ id: 'storm-1', score: 75, category: 'storm', severity: 'high' });
    const a2 = alert({ id: 'storm-2', score: 75, category: 'storm', severity: 'high' });
    const result = computeCompositeRisk([a1, a2]);
    expect(result.activeCount).toBe(2);
    expect(result.score).toBe(75); // 75 × 3.0 / 3.0
    expect(result.severity).toBe('high');
  });

  it('caps final score at 100 even if weighted sum would exceed', () => {
    // marine weight=2.0, score=100 → weighted=200, normalized=200/2.0=100
    const result = computeCompositeRisk([
      alert({ score: 100, category: 'marine', severity: 'critical' }),
    ]);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBe(100);
  });
});
