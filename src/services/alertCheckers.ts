/**
 * Alert checkers — skeleton for future Telegram integration.
 * Pure functions, no side effects, no API calls.
 * Designed so a future Telegram bot can import and use them directly.
 */

import type { FrostAlert, RainAlert, FogAlert, DroneConditions, AlertMessage, AlertLevel } from '../types/campo';

// ── Alert summary generator ──────────────────────────────

export function generateAlertSummary(
  frost: FrostAlert,
  rain: RainAlert,
  fog: FogAlert,
  drone: DroneConditions,
): AlertMessage[] {
  const messages: AlertMessage[] = [];
  const now = new Date();

  // Frost alerts
  if (frost.level !== 'none') {
    const timeStr = frost.timeWindow
      ? `${frost.timeWindow.from.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })} - ${frost.timeWindow.to.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
      : '';
    messages.push({
      type: 'frost',
      level: frost.level,
      text: `Helada ${frost.level.toUpperCase()}: Tmin ${frost.minTemp?.toFixed(1) ?? '?'}°C ${timeStr}`,
      timestamp: now,
    });
  }

  // Rain alerts
  if (rain.level !== 'none') {
    messages.push({
      type: rain.hailRisk ? 'hail' : 'rain',
      level: rain.level,
      text: rain.hailRisk
        ? `GRANIZO: Precip ${rain.maxPrecip.toFixed(1)}mm, prob ${rain.maxProbability}%`
        : `Lluvia ${rain.level.toUpperCase()}: ${rain.maxPrecip.toFixed(1)}mm, prob ${rain.maxProbability}%`,
      timestamp: now,
    });
  }

  // Fog alerts (based on real data)
  if (fog.level !== 'none') {
    messages.push({
      type: 'fog',
      level: fog.level,
      text: `Niebla ${fog.level.toUpperCase()}: Spread ${fog.spread?.toFixed(1) ?? '?'}°C, Td ${fog.dewPoint?.toFixed(1) ?? '?'}°C`,
      timestamp: now,
    });
  }

  // Drone conditions
  messages.push({
    type: drone.flyable ? 'drone_ok' : 'drone_bad',
    level: drone.flyable ? 'none' : 'riesgo',
    text: drone.flyable
      ? `Dron: Condiciones aptas (viento ${drone.windKt.toFixed(0)} kt)`
      : `Dron: NO volar - ${drone.reasons.join(', ')}`,
    timestamp: now,
  });

  return messages;
}

// ── Notification cooldown ────────────────────────────────

const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Check if an alert should trigger a notification based on cooldown.
 * For future Telegram bot: track lastNotified per alert type.
 */
export function shouldNotify(
  alertLevel: AlertLevel,
  lastNotified: Date | null,
): boolean {
  if (alertLevel === 'none') return false;
  if (!lastNotified) return true;

  const elapsed = Date.now() - lastNotified.getTime();

  // Critical alerts bypass cooldown
  if (alertLevel === 'critico') return elapsed > 30 * 60 * 1000; // 30min for critical
  return elapsed > COOLDOWN_MS;
}

// ── Format for Telegram (placeholder) ────────────────────

export function formatTelegramMessage(messages: AlertMessage[]): string {
  if (messages.length === 0) return '';

  const lines = messages
    .filter((m) => m.level !== 'none')
    .map((m) => {
      const label = m.type === 'frost' ? '[Helada]'
        : m.type === 'hail' ? '[Granizo]'
        : m.type === 'rain' ? '[Lluvia]'
        : m.type === 'fog' ? '[Niebla]'
        : m.type === 'drone_ok' ? '[OK]'
        : '[Alerta]';
      return `${label} ${m.text}`;
    });

  return lines.length > 0
    ? `MeteoMap Campo\n${lines.join('\n')}`
    : '';
}
