/**
 * Alert dispatcher for the ingestor.
 *
 * Manages cooldowns, night silence, and webhook delivery.
 * Posts to n8n webhook for Telegram forwarding.
 * Messages are concise, actionable, with local context per spot.
 */

import { log } from './logger.js';
import {
  alertedZoneKey, parseAlertedZoneKey, fireWatchDigestText, ALERT_COOLDOWN_MS, DIGEST_MIN_GAP_MS,
  type AlertedZone, type DigestZone,
} from './fireWatchLogic.js';

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

/** Content-Type plus the shared secret the automation backend checks when
 *  N8N_WEBHOOK_SECRET is set (Header Auth on the webhook node). Without it the
 *  hooks accept anything that can reach them. */
function webhookHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (secret) h['X-Webhook-Secret'] = secret;
  return h;
}

/**
 * The full text of every message that reached the webhook, one line each, so what went out
 * can be judged afterwards against the readings. On 29-sep the only trace of a spot alert was
 * «Alert: Cies NAVEGABLE 11kt S», and of the daily summary, that it had been sent.
 * Service logs are kept a year.
 */
export function logSent(type: string, text: unknown): void {
  log.info(`Telegram enviado [${type}]: ${JSON.stringify(typeof text === 'string' ? text : '')}`);
}

/** One accepted send, as stored (sentAlerts.ts). `key` is the cooldown identity, e.g.
 *  `spot:cies-ria`, `wind:rias`; `level` the alert level where it has one, else its severity. */
export interface SentRecord { key: string; type: string; level: string; title: string; message: string; sector: string | null }

let recorder: ((r: SentRecord) => Promise<void>) | null = null;

/** Where accepted sends are stored. Set once at startup; without it nothing is stored. */
export function setSendRecorder(fn: ((r: SentRecord) => Promise<void>) | null): void {
  recorder = fn;
}

/** Log and store one accepted send. Storing never blocks nor fails the send. */
export function noteSent(r: SentRecord): void {
  logSent(r.type, r.message);
  if (recorder) {
    recorder(r).catch((err) => log.warn(`Send not stored (${r.key}): ${(err as Error).message}`));
  }
}

async function postWebhook(payload: Record<string, unknown>, key: string): Promise<boolean> {
  try {
    const res = await fetch(N8N_ALERT_WEBHOOK, {
      method: 'POST',
      headers: webhookHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // A non-2xx means n8n took the request and refused it: workflow
      // disabled, path renamed, Telegram node erroring. Every caller does
      // `if (ok) { set cooldown; log }` with no else, so without this line a
      // dead webhook is indistinguishable from "nothing to report" — EVERY
      // alert, including the lightning danger one, goes silent forever.
      log.warn(`Webhook rejected: HTTP ${res.status} (type=${payload.type ?? '?'}) — alert NOT delivered`);
    } else {
      const text = payload.message ?? payload.text;
      noteSent({
        key,
        type: String(payload.type ?? '?'),
        level: String(payload.level ?? payload.severity ?? ''),
        title: String(payload.title ?? ''),
        message: typeof text === 'string' ? text : '',
        sector: typeof payload.sector === 'string' ? payload.sector : null,
      });
    }
    return res.ok;
  } catch (err) {
    log.warn(`Webhook failed: ${(err as Error).message} (type=${payload.type ?? '?'}) — alert NOT delivered`);
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
  }, `spot:${spotId}`);

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
  }, `forecast:${sector}`);

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
  }, `visibility:${webcamId}`);

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
  }, `magic:${sector}`);

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
  }, `lightning:${sector}`);

  if (ok) {
    lastLightningAlert.set(sector, { at: Date.now(), level });
    log.ok(`Lightning alert: ${sector} ${level.toUpperCase()} — ${spotLines.length} spot(s)`);
  }
}

// ── Strong wind alerts (SAFETY, measured gusts) ───────

/**
 * Dispatch a strong-wind safety alert for a sector (windSafetyLogic.ts decides when).
 * Night silence applies to both levels: nobody is launching at 3 AM, and the caller re-invokes
 * every cycle, so an episode still going on at 7 AM is announced then.
 *
 * @returns true if the webhook was actually delivered.
 */
export async function dispatchWindSafetyAlert(
  sector: string,
  level: 'aviso' | 'peligro',
  title: string,
  message: string,
): Promise<boolean> {
  if (isNightTime()) return false;
  const ok = await postWebhook({
    type: 'wind-safety',
    sector,
    level,
    text: message,
    severity: level === 'peligro' ? 'high' : 'moderate',
    title,
    message,
  }, `wind:${sector}`);
  if (ok) log.ok(`Wind safety alert: ${sector} ${level.toUpperCase()}`);
  return ok;
}

