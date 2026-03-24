/**
 * Alert dispatcher for the ingestor.
 *
 * Manages cooldowns, night silence, and webhook delivery.
 * Posts to n8n webhook for Telegram forwarding.
 */

import { log } from './logger.js';

// ── Config ──────────────────────────────────────────

const N8N_ALERT_WEBHOOK = process.env.N8N_ALERT_WEBHOOK || 'http://REDACTED_N8N_HOST:5678/webhook/meteomap-alert';
const SPOT_COOLDOWN_MS = 2 * 60 * 60_000; // 2 hours per spot
const FORECAST_COOLDOWN_MS = 6 * 60 * 60_000; // 6 hours for forecast signals
const NIGHT_START = 23;
const NIGHT_END = 7;

// ── State ───────────────────────────────────────────

const lastSpotAlert = new Map<string, number>();
const lastForecastAlert = new Map<string, number>();

// ── Helpers ─────────────────────────────────────────

function isNightTime(): boolean {
  const h = new Date().getHours();
  return h >= NIGHT_START || h < NIGHT_END;
}

function isInCooldown(map: Map<string, number>, key: string, cooldownMs: number): boolean {
  const last = map.get(key);
  if (!last) return false;
  return (Date.now() - last) < cooldownMs;
}

async function postWebhook(payload: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(N8N_ALERT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch (err) {
    log.warn(`Webhook failed: ${(err as Error).message}`);
    return false;
  }
}

// ── Public API ──────────────────────────────────────

/**
 * Dispatch a spot verdict transition alert.
 * Respects cooldown + night silence.
 */
export async function dispatchSpotAlert(
  spotId: string,
  spotName: string,
  sector: string,
  verdict: string,
  windKt: number,
  direction: string,
): Promise<void> {
  if (isNightTime()) return;
  if (isInCooldown(lastSpotAlert, spotId, SPOT_COOLDOWN_MS)) return;

  const text = `${spotName}: ${verdict} ${windKt}kt ${direction} (${sector})`;

  const ok = await postWebhook({
    type: 'spot-alert',
    spot: spotName,
    sector,
    verdict,
    windKt,
    direction,
    text,
    severity: verdict === 'FUERTE' ? 'high' : 'moderate',
    title: `${spotName}: ${verdict}`,
    message: `${windKt}kt ${direction}`,
  });

  if (ok) {
    lastSpotAlert.set(spotId, Date.now());
    log.ok(`Alert sent: ${text}`);
  }
}

/**
 * Dispatch a thermal forecast early warning.
 * Respects 6h cooldown + night silence.
 */
export async function dispatchForecastAlert(
  sector: string,
  label: string,
  confidence: string,
): Promise<void> {
  if (isNightTime()) return;
  if (isInCooldown(lastForecastAlert, sector, FORECAST_COOLDOWN_MS)) return;

  const ok = await postWebhook({
    type: 'thermal-forecast',
    sector,
    text: label,
    severity: 'info',
    title: `Prevision ${sector}`,
    message: label,
  });

  if (ok) {
    lastForecastAlert.set(sector, Date.now());
    log.ok(`Forecast alert sent: ${label} (${sector})`);
  }
}

/**
 * Reset cooldowns (e.g., on sector change or restart).
 */
export function resetCooldowns(): void {
  lastSpotAlert.clear();
  lastForecastAlert.clear();
}
