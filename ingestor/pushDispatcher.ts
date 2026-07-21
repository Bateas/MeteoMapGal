/**
 * Web Push dispatcher — PWA lightning-safety notifications.
 *
 * Two levels driven by the EXISTING lightningProximityService brain (pure
 * observation of certified CG strikes, never a model):
 *   aviso   — real storm <=25km AND approaching: distance + ETA heads-up.
 *   peligro — strikes <10km: "sal del agua". The only push that ignores
 *             night silence, because it is an immediate safety call.
 *
 * Nothing else pushes through this channel: no verdicts, no wind, no daily
 * summary — and the storm predictor (%) NEVER reaches it.
 *
 * Structure: pure decision/payload functions (unit-tested) + an IO layer
 * (web-push + push_subscriptions table). The IO layer NEVER throws into the
 * analyzer polling loop.
 *
 * Degradation: missing/invalid VAPID keys => pushEnabled=false with a single
 * startup warn. Every public entry point then no-ops.
 */

import webpush from 'web-push';
import { getPool } from './db.js';
import { log } from './logger.js';
import type { SpotLightningRisk } from '../src/services/lightningProximityService.js';

// ── VAPID config (read once at process start) ──────────
// Both services (meteo-ingestor and meteo-api) import 'dotenv/config' as
// their first statement, so process.env is populated before this module
// body runs.

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || '';

let pushEnabled = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    pushEnabled = true;
  } catch (err) {
    // Malformed keys degrade to "feature off" — never crash the service.
    log.warn(`[Push] disabled (invalid VAPID config: ${(err as Error).message})`);
  }
} else {
  log.warn('[Push] disabled (no VAPID keys)');
}

export function isPushEnabled(): boolean {
  return pushEnabled;
}

/** Public VAPID key for the frontend PushManager.subscribe(), or null when
 *  the feature is disabled. */
export function getVapidPublicKey(): string | null {
  return pushEnabled ? VAPID_PUBLIC_KEY : null;
}

// ── Pure decision layer ────────────────────────────────

export type PushLevel = 'aviso' | 'peligro';

export interface PushPayload {
  title: string;
  body: string;
  /** Deep-link opened on notification click */
  url: string;
  /** Stable per-spot tag: a newer notification REPLACES the previous one
   *  instead of stacking (an escalation overwrites its own aviso). */
  tag: string;
}

/** Per endpoint|spot cooldown — mirrors LIGHTNING_COOLDOWN_MS (45min) in
 *  alertDispatcher.ts: a storm parked over the ría must not re-push every
 *  5min cycle. Escalation aviso→peligro bypasses it. */
export const PUSH_COOLDOWN_MS = 45 * 60_000;

// Night silence window — mirror of NIGHT_START/NIGHT_END in
// alertDispatcher.ts (module-private there, so the values are reflected
// here with this comment instead of imported). AVISO respects it; PELIGRO
// goes through: safety beats sleep.
export const PUSH_NIGHT_START = 23;
export const PUSH_NIGHT_END = 7;

const LEVEL_RANK: Record<PushLevel, number> = { aviso: 1, peligro: 2 };

export interface PushSentEntry {
  at: number;
  level: PushLevel;
}
export type PushSendState = Map<string, PushSentEntry>;

/**
 * The AVISO push is defined as "storm <=25km AND approaching" — a static
 * storm parked next door belongs on the map, not in the pocket (its body
 * copy literally says "acercandose"). PELIGRO always qualifies.
 */
export function shouldNotifyRisk(
  risk: Pick<SpotLightningRisk, 'level' | 'approaching'>,
): boolean {
  return risk.level === 'peligro' || risk.approaching;
}

/**
 * Cooldown + night-silence gate for one endpoint|spot key. Does NOT mutate
 * state — call markPushSent() only after the push was actually delivered.
 */
