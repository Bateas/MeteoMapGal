/**
 * Thresholds of the alerts in the browser: which ones sound and notify, and how often.
 * Alerts to Telegram are decided by the server around the clock (ingestor alertDispatcher), not here.
 */
import type { AlertSeverity } from '../services/alertService';

/** Minimum severity for browser push + sound (user can lower in settings) */
export const NOTIFICATION_DEFAULT_MIN_SEVERITY: AlertSeverity = 'critical';

/** Browser sound global cooldown */
export const NOTIFICATION_SOUND_COOLDOWN_MS = 10 * 60 * 1000; // 10 min

/** Browser notification per-alert cooldown */
export const NOTIFICATION_PER_ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 min
