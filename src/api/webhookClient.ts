/**
 * Webhook client for n8n integration.
 *
 * Sends alert payloads to an n8n webhook endpoint for external processing
 * (Telegram bot, data persistence, etc.).
 *
 * Fails silently — webhook is non-critical for app functionality.
 */

import type { AlertSeverity, AlertCategory } from '../services/alertService';

// ── Configuration ────────────────────────────────────────

/** Base URL for webhook endpoints (nginx proxies to n8n) */
const WEBHOOK_BASE = '/api/webhook';

/** Default endpoint for alert notifications */
const ALERT_ENDPOINT = `${WEBHOOK_BASE}/meteomap-alert`;

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
  compositeRisk?: {
    score: number;
    severity: AlertSeverity;
    activeCount: number;
  };
}

// ── Webhook client ───────────────────────────────────────

/** Cooldown tracker to avoid spamming the webhook */
const webhookCooldowns = new Map<string, number>();
const WEBHOOK_COOLDOWN_MS = 10 * 60 * 1000; // 10 min per alert ID

/**
 * Post an alert to the n8n webhook endpoint.
 * Non-blocking, fails silently on any error.
 */
export async function postAlertWebhook(payload: WebhookAlertPayload): Promise<void> {
  try {
    // Skip webhook in development — no n8n server running
    if (import.meta.env.DEV) return;

    // Cooldown check
    const now = Date.now();
    const lastSent = webhookCooldowns.get(payload.alertId);
    if (lastSent && now - lastSent < WEBHOOK_COOLDOWN_MS) return;

    const response = await fetch(ALERT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      webhookCooldowns.set(payload.alertId, now);
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
