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
 *   - n8n health check (non-blocking)
 *
 * Thresholds defined in src/config/alertPipeline.ts (single source of truth).
 * Fails silently — webhook is non-critical for app functionality.
 */

import type { AlertSeverity, AlertCategory } from '../services/alertService';
import {
  WEBHOOK_PER_ALERT_COOLDOWN_MS,
  WEBHOOK_GLOBAL_COOLDOWN_MS,
  NIGHT_SILENCE_START,
  NIGHT_SILENCE_END,
} from '../config/alertPipeline';

// ── Configuration ────────────────────────────────────────

/** Base URL for webhook endpoints (nginx proxies to n8n) */
const WEBHOOK_BASE = '/api/webhook';

/** Default endpoint for alert notifications */
const ALERT_ENDPOINT = `${WEBHOOK_BASE}/meteomap-alert`;

/** Endpoint for daily sailing summary */
const SUMMARY_ENDPOINT = `${WEBHOOK_BASE}/meteomap-summary`;

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
  /** Spot verdicts summary */
  spots?: string[];
  /** Environmental data from buoys */
  environment?: { humidity?: number; waterTemp?: number; airTemp?: number };
  /** Day forecast summary from Open-Meteo */
  forecast?: { tempMax: number; tempMin: number; maxWindKt: number; rainMm: number; rainProb: number };
  /** Thermal forecast early warning (BETA) */
  thermalForecast?: string;
}

// ── Night silence check ─────────────────────────────────

function isNightSilence(): boolean {
  const hour = new Date().getHours();
  return hour >= NIGHT_SILENCE_START || hour < NIGHT_SILENCE_END;
}

// ── n8n health check ────────────────────────────────────

let lastHealthCheck = 0;
let n8nHealthy = true;
const HEALTH_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 min

/**
 * Non-blocking n8n health check. Logs warning if n8n is unreachable.
 * Called before sending webhooks — skips if n8n was recently unhealthy.
 */
async function checkN8nHealth(): Promise<boolean> {
  if (import.meta.env.DEV) return true;

  const now = Date.now();
  if (now - lastHealthCheck < HEALTH_CHECK_INTERVAL_MS) return n8nHealthy;

  lastHealthCheck = now;
  try {
    const res = await fetch(`${WEBHOOK_BASE}/meteomap-alert`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5_000),
    });
    // n8n returns 404 for HEAD but the connection succeeds = n8n is up
    n8nHealthy = res.status < 500;
    if (!n8nHealthy) {
      console.warn(`[Webhook] n8n unhealthy (status ${res.status})`);
    }
  } catch {
    n8nHealthy = false;
    console.warn('[Webhook] n8n unreachable — Telegram alerts will not be delivered');
  }
  return n8nHealthy;
}

/** Check if n8n is currently considered healthy */
export function isN8nHealthy(): boolean {
  return n8nHealthy;
}

// ── Webhook client ───────────────────────────────────────

/** Cooldown tracker to avoid spamming the webhook */
const webhookCooldowns = new Map<string, number>();
/** Global cooldown — minimum gap between ANY webhook post */
let lastWebhookTime = 0;

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

    // Info alerts are informational — never send to Telegram
    if (payload.severity === 'info') return;

    // Night silence: only critical alerts pass through
    if (isNightSilence() && payload.severity !== 'critical') return;

    // Skip if n8n was recently unhealthy (non-blocking check)
    if (!await checkN8nHealth()) return;

    const now = Date.now();

    // Global cooldown
    if (now - lastWebhookTime < WEBHOOK_GLOBAL_COOLDOWN_MS) return;

    // Per-alert cooldown check
    const lastSent = webhookCooldowns.get(payload.alertId);
    if (lastSent && now - lastSent < WEBHOOK_PER_ALERT_COOLDOWN_MS) return;

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
      const cutoff = now - WEBHOOK_PER_ALERT_COOLDOWN_MS * 2;
      for (const [id, time] of webhookCooldowns) {
        if (time < cutoff) webhookCooldowns.delete(id);
      }
    }
  } catch {
    // Webhook failure is non-critical — silently ignore
  }
}

// ── Feedback endpoint ───────────────────────────────────

/** Endpoint for user feedback */
const FEEDBACK_ENDPOINT = `${WEBHOOK_BASE}/meteomap-feedback`;

export interface WebhookFeedbackPayload {
  category: string;
  message: string;
  email?: string;
  sector: string;
  timestamp: string;
}

/**
 * Post user feedback to n8n.
 * n8n workflow forwards to Telegram channel for review.
 * Throws on network error so caller can show error toast.
 */
export async function postFeedbackWebhook(payload: WebhookFeedbackPayload): Promise<void> {
  // Allow in dev for testing the form UX (n8n won't receive it)
  const res = await fetch(FEEDBACK_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Webhook error ${res.status}`);
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
