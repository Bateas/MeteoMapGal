/**
 * Proactive spot alert service — sends Telegram notification when spots
 * transition to good sailing conditions.
 *
 * Detects verdict transitions (calm/light → sailing/good/strong) and posts
 * a one-liner to n8n webhook for Telegram forwarding.
 *
 * Cooldown: 1 alert per spot per 2 hours to avoid spam.
 * Night silence: inherits from webhookClient (23:00-07:00 only critical).
 * Non-critical: fails silently.
 */

import type { SpotScore, SpotVerdict } from './spotScoringEngine';
import { degreesToCardinal } from './windUtils';

// ── Configuration ──────────────────────────────────────

/** Verdicts that trigger an alert when transitioned TO */
const ALERT_VERDICTS: Set<SpotVerdict> = new Set(['sailing', 'good', 'strong']);

/** Verdicts considered "no wind" — transition FROM these triggers alert */
const LOW_VERDICTS: Set<SpotVerdict> = new Set(['calm', 'light', 'unknown']);

/** Cooldown per spot (2 hours) */
const SPOT_COOLDOWN_MS = 2 * 60 * 60 * 1000;

/** Webhook endpoint */
const WEBHOOK_BASE = '/api/webhook';
const SPOT_ALERT_ENDPOINT = `${WEBHOOK_BASE}/meteomap-alert`;

// ── State ──────────────────────────────────────────────

/** Previous verdict per spot — used to detect transitions */
const previousVerdicts = new Map<string, SpotVerdict>();

/** Last alert time per spot — cooldown tracker */
const lastAlertTimes = new Map<string, number>();

// ── Verdict label in Spanish ───────────────────────────

const VERDICT_LABEL: Record<SpotVerdict, string> = {
  calm: 'CALMA',
  light: 'FLOJO',
  sailing: 'NAVEGABLE',
  good: 'BUENO',
  strong: 'FUERTE',
  unknown: 'SIN DATOS',
};

// ── Core ───────────────────────────────────────────────

/**
 * Check spot scores for verdict transitions and send alerts.
 * Call this after every scoring cycle.
 */
export function checkSpotAlerts(scores: Map<string, SpotScore>, sectorName: string): void {
  // Skip in development
  if (import.meta.env.DEV) return;

  const now = Date.now();

  for (const [spotId, score] of scores) {
    const prev = previousVerdicts.get(spotId);
    const current = score.verdict;

    // Update previous verdict
    previousVerdicts.set(spotId, current);

    // Skip if no previous data (first cycle)
    if (prev === undefined) continue;

    // Check: transition from low → alert-worthy verdict
    if (!LOW_VERDICTS.has(prev) || !ALERT_VERDICTS.has(current)) continue;

    // Cooldown check
    const lastAlert = lastAlertTimes.get(spotId);
    if (lastAlert && now - lastAlert < SPOT_COOLDOWN_MS) continue;

    // Build and send alert
    const windKt = score.windSpeedMs != null
      ? Math.round(score.windSpeedMs * 1.94384)
      : 0;
    const dir = score.windDirDeg != null
      ? degreesToCardinal(score.windDirDeg)
      : '';

    const title = `${score.spotName} ${VERDICT_LABEL[current]} ${windKt}kt ${dir}`;
    const detail = score.summary;

    // Webhook to n8n → Telegram
    sendSpotAlert({
      alertId: `spot-${spotId}-${current}`,
      category: 'spot' as never,
      severity: current === 'strong' ? 'high' : 'moderate',
      title,
      detail,
      icon: current === 'strong' ? 'wind' : 'sailboat',
      score: score.score,
      sector: sectorName,
      timestamp: new Date().toISOString(),
    });

    // Browser push notification
    sendBrowserNotification(title, detail, spotId);

    lastAlertTimes.set(spotId, now);

    console.debug(`[SpotAlert] ${title}`);
  }
}

/**
 * Post spot alert to n8n webhook.
 * Reuses the same alert endpoint — n8n can filter by category='spot'.
 */
async function sendSpotAlert(payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch(SPOT_ALERT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Non-critical — fail silently
  }
}

/**
 * Send browser push notification for spot wind alert.
 * Uses Web Notification API — requires prior permission grant.
 */
function sendBrowserNotification(title: string, body: string, spotId: string): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  try {
    const notification = new Notification(`MeteoMapGal — ${title}`, {
      body,
      icon: '/favicon.ico',
      tag: `spot-${spotId}`, // Replace previous notification for same spot
      silent: false,
      requireInteraction: false,
    });

    // Auto-close after 10 seconds
    setTimeout(() => notification.close(), 10_000);
  } catch {
    // Notification API not available — fail silently
  }
}

/**
 * Reset state (useful on sector switch to avoid false transitions).
 */
export function resetSpotAlerts(): void {
  previousVerdicts.clear();
  lastAlertTimes.clear();
}
