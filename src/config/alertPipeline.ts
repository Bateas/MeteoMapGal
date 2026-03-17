/**
 * Alert Pipeline Configuration — single source of truth.
 *
 * These thresholds MUST stay in sync across the full pipeline:
 *   1. notificationService.ts → decides which alerts go to webhook
 *   2. webhookClient.ts → cooldowns + night silence
 *   3. n8n "Filtro Severidad1" → passes/blocks by severity
 *   4. Telegram bot → receives and displays
 *
 * ⚠️ When changing thresholds here, also update n8n Filtro Severidad1
 * (192.168.10.48:5678 → "MeteoMapGal Alertas → Telegram" workflow).
 *
 * History:
 *   S79: Discovered mismatch — code sent ≥high, n8n accepted ≥moderate.
 *   Fix: Code lowered to ≥moderate. n8n filter accepts moderate+high+critical.
 */
import type { AlertSeverity } from '../services/alertService';

// ── Webhook thresholds ─────────────────────────────────

/** Minimum severity to send alerts to n8n webhook.
 *  n8n Filtro Severidad1 must accept this level too. */
export const WEBHOOK_MIN_SEVERITY: AlertSeverity = 'moderate';

/** During night silence (23:00-07:00), only this severity passes through */
export const WEBHOOK_NIGHT_MIN_SEVERITY: AlertSeverity = 'critical';

// ── Browser notification thresholds ────────────────────

/** Minimum severity for browser push + sound (user can lower in settings) */
export const NOTIFICATION_DEFAULT_MIN_SEVERITY: AlertSeverity = 'critical';

// ── Cooldowns ──────────────────────────────────────────

/** Per-alert cooldown: don't re-send same alert ID within this window */
export const WEBHOOK_PER_ALERT_COOLDOWN_MS = 10 * 60 * 1000; // 10 min

/** Global cooldown: minimum gap between ANY webhook post */
export const WEBHOOK_GLOBAL_COOLDOWN_MS = 5 * 60 * 1000; // 5 min

/** Browser sound global cooldown */
export const NOTIFICATION_SOUND_COOLDOWN_MS = 10 * 60 * 1000; // 10 min

/** Browser notification per-alert cooldown */
export const NOTIFICATION_PER_ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 min

// ── Night silence ──────────────────────────────────────

/** Night silence start hour (local time) */
export const NIGHT_SILENCE_START = 23;

/** Night silence end hour (local time) */
export const NIGHT_SILENCE_END = 7;
