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
  _confidence: string,
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

// ── Visibility / Fog alerts ──────────────────────────

const VISIBILITY_COOLDOWN_MS = 4 * 60 * 60_000; // 4 hours
const lastVisibilityAlert = new Map<string, number>();

/**
 * Dispatch a fog/visibility alert from webcam vision analysis.
 * Only fires for actual fog (not haze) — see webcamAnalyzer.ts fog regex.
 */
export async function dispatchVisibilityAlert(
  webcamId: string,
  spotId: string,
  _description: string,
  webcamName?: string,
): Promise<void> {
  if (isNightTime()) return;
  if (isInCooldown(lastVisibilityAlert, webcamId, VISIBILITY_COOLDOWN_MS)) return;

  const camLabel = webcamName ?? webcamId;

  const ok = await postWebhook({
    type: 'visibility-alert',
    spot: spotId,
    sector: 'Rias Baixas',
    text: `Niebla en ${camLabel}`,
    severity: 'moderate',
    title: `Niebla detectada — ${camLabel}`,
    message: `Webcam ${camLabel}: niebla real detectada por Vision IA — visibilidad pobre.`,
  });

  if (ok) {
    lastVisibilityAlert.set(webcamId, Date.now());
    log.ok(`Visibility alert: ${webcamId} (${camLabel}) → fog detected`);
  }
}

// ── Magic Window alerts (T2-2 S136+3+3) ───────────────

/** Magic window alerts are RARE by design — 6h cooldown prevents spam
 *  during sustained windows where score oscillates around threshold. */
const MAGIC_WINDOW_COOLDOWN_MS = 6 * 60 * 60_000;
const lastMagicWindowAlert = new Map<string, number>();

/**
 * Dispatch a "Magic Window" detection — rare optimal-sailing convergence.
 *
 * Distinct from spot verdict transitions: this is a SECTOR-WIDE alert
 * indicating that synoptic + thermal + canalization aligned, so MULTIPLE
 * spots will become favorable in the next 1-6h. Tone: "no te lo pierdas".
 */
export async function dispatchMagicWindowAlert(
  sector: string,
  score: number,
  summary: string,
  estimatedHours: number,
): Promise<void> {
  if (isNightTime()) return;
  if (isInCooldown(lastMagicWindowAlert, sector, MAGIC_WINDOW_COOLDOWN_MS)) return;

  // Tone scales with score
  const title = score >= 90
    ? `Ventana MAGICA — ${sector}`
    : `Ventana favorable — ${sector}`;
  const text = `${summary} (estimacion ${estimatedHours}h)`;

  const ok = await postWebhook({
    type: 'magic-window',
    sector,
    score,
    estimatedHours,
    title,
    message: text,
    severity: score >= 90 ? 'high' : 'moderate',
  });

  if (ok) {
    lastMagicWindowAlert.set(sector, Date.now());
    log.ok(`Magic window: ${sector} score=${score} → alert sent`);
  }
}

// ── Lightning proximity alerts (LOCAL safety) ─────────

/** 45min per sector — a storm parked over the ría would otherwise re-alert
 *  every 5min cycle. Escalation (aviso → peligro) bypasses the cooldown. */
const LIGHTNING_COOLDOWN_MS = 45 * 60_000;

type LightningAlertLevel = 'aviso' | 'peligro';
const LIGHTNING_RANK: Record<LightningAlertLevel, number> = { aviso: 1, peligro: 2 };
const lastLightningAlert = new Map<string, { at: number; level: LightningAlertLevel }>();

/**
 * Dispatch a per-spot lightning proximity alert, one message per sector with
 * the affected spots as lines ("Cesantes: rayo a 6km (5 en 20min)").
 *
 * PELIGRO is the one alert allowed through night silence: confirmed strikes
 * within 10km of a spot are a safety call, not a convenience ping — and the
 * corroboration rules upstream make it rare. AVISO stays silent at night
 * like every other alert.
 */
