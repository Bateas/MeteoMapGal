/**
 * Notification Service — browser push notifications + audio alerts.
 *
 * Uses:
 * - Web Notification API for browser push notifications
 * - Web Audio API for synthetic tones (no external sound files needed)
 *
 * Designed to trigger on alert severity TRANSITIONS, not on every update.
 * E.g., only notifies when a new 'critical' alert appears, not on each tick.
 */

import type { AlertSeverity, AlertCategory, UnifiedAlert, CompositeRisk } from './alertService';
import { postAlertWebhook } from '../api/webhookClient';

// ── Configuration ────────────────────────────────────────────

export interface NotificationConfig {
  /** Master enable/disable */
  enabled: boolean;
  /** Enable browser push notifications */
  pushEnabled: boolean;
  /** Enable audio alerts */
  soundEnabled: boolean;
  /** Volume 0-1 */
  volume: number;
  /** Minimum severity to trigger notifications */
  minSeverity: AlertSeverity;
  /** Categories to suppress (user can mute specific types) */
  mutedCategories: Set<AlertCategory>;
  /** Cooldown per alert ID (ms) — avoid spam */
  cooldownMs: number;
}

const DEFAULT_CONFIG: NotificationConfig = {
  enabled: true,
  pushEnabled: true,
  soundEnabled: true,
  volume: 0.5,
  minSeverity: 'critical', // Only PELIGRO triggers sound by default — user can lower to 'high'
  mutedCategories: new Set(),
  cooldownMs: 30 * 60 * 1000, // 30 min cooldown per alert (subtle, not spammy)
};

// ── Severity ordering ───────────────────────────────────────

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  info: 0,
  moderate: 1,
  high: 2,
  critical: 3,
};

function meetsMinSeverity(severity: AlertSeverity, min: AlertSeverity): boolean {
  return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[min];
}

// ── Audio tones (Web Audio API) ─────────────────────────────

/**
 * Softer, warmer tones — think "gentle wind chime", not alarm.
 * Lower frequencies feel warmer and less piercing on speakers/headphones.
 * Even critical uses a soft two-note chord, just slightly brighter.
 */
const TONE_PROFILES: Record<AlertSeverity, { freq: number[]; duration: number; type: OscillatorType; gainPeak: number }> = {
  info: {
    freq: [262],            // C4 — single warm note
    duration: 0.12,
    type: 'sine',
    gainPeak: 0.05,
  },
  moderate: {
    freq: [262, 330],       // C4, E4 — soft major third
    duration: 0.14,
    type: 'sine',
    gainPeak: 0.06,
  },
  high: {
    freq: [294, 370],       // D4, F#4 — gentle ascending third
    duration: 0.15,
    type: 'sine',
    gainPeak: 0.08,
  },
  critical: {
    freq: [330, 415],       // E4, G#4 — slightly brighter two-note chime
    duration: 0.18,
    type: 'sine',
    gainPeak: 0.12,         // Still subtle — 12% of master volume
  },
};

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  // Resume if suspended (browser autoplay policy)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Play a synthetic tone for the given severity.
 * Uses Web Audio API — no external files needed.
 */
export function playAlertTone(severity: AlertSeverity, volume: number = 0.5): void {
  try {
    const ctx = getAudioContext();
    const profile = TONE_PROFILES[severity];
    const gainNode = ctx.createGain();
    gainNode.connect(ctx.destination);

    let startTime = ctx.currentTime;

    for (const freq of profile.freq) {
      const osc = ctx.createOscillator();
      osc.type = profile.type;
      osc.frequency.setValueAtTime(freq, startTime);
      osc.connect(gainNode);

      // Envelope: very gentle attack → sustain → smooth release
      const maxGain = volume * profile.gainPeak;
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(maxGain, startTime + 0.04); // slower attack
      gainNode.gain.setValueAtTime(maxGain, startTime + profile.duration * 0.6); // sustain
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + profile.duration); // smooth fade

      osc.start(startTime);
      osc.stop(startTime + profile.duration + 0.01);

      startTime += profile.duration + 0.03; // gap between notes
    }
  } catch {
    // Audio not available — fail silently
  }
}

// ── Browser push notifications ──────────────────────────────

/** Request notification permission (must be called from user gesture) */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.requestPermission();
}

