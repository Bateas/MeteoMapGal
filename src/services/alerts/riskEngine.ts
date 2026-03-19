/**
 * Risk engine — severity/color conversion and composite risk calculation.
 *
 * The composite risk index uses weighted-max: the highest (score x weight)
 * determines overall risk. Weights amplify dangerous categories (storm x3.0)
 * and suppress low-impact ones (drone x0.5).
 */

import type { AlertSeverity, CompositeRisk, UnifiedAlert } from './types';
import { CATEGORY_WEIGHT } from './types';

// ── Conversion helpers ───────────────────────────────────────

export function severityFromScore(score: number): AlertSeverity {
  // Thresholds calibrated so "PELIGRO" (critical) is reserved for truly dangerous
  // situations: confirmed storms, severe frost, extreme wind — NOT for dense clouds
  // or light rain forecasts. Most common weather events stay at moderate/high.
  if (score >= 85) return 'critical';
  if (score >= 55) return 'high';
  if (score >= 25) return 'moderate';
  return 'info';
}

export function colorFromSeverity(severity: AlertSeverity): 'green' | 'yellow' | 'orange' | 'red' {
  switch (severity) {
    case 'critical': return 'red';
    case 'high':     return 'orange';
    case 'moderate': return 'yellow';
    default:         return 'green';
  }
}

// ── Composite risk index ─────────────────────────────────────

/**
 * Compute composite risk from all active alerts.
 *
 * Uses weighted-max: the highest (score x weight) determines overall risk.
 * Weights amplify dangerous categories (storm x3.0) and suppress low-impact
 * ones (drone x0.5). The final score is normalized by dividing by the
 * HIGHEST weight among active alerts, so the weight hierarchy is preserved.
 */
export function computeCompositeRisk(alerts: UnifiedAlert[]): CompositeRisk {
  if (alerts.length === 0) {
    return { score: 0, severity: 'info', color: 'green', activeCount: 0 };
  }

  // Weighted max: the highest (score x weight) determines overall risk
  let maxWeightedScore = 0;
  let maxWeight = 1;
  let activeCount = 0;

  for (const a of alerts) {
    if (a.severity !== 'info') activeCount++;
    const weight = CATEGORY_WEIGHT[a.category] ?? 1;
    const weighted = a.score * weight;
    if (weighted > maxWeightedScore) {
      maxWeightedScore = weighted;
      maxWeight = weight;
    }
  }

  // Normalize by the winning alert's own weight -> preserves its raw score,
  // while alerts from lighter categories get scaled down proportionally
  // when they compete via maxWeightedScore.
  const finalScore = Math.min(100, Math.round(maxWeightedScore / maxWeight));
  const severity = severityFromScore(finalScore);

  return {
    score: finalScore,
    severity,
    color: colorFromSeverity(severity),
    activeCount,
  };
}
