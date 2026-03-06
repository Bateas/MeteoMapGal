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
  minSeverity: 'high',
  mutedCategories: new Set(),
  cooldownMs: 5 * 60 * 1000, // 5 min cooldown per alert
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

/** Frequency + duration profiles for each severity */
const TONE_PROFILES: Record<AlertSeverity, { freq: number[]; duration: number; type: OscillatorType }> = {
  info: {
    freq: [440],        // single A4
    duration: 0.15,
    type: 'sine',
  },
  moderate: {
    freq: [523, 659],   // C5, E5 — gentle two-note
    duration: 0.18,
    type: 'sine',
  },
  high: {
    freq: [587, 784, 587], // D5, G5, D5 — warning triple
    duration: 0.15,
    type: 'triangle',
  },
  critical: {
    freq: [880, 660, 880, 660], // A5, E5 alternating — urgent
    duration: 0.12,
    type: 'sawtooth',
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

      // Envelope: quick attack, sustain, quick release
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(
        volume * (severity === 'critical' ? 0.6 : 0.4),
        startTime + 0.02,
      );
      gainNode.gain.linearRampToValueAtTime(0, startTime + profile.duration);

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
    // Play sound for the highest-severity new alert
    if (config.soundEnabled) {
      const highestSeverity = notifiableAlerts.reduce<AlertSeverity>(
        (max, a) => SEVERITY_ORDER[a.severity] > SEVERITY_ORDER[max] ? a.severity : max,
        escalated ? risk.severity : 'info',
      );
      playAlertTone(highestSeverity, config.volume);
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