/** Send a browser notification for an alert */
function sendBrowserNotification(alert: UnifiedAlert): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  try {
    const notification = new Notification(`MeteoMapGal — ${alert.title}`, {
      body: alert.detail,
      icon: '/favicon.ico',
      tag: alert.id, // Replaces existing notification with same tag
      silent: true,  // We handle sound ourselves
      requireInteraction: alert.severity === 'critical',
    });

    // Auto-close after 8 seconds (except critical)
    if (alert.severity !== 'critical') {
      setTimeout(() => notification.close(), 8000);
    }
  } catch {
    // Notification API not available
  }
}

// ── Notification engine (stateful — tracks what was already notified) ──

/** Track last notification time per alert ID */
const lastNotified = new Map<string, number>();
/** Track previous alert IDs to detect NEW alerts */
let previousAlertIds = new Set<string>();
/** Track previous max severity for escalation detection */
let previousMaxSeverity: AlertSeverity = 'info';
/** Global cooldown — minimum 10 min between ANY sound, regardless of alert ID */
let lastSoundTime = 0;
const GLOBAL_SOUND_COOLDOWN_MS = 10 * 60 * 1000; // 10 min

/**
 * Process a new set of alerts and trigger notifications for:
 * 1. NEW alerts that weren't in the previous set
 * 2. ESCALATED alerts (severity increased)
 *
 * Call this from the alert aggregation effect in AppShell.
 */
export function processAlertNotifications(
  alerts: UnifiedAlert[],
  risk: CompositeRisk,
  config: NotificationConfig = DEFAULT_CONFIG,
): void {
  if (!config.enabled) return;

  const now = Date.now();
  const currentAlertIds = new Set(alerts.map((a) => a.id));

  // Find NEW alerts (not in previous set)
  const newAlerts = alerts.filter((a) => !previousAlertIds.has(a.id));

  // Find alerts that meet notification criteria
  const notifiableAlerts = newAlerts.filter((a) => {
    // Must meet minimum severity
    if (!meetsMinSeverity(a.severity, config.minSeverity)) return false;
    // Not muted
    if (config.mutedCategories.has(a.category)) return false;
    // Cooldown check
    const lastTime = lastNotified.get(a.id);
    if (lastTime && now - lastTime < config.cooldownMs) return false;
    return true;
  });

  // Also check for severity ESCALATION (overall risk level went up)
  const escalated = SEVERITY_ORDER[risk.severity] > SEVERITY_ORDER[previousMaxSeverity]
    && meetsMinSeverity(risk.severity, config.minSeverity);

  if (notifiableAlerts.length > 0 || escalated) {
    // Play sound — with global cooldown to prevent spam during persistent alerts
    if (config.soundEnabled && (now - lastSoundTime >= GLOBAL_SOUND_COOLDOWN_MS)) {
      const highestSeverity = notifiableAlerts.reduce<AlertSeverity>(
        (max, a) => SEVERITY_ORDER[a.severity] > SEVERITY_ORDER[max] ? a.severity : max,
        escalated ? risk.severity : 'info',
      );
      playAlertTone(highestSeverity, config.volume);
      lastSoundTime = now;
    }

    // Send browser notifications
    if (config.pushEnabled) {
      for (const a of notifiableAlerts) {
        sendBrowserNotification(a);
        lastNotified.set(a.id, now);
      }
    }

    // Send webhook alerts to n8n (severity >= high only)
    for (const a of notifiableAlerts) {
      if (meetsMinSeverity(a.severity, 'high')) {
        postAlertWebhook({
          alertId: a.id,
          category: a.category,
          severity: a.severity,
          title: a.title,
          detail: a.detail,
          icon: a.icon,
          score: a.score,
          sector: '', // Filled by caller if needed
          timestamp: new Date().toISOString(),
          compositeRisk: {
            score: risk.score,
            severity: risk.severity,
            activeCount: risk.activeCount,
          },
        });
      }
    }
  }

  // Update state for next comparison
  previousAlertIds = currentAlertIds;
  previousMaxSeverity = risk.severity;

  // Clean up old cooldown entries (prevent memory leak)
  if (lastNotified.size > 50) {
    const cutoff = now - config.cooldownMs * 2;
    for (const [id, time] of lastNotified) {
      if (time < cutoff) lastNotified.delete(id);
    }
  }
}

// ── Config persistence (localStorage) ───────────────────────

const STORAGE_KEY = 'meteomap_notification_config';

export function loadNotificationConfig(): NotificationConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(stored);
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      mutedCategories: new Set(parsed.mutedCategories ?? []),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveNotificationConfig(config: NotificationConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...config,
      mutedCategories: [...config.mutedCategories],
    }));
  } catch {
    // localStorage not available
  }
}