export function shouldSendPush(
  state: PushSendState,
  key: string,
  level: PushLevel,
  now: Date = new Date(),
): boolean {
  if (level === 'aviso') {
    const h = now.getHours();
    if (h >= PUSH_NIGHT_START || h < PUSH_NIGHT_END) return false;
  }
  const prev = state.get(key);
  if (
    prev
    && now.getTime() - prev.at < PUSH_COOLDOWN_MS
    && LEVEL_RANK[level] <= LEVEL_RANK[prev.level]
  ) {
    // Same-or-lower level within the cooldown window; a HIGHER level
    // (aviso → peligro escalation) falls through and sends immediately.
    return false;
  }
  return true;
}

/** Record a successful delivery for the cooldown gate. */
export function markPushSent(
  state: PushSendState,
  key: string,
  level: PushLevel,
  now: Date = new Date(),
): void {
  state.set(key, { at: now.getTime(), level });
}

/**
 * Build the notification payload for a spot risk.
 * Copy is plain Spanish, no emojis, no jargon — "mi tio en la barra" reads
 * it on a lock screen in 3 seconds.
 */
export function buildPushPayload(
  spotName: string,
  sectorId: string,
  spotId: string,
  risk: Pick<SpotLightningRisk, 'level' | 'nearestKm' | 'etaMin'>,
): PushPayload {
  const url = `/?sector=${sectorId}&spot=${spotId}`;
  const tag = `lightning-${spotId}`;

  if (risk.level === 'peligro') {
    return {
      title: `PELIGRO - ${spotName}`,
      body: 'Rayos a menos de 10 km. Sal del agua.',
      url,
      tag,
    };
  }

  const km = Math.max(1, Math.round(risk.nearestKm));
  let body = `Tormenta a ${km} km, acercandose.`;
  if (risk.etaMin != null) {
    body += ` Llegada estimada ~${risk.etaMin} min.`;
  }
  return {
    title: `Aviso de tormenta - ${spotName}`,
    body,
    url,
    tag,
  };
}

// ── IO layer ───────────────────────────────────────────

interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** In-memory delivery state, keyed `${endpoint}|${spotId}`. Cleared on
 *  restart — worst case one duplicate push after a redeploy, acceptable. */
const sendState: PushSendState = new Map();

/** A preventive heads-up tolerates queueing while the device is offline. */
const TTL_AVISO_S = 1800;
/** A stale safety alert must NOT be delivered late — the storm either
 *  already hit or already passed. */
const TTL_PELIGRO_S = 900;

/** Threshold of consecutive delivery failures before a subscription is
 *  considered dead and pruned. */
const MAX_FAIL_COUNT = 10;

async function removeSubscription(endpoint: string): Promise<void> {
  await getPool().query(
    'DELETE FROM push_subscriptions WHERE endpoint = $1',
    [endpoint],
  );
}

/**
 * Fan out one spot risk to every subscription opted into that spot.
 * Fire-and-forget from the analyzer: all errors are caught and aggregated
 * into a single log.warn — this function NEVER throws.
 */
