/**
 * Webhook client for n8n integration.
 *
 * Sends alert payloads to an n8n webhook endpoint for external processing
 * (Telegram bot, data persistence, etc.).
 *
 * Features:
 *   - Night silence (23:00-07:00): only critical alerts pass through
 *   - Per-alert cooldown (10 min) + global cooldown (5 min)
 *   - Daily summary endpoint for morning sailing briefing
 *
 * Fails silently — webhook is non-critical for app functionality.
 */

import type { AlertSeverity, AlertCategory } from '../services/alertService';

// ── Configuration ────────────────────────────────────────

/** Base URL for webhook endpoints (nginx proxies to n8n) */
const WEBHOOK_BASE = '/api/webhook';

/** Default endpoint for alert notifications */
const ALERT_ENDPOINT = `${WEBHOOK_BASE}/meteomap-alert`;

/** Endpoint for daily sailing summary */
const SUMMARY_ENDPOINT = `${WEBHOOK_BASE}/meteomap-summary`;

/** Night silence hours: 23:00 - 07:00 (only critical passes through) */
const NIGHT_START = 23;
const NIGHT_END = 7;

// ── Types ────────────────────────────────────────────────

export interface WebhookAlertPayload {
  alertId: string;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  detail: string;
  icon: string;
  score: number;
  sector: string;
  timestamp: string;
  /** Confidence 0-100 if available */
  confidence?: number;
  compositeRisk?: {
    score: number;
    severity: AlertSeverity;
    activeCount: number;
  };
}

export interface WebhookSummaryPayload {
  sector: string;
  timestamp: string;
  /** Current composite risk */
  risk: { score: number; severity: AlertSeverity; color: string; activeCount: number };
  /** Active alerts summary */
  alerts: { id: string; severity: AlertSeverity; title: string; detail: string }[];
  /** Best sailing window if available */
  sailing?: { spot: string; start: string; end: string; avgWindKt: number; verdict: string };
}

// ── Night silence check ─────────────────────────────────

function isNightSilence(): boolean {
  const hour = new Date().getHours();
  return hour >= NIGHT_START || hour < NIGHT_END;
}

// ── Webhook client ───────────────────────────────────────

/** Cooldown tracker to avoid spamming the webhook */
const webhookCooldowns = new Map<string, number>();
const WEBHOOK_COOLDOWN_MS = 10 * 60 * 1000; // 10 min per alert ID
/** Global cooldown — minimum 5 min between ANY webhook post */
let lastWebhookTime = 0;
const GLOBAL_WEBHOOK_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Post an alert to the n8n webhook endpoint.
 * Non-blocking, fails silently on any error.
 *
 * Night silence (23:00-07:00): only critical alerts are sent.
 */
export async function postAlertWebhook(payload: WebhookAlertPayload): Promise<void> {
  try {
    // Skip webhook in development — no n8n server running
    if (import.meta.env.DEV) return;

    // Night silence: only critical alerts pass through
    if (isNightSilence() && payload.severity !== 'critical') return;

    const now = Date.now();

    // Global cooldown
    if (now - lastWebhookTime < GLOBAL_WEBHOOK_COOLDOWN_MS) return;

    // Per-alert cooldown check
    const lastSent = webhookCooldowns.get(payload.alertId);
    if (lastSent && now - lastSent < WEBHOOK_COOLDOWN_MS) return;

    const response = await fetch(ALERT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      webhookCooldowns.set(payload.alertId, now);
      lastWebhookTime = now;
    }

    // Prune old cooldowns
    if (webhookCooldowns.size > 30) {
      const cutoff = now - WEBHOOK_COOLDOWN_MS * 2;
      for (const [id, time] of webhookCooldowns) {
        if (time < cutoff) webhookCooldowns.delete(id);
      }
    }
  } catch {
    // Webhook failure is non-critical — silently ignore
  }
}

/**
 * Post a daily sailing summary to n8n.
 * Called once per day (morning) — n8n workflow forwards to Telegram.
 */
export async function postSailingSummary(payload: WebhookSummaryPayload): Promise<void> {
  try {
    if (import.meta.env.DEV) return;

    await fetch(SUMMARY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Webhook failure is non-critical — silently ignore
  }
}
