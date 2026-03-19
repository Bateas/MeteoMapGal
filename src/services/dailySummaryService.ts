/**
 * Daily sailing summary service — builds and sends morning Telegram briefing.
 *
 * Collects current state from stores → builds WebhookSummaryPayload → posts to n8n.
 * Called by AppShell's housekeeping interval. Sends once per day at ~8:00 AM.
 *
 * Non-critical: fails silently. Skips in development mode.
 */

import { useWeatherStore } from '../store/weatherStore';
import { useSectorStore } from '../store/sectorStore';
import { useSpotStore } from '../store/spotStore';
import { useAlertStore } from '../store/alertStore';
import { postSailingSummary } from '../api/webhookClient';
import { msToKnots } from './windUtils';
import type { WebhookSummaryPayload } from '../api/webhookClient';

/** localStorage key to track last summary date */
const LAST_SUMMARY_KEY = 'meteomap-last-summary';

/** Hour to send the daily summary (8:00 AM local) */
const SUMMARY_HOUR = 8;

/**
 * Check if a daily summary should be sent now.
 * Returns true if it's past SUMMARY_HOUR and no summary was sent today.
 */
export function shouldSendDailySummary(): boolean {
  if (import.meta.env.DEV) return false;

  const now = new Date();
  const hour = now.getHours();

  // Only send between 8:00 and 9:00 AM
  if (hour < SUMMARY_HOUR || hour >= SUMMARY_HOUR + 1) return false;

  // Check if already sent today
  const lastSent = localStorage.getItem(LAST_SUMMARY_KEY);
  if (lastSent) {
    const lastDate = new Date(lastSent);
    if (lastDate.toDateString() === now.toDateString()) return false;
  }

  return true;
}

/**
 * Build and send the daily sailing summary.
 * Collects data from all stores and posts to n8n webhook.
 */
export async function sendDailySummary(): Promise<void> {
  try {
    const sector = useSectorStore.getState().activeSector;
    const alerts = useAlertStore.getState().alerts;
    const spotScores = useSpotStore.getState().spotScores;
    const sailingWindows = useSpotStore.getState().sailingWindows;
    const stations = useWeatherStore.getState().stations;
    const readings = useWeatherStore.getState().currentReadings;

    // Compute composite risk from alerts
    const activeAlerts = alerts.filter((a) => !a.expired);
    const maxScore = activeAlerts.reduce((max, a) => Math.max(max, a.score), 0);
    const riskSeverity = maxScore >= 85 ? 'critical' as const
      : maxScore >= 60 ? 'high' as const
      : maxScore >= 30 ? 'moderate' as const
      : 'low' as const;
    const riskColor = maxScore >= 85 ? '#ef4444'
      : maxScore >= 60 ? '#f59e0b'
      : maxScore >= 30 ? '#3b82f6'
      : '#22c55e';

    // Find best sailing window across all spots
    let bestWindow: WebhookSummaryPayload['sailing'] = undefined;
    let bestWindowScore = 0;

    for (const [spotId, windowResult] of sailingWindows) {
      if (!windowResult?.windows) continue;
      for (const w of windowResult.windows) {
        const avgKt = msToKnots(w.avgSpeed);
        if (avgKt > bestWindowScore) {
          bestWindowScore = avgKt;
          bestWindow = {
            spot: spotId,
            start: new Date(w.startHour).toISOString(),
            end: new Date(w.endHour).toISOString(),
            avgWindKt: Math.round(avgKt),
            verdict: w.verdict,
          };
        }
      }
    }

    // Build summary of spot verdicts
    const spotSummaries: string[] = [];
    for (const [spotId, score] of spotScores) {
      if (score) {
        const windKt = score.windSpeedMs != null ? Math.round(msToKnots(score.windSpeedMs)) : 0;
        spotSummaries.push(`${spotId}: ${score.verdict.toUpperCase()} ${windKt}kt`);
      }
    }

    // Count stations with readings
    const stationsWithData = stations.filter((s) => readings.has(s.id)).length;

    const payload: WebhookSummaryPayload = {
      sector: sector.name,
      timestamp: new Date().toISOString(),
      risk: {
        score: maxScore,
        severity: riskSeverity,
        color: riskColor,
        activeCount: activeAlerts.length,
      },
      alerts: activeAlerts.slice(0, 5).map((a) => ({
        id: a.id,
        severity: a.severity,
        title: a.title,
        detail: a.detail,
      })),
      sailing: bestWindow,
    };

    await postSailingSummary(payload);

    // Mark as sent for today
    localStorage.setItem(LAST_SUMMARY_KEY, new Date().toISOString());

    console.debug(`[DailySummary] Sent: ${sector.name}, ${stationsWithData} stations, ${spotSummaries.join(', ') || 'no spots'}`);
  } catch (err) {
    console.warn('[DailySummary] Failed to send:', err);
  }
}