export async function dispatchLightningPush(
  spotId: string,
  spotName: string,
  sectorId: string,
  risk: SpotLightningRisk,
): Promise<void> {
  if (!pushEnabled) return;
  if (!shouldNotifyRisk(risk)) return;

  try {
    const db = getPool();
    const result = await db.query<SubscriptionRow>(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE $1 = ANY(spot_ids)',
      [spotId],
    );
    if (result.rows.length === 0) return;

    const payload = JSON.stringify(buildPushPayload(spotName, sectorId, spotId, risk));
    const ttl = risk.level === 'peligro' ? TTL_PELIGRO_S : TTL_AVISO_S;

    let sent = 0;
    const errors: string[] = [];

    for (const sub of result.rows) {
      const key = `${sub.endpoint}|${spotId}`;
      if (!shouldSendPush(sendState, key, risk.level)) continue;

      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { TTL: ttl, urgency: 'high' },
        );
        markPushSent(sendState, key, risk.level);
        sent++;
        // Success clears the failure streak so an intermittently flaky
        // endpoint never creeps toward the pruning threshold.
        await db.query(
          'UPDATE push_subscriptions SET last_ok = NOW(), fail_count = 0 WHERE endpoint = $1',
          [sub.endpoint],
        ).catch(() => undefined);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // The push service says the subscription is gone — prune it.
          await removeSubscription(sub.endpoint).catch(() => undefined);
          errors.push(`HTTP ${status} gone (removed)`);
        } else {
          const upd = await db.query<{ fail_count: number }>(
            'UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE endpoint = $1 RETURNING fail_count',
            [sub.endpoint],
          ).catch(() => null);
          const fails = upd?.rows[0]?.fail_count ?? 0;
          if (fails > MAX_FAIL_COUNT) {
            await removeSubscription(sub.endpoint).catch(() => undefined);
            errors.push(`HTTP ${status ?? '?'} (fail_count ${fails} — removed)`);
          } else {
            errors.push(`HTTP ${status ?? '?'} (fail_count ${fails})`);
          }
        }
      }
    }

    if (sent > 0) {
      const aviso = risk.level === 'aviso' ? sent : 0;
      const peligro = risk.level === 'peligro' ? sent : 0;
      log.ok(`[Push] sent ${aviso} aviso / ${peligro} peligro to ${sent} subs (${spotId})`);
    }
    if (errors.length > 0) {
      // ONE aggregated line per dispatch, never one warn per endpoint.
      log.warn(`[Push] ${errors.length} delivery error(s) for ${spotId}: ${errors.slice(0, 5).join(', ')}`);
    }
  } catch (err) {
    // NEVER propagate into the analyzer polling loop.
    log.warn(`[Push] dispatch failed for ${spotId}: ${(err as Error).message}`);
  }
}

// ── Self-test push (user-triggered from the frontend) ──

const lastTestPush = new Map<string, number>();
const TEST_PUSH_MIN_GAP_MS = 60_000; // 1/min per endpoint

export type TestPushResult = 'sent' | 'disabled' | 'not-found' | 'rate-limited' | 'error';

/**
 * Send ONE test notification to a single endpoint, only if that endpoint
 * already exists in the table (a user can only self-test a subscription the
 * browser previously registered — not probe arbitrary endpoints).
 */
export async function sendTestPush(endpoint: string): Promise<TestPushResult> {
  if (!pushEnabled) return 'disabled';

  const last = lastTestPush.get(endpoint);
  if (last && Date.now() - last < TEST_PUSH_MIN_GAP_MS) return 'rate-limited';

  try {
    const db = getPool();
    const result = await db.query<SubscriptionRow>(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE endpoint = $1',
      [endpoint],
    );
    const sub = result.rows[0];
    if (!sub) return 'not-found';

    // Arm the rate limit before the send so a hanging push service cannot
    // be hammered by an impatient user re-tapping the button.
    lastTestPush.set(endpoint, Date.now());

    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({
        title: 'Prueba de aviso - MeteoMapGal',
        body: 'Asi te avisaremos si hay tormenta cerca de tu spot.',
        url: '/',
        tag: 'push-test',
      } satisfies PushPayload),
      { TTL: 300, urgency: 'normal' },
    );
    await db.query(
      'UPDATE push_subscriptions SET last_ok = NOW(), fail_count = 0 WHERE endpoint = $1',
      [endpoint],
    ).catch(() => undefined);
    return 'sent';
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      await removeSubscription(endpoint).catch(() => undefined);
    }
    log.warn(`[Push] test push failed: ${(err as Error).message}`);
    return 'error';
  }
}

// ── Startup heartbeat ──────────────────────────────────

let startupLogged = false;

/**
 * One-time "enabled, N subscriptions" heartbeat. Internally guarded, so it
 * is safe to call on every analyzer cycle / API boot; requires the DB pool
 * (both services init it before any cycle runs). The disabled case already
 * warned at module load — no second line needed.
 */
export async function logPushStartup(): Promise<void> {
  if (startupLogged) return;
  startupLogged = true;
  if (!pushEnabled) return;
  try {
    const r = await getPool().query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM push_subscriptions',
    );
    log.info(`[Push] enabled, ${r.rows[0]?.count ?? '0'} subscriptions`);
  } catch (err) {
    // Table missing (schema not applied yet) — visible but not fatal.
    log.warn(`[Push] enabled, subscription count unavailable: ${(err as Error).message}`);
  }
}
