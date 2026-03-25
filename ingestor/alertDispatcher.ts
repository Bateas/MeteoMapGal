/**
 * Alert dispatcher for the ingestor.
 *
 * Manages cooldowns, night silence, and webhook delivery.
 * Posts to n8n webhook for Telegram forwarding.
 * Messages are concise, actionable, with local context per spot.
 */

import { log } from './logger.js';

// ── Config ──────────────────────────────────────────

const N8N_ALERT_WEBHOOK = process.env.N8N_ALERT_WEBHOOK || 'http://REDACTED_N8N_HOST:5678/webhook/meteomap-alert';
const SPOT_COOLDOWN_MS = 2 * 60 * 60_000; // 2 hours per spot
const FORECAST_COOLDOWN_MS = 6 * 60 * 60_000; // 6 hours for forecast signals
const NIGHT_START = 23;
const NIGHT_END = 7;

// ── Spot context (local knowledge) ──────────────────

interface SpotContext {
  /** Short name for messages */
  short: string;
  /** Wind direction notes — what matters locally */
  dirNotes: Record<string, string>;
  /** Default note when no special direction context */
  defaultNote: string;
}

const SPOT_CONTEXT: Record<string, SpotContext> = {
  castrelo: {
    short: 'Castrelo',
    dirNotes: {
      SW: 'Termico del valle',
      WSW: 'Termico del valle',
      W: 'Termico del valle',
      N: 'Componente norte',
      NE: 'Componente norte',
      NW: 'Componente norte',
    },
    defaultNote: '',
  },
  cesantes: {
    short: 'Cesantes',
    dirNotes: {
      SW: 'Virazon en la ensenada',
      WSW: 'Virazon en la ensenada',
      W: 'Virazon en la ensenada',
      NE: 'Bocana — viento del interior',
      E: 'Bocana — viento del interior',
      N: 'Norte — lleva hacia San Simon',
    },
    defaultNote: '',
  },
  lourido: {
    short: 'Lourido',
    dirNotes: {
      SW: 'Condiciones ideales kite/windsurf',
      WSW: 'Condiciones ideales kite/windsurf',
      NE: 'Componente norte',
      N: 'Componente norte',
      E: 'Viento de tierra',
    },
    defaultNote: '',
  },
  bocana: {
    short: 'Bocana',
    dirNotes: {
      NE: 'Bocana matutina — centro de la ria',
      E: 'Bocana matutina — centro de la ria',
      SW: 'Entrada atlantica',
    },
    defaultNote: '',
  },
  'centro-ria': {
    short: 'Ria Vigo',
    dirNotes: {
      SW: 'Virazon entrando por la ria',
      NE: 'Viento de tierra',
      N: 'Nortada — mar revuelta fuera',
    },
    defaultNote: '',
  },
  'cies-ria': {
    short: 'Cies',
    dirNotes: {
      N: 'Nortada — oleaje fuerte',
      NW: 'Mar de fondo atlantico',
      SW: 'Protegida de SW por las islas',
    },
    defaultNote: '',
  },
};

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

function getDirectionNote(spotId: string, cardinal: string): string {
  const ctx = SPOT_CONTEXT[spotId];
  if (!ctx) return '';
  return ctx.dirNotes[cardinal] || ctx.defaultNote;
}

function verdictEmoji(verdict: string): string {
  switch (verdict) {
    case 'NAVEGABLE': return '🟢';
    case 'BUENO': return '🟡';
    case 'FUERTE': return '🔴';
    default: return '⚪';
  }
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
 * Concise, actionable messages with local context.
 */
export async function dispatchSpotAlert(
  spotId: string,
  spotName: string,
  sector: string,
  verdict: string,
  windKt: number,
  direction: string,
  extras?: { waterTemp?: number; thermalProb?: number; gustKt?: number },
): Promise<void> {
  if (isNightTime()) return;
  if (isInCooldown(lastSpotAlert, spotId, SPOT_COOLDOWN_MS)) return;

  const ctx = SPOT_CONTEXT[spotId];
  const short = ctx?.short || spotName;
  const dirNote = getDirectionNote(spotId, direction);
  const emoji = verdictEmoji(verdict);

  // Build concise message (3 lines max)
  let msg = `${emoji} *${short}* ${verdict}\n`;
  msg += `${direction} ${windKt}kt`;
  if (extras?.gustKt && extras.gustKt > windKt) msg += ` (rachas ${extras.gustKt}kt)`;
  if (extras?.waterTemp) msg += ` · Agua ${extras.waterTemp.toFixed(0)}°C`;
  msg += '\n';
  if (dirNote) msg += dirNote;
  if (extras?.thermalProb && extras.thermalProb >= 40) {
    msg += (dirNote ? ' · ' : '') + `Termico ${extras.thermalProb}%`;
  }

  const ok = await postWebhook({
    type: 'spot-alert',
    spot: short,
    sector,
    verdict,
    windKt,
    direction,
    text: msg.trim(),
    severity: verdict === 'FUERTE' ? 'high' : 'moderate',
    title: `${short}: ${verdict}`,
    message: msg.trim(),
  });

  if (ok) {
    lastSpotAlert.set(spotId, Date.now());
    log.ok(`Alert: ${short} ${verdict} ${windKt}kt ${direction}`);
  }
}

/**
 * Dispatch a thermal forecast early warning.
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
    log.ok(`Forecast: ${label} (${sector})`);
  }
}

/**
 * Reset cooldowns (e.g., on restart).
 */
export function resetCooldowns(): void {
  lastSpotAlert.clear();
  lastForecastAlert.clear();
}