export async function dispatchLightningAlert(
  sector: string,
  level: LightningAlertLevel,
  spotLines: string[],
): Promise<void> {
  if (level === 'aviso' && isNightTime()) return;

  const prev = lastLightningAlert.get(sector);
  if (prev && (Date.now() - prev.at) < LIGHTNING_COOLDOWN_MS
      && LIGHTNING_RANK[level] <= LIGHTNING_RANK[prev.level]) {
    return;
  }

  const title = level === 'peligro'
    ? `RAYOS CERCA — ${sector}`
    : `Actividad electrica — ${sector}`;
  const advice = level === 'peligro'
    ? 'Fuera del agua: refugio cerrado o coche.'
    : 'Vigila el radar antes de salir.';
  const emoji = level === 'peligro' ? '⚡🔴' : '⚡🟡';
  const msg = `${emoji} *${title}*\n${spotLines.join('\n')}\n${advice}`;

  const ok = await postWebhook({
    type: 'lightning-proximity',
    sector,
    level,
    text: msg,
    severity: level === 'peligro' ? 'high' : 'moderate',
    title,
    message: msg,
  });

  if (ok) {
    lastLightningAlert.set(sector, { at: Date.now(), level });
    log.ok(`Lightning alert: ${sector} ${level.toUpperCase()} — ${spotLines.length} spot(s)`);
  }
}

// ── Fire watch alerts (dry lightning vigilance) ───────

/** 12h per zone — matches the 7-18h ignition window. One heads-up per zone
 *  per episode is enough; once a hotspot is confirmed, FIRMS takes over. */
const FIRE_WATCH_COOLDOWN_MS = 12 * 60 * 60_000;
const lastFireWatchAlert = new Map<string, number>();

/**
 * Dispatch a dry-lightning fire-watch alert for a zone.
 *
 * This is NOT immediate personal safety (the storm already passed) — it can
 * wait until 7 AM, so normal night silence applies. The caller re-invokes
 * every cycle for zones still in watch; the cooldown here only arms after a
 * successful send, so a zone detected overnight alerts on the first morning
 * cycle without extra bookkeeping upstream.
 *
 * @returns true if the webhook was actually delivered.
 */
export async function dispatchFireWatchAlert(
  zoneId: string,
  lat: number,
  lon: number,
  strikeCount: number,
  maxKa: number,
  nearestTown?: string,
): Promise<boolean> {
  if (isNightTime()) return false;
  if (isInCooldown(lastFireWatchAlert, zoneId, FIRE_WATCH_COOLDOWN_MS)) return false;

  const where = nearestTown
    ? `cerca de ${nearestTown}`
    : `zona aproximada ${lat.toFixed(2)},${lon.toFixed(2)}`;
  const rayos = strikeCount === 1
    ? '1 rayo a tierra sin lluvia'
    : `${strikeCount} rayos a tierra sin lluvia`;
  let msg = `Vigilancia incendio — ${rayos} (${where}).`;
  if (maxKa >= 30) msg += ` Corriente alta ${Math.round(maxKa)}kA.`;
  msg += ' Ventana tipica 7-18h.';

  const ok = await postWebhook({
    type: 'fire-watch',
    zone: zoneId,
    lat,
    lon,
    strikeCount,
    maxKa: Math.round(maxKa),
    text: msg,
    severity: 'moderate',
    title: `Vigilancia incendio — ${nearestTown ?? zoneId}`,
    message: msg,
  });

  if (ok) {
    lastFireWatchAlert.set(zoneId, Date.now());
    log.ok(`Fire watch alert: ${zoneId} — ${strikeCount} dry strike(s), max ${Math.round(maxKa)}kA`);
  }
  return ok;
}

/**
 * Reset cooldowns (e.g., on restart).
 */
export function resetCooldowns(): void {
  lastSpotAlert.clear();
  lastForecastAlert.clear();
  lastVisibilityAlert.clear();
  lastMagicWindowAlert.clear();
  lastLightningAlert.clear();
  lastFireWatchAlert.clear();
}