// ── Fire watch alerts (dry lightning vigilance) ───────

/** When each announced zone (alertedZoneKey) last went out. One message covers
 *  several zones and is stored as `fire:<key>;<key>...`; seedCooldowns restores each. */
const lastFireWatchAlert = new Map<string, number>();

/** The zones announced in the last ALERT_COOLDOWN_MS (the input of freshZones). */
export function fireWatchAlertedZones(nowMs = Date.now()): AlertedZone[] {
  const out: AlertedZone[] = [];
  for (const [key, atMs] of lastFireWatchAlert) {
    if (nowMs - atMs >= ALERT_COOLDOWN_MS) continue;
    const c = parseAlertedZoneKey(key);
    if (c) out.push({ lat: c.lat, lon: c.lon, atMs });
  }
  return out;
}

/**
 * Dispatch ONE dry-lightning fire-watch message with the zones not announced yet.
 *
 * Not immediate personal safety (the storm already passed): it waits for the
 * end of the night silence, and goes out at most once every DIGEST_MIN_GAP_MS.
 * The caller offers the new zones every cycle; they are marked as announced
 * only after a successful send, so the ones held back go in the next message.
 *
 * @returns true if the webhook was actually delivered.
 */
export async function dispatchFireWatchDigest(zones: DigestZone[], nowMs = Date.now()): Promise<boolean> {
  if (zones.length === 0 || isNightTime()) return false;
  let last = 0;
  for (const at of lastFireWatchAlert.values()) last = Math.max(last, at);
  if (nowMs - last < DIGEST_MIN_GAP_MS) return false;

  const keys = zones.map((z) => alertedZoneKey(z));
  const top = [...zones].sort((a, b) => b.strikeCount - a.strikeCount)[0];
  const text = fireWatchDigestText(zones);
  const strikes = zones.reduce((sum, z) => sum + z.strikeCount, 0);
  const maxKa = zones.reduce((m, z) => Math.max(m, z.maxAbsKa), 0);
  const ok = await postWebhook({
    type: 'fire-watch',
    zone: keys.join(';'),
    lat: top.lat,
    lon: top.lon,
    strikeCount: strikes,
    maxKa: Math.round(maxKa),
    text,
    severity: 'moderate',
    title: zones.length === 1 ? `Vigilancia incendio — ${top.near ?? keys[0]}` : `Vigilancia incendio — ${zones.length} zonas`,
    message: text,
  }, `fire:${keys.join(';')}`);

  if (ok) {
    for (const k of keys) lastFireWatchAlert.set(k, nowMs);
    log.ok(`Fire watch alert: ${zones.length} zone(s), ${strikes} dry strike(s), max ${Math.round(maxKa)}kA — ${keys.join(' ')}`);
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

/** A stored send: its cooldown key, when it went out and its level (sentAlerts.ts). */
export interface PastSend { key: string; atMs: number; level: string }

/**
 * Restore the cooldowns from the sends actually made, at startup. They live in memory, so every
 * restart used to forget them: on 29-sep three deploys in forty minutes resent the same thermal
 * forecast three times. Returns how many cooldowns were restored.
 */
export function seedCooldowns(sends: PastSend[]): number {
  let n = 0;
  for (const s of sends) {
    const i = s.key.indexOf(':');
    if (i < 0) continue;
    const kind = s.key.slice(0, i), id = s.key.slice(i + 1);
    const later = (m: Map<string, number>, k = id) => { if ((m.get(k) ?? 0) < s.atMs) { m.set(k, s.atMs); n++; } };
    if (kind === 'spot') later(lastSpotAlert);
    else if (kind === 'forecast') later(lastForecastAlert);
    else if (kind === 'visibility') later(lastVisibilityAlert);
    else if (kind === 'magic') later(lastMagicWindowAlert);
    else if (kind === 'fire') for (const zone of id.split(';')) later(lastFireWatchAlert, zone);
    else if (kind === 'lightning' && (s.level === 'aviso' || s.level === 'peligro')) {
      const cur = lastLightningAlert.get(id);
      if (!cur || cur.at < s.atMs) { lastLightningAlert.set(id, { at: s.atMs, level: s.level }); n++; }
    }
  }
  return n;
}
