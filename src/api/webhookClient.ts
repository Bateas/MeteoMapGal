/**
 * Webhook client for the feedback form: the message goes to our n8n, which forwards it to the team's
 * Telegram for review. Spot and weather alerts are sent by the server around the clock (ingestor
 * alertDispatcher and dailySummary), not from the browser.
 */

/** Base URL for webhook endpoints (the web server passes them to n8n) */
const WEBHOOK_BASE = '/api/webhook';

import type { FeedbackType } from '../services/feedbackSanitize';

export interface WebhookFeedbackPayload {
  type: FeedbackType;
  text: string;
  sector: string;
  timestamp: string;
  /** App version for bug tracking (auto-injected by FeedbackModal) */
  version: string;
  /** Honeypot — should be empty for real users */
  website?: string;
}

/**
 * Post user feedback to n8n.
 * n8n workflow forwards to Telegram channel for review.
 * Throws on network error so caller can show error toast.
 */
export async function postFeedbackWebhook(payload: WebhookFeedbackPayload): Promise<void> {
  const res = await fetch(`${WEBHOOK_BASE}/meteomap-feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Webhook error ${res.status}`);
}
