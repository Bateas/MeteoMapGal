/**
 * What the «Lluvia ahora» layer measured, applied to the alert list.
 *
 * On 20-oct (first real front with the layer) the panel said «Lluvia prevista en ~1h» while the chip
 * said LLUEVE, and «Riesgo de niebla marítima» kept showing in the middle of the rain. The gauges
 * that the layer reports as raining already passed its checks (no sun, a partner gauge or radar
 * echo over them), so they can say «it is raining now».
 *
 * Fog: drizzle inside fog wets gauges too, so wet gauges alone do not rule fog out. Echo of 20 dBZ
 * or more over the gauge does: fog drizzle hardly shows on radar, rain at 0.6 mm/h and up does.
 * Two such gauges remove only the RISK alerts built from physics (no camera, no official
 * visibility): a fog seen by cameras or by AEMET stays.
 */
import type { UnifiedAlert, AlertSeverity } from './types';

export interface RainNowInput {
  /** Gauges the rain layer counts as raining, wettest first; mm over its 30-min window */
  gauges: { name: string; mm: number; radarDbz: number | null }[];
}

export const FOG_VETO_DBZ = 20;
export const FOG_VETO_GAUGES = 2;
const WINDOW_MIN = 30;

const FOG_RISK_ONLY = new Set(['maritime-fog|Riesgo de niebla marítima', 'fog-alert|Riesgo de niebla']);

/** Rain on radar over two gauges: the physics «riesgo de niebla» does not describe this sky. */
export function rainRulesOutFogRisk(rain: RainNowInput | undefined): boolean {
  if (!rain) return false;
  return rain.gauges.filter((g) => g.radarDbz != null && g.radarDbz >= FOG_VETO_DBZ).length >= FOG_VETO_GAUGES;
}

/** The alerts without the fog-risk ones when rain rules them out. */
export function dropFogRiskInRain(alerts: UnifiedAlert[], rain: RainNowInput | undefined): UnifiedAlert[] {
  if (!rainRulesOutFogRisk(rain)) return alerts;
  return alerts.filter((a) => !FOG_RISK_ONLY.has(`${a.id}|${a.title}`));
}

const mmText = (mm: number) => mm.toFixed(1).replace('.', ',');

/** AEMET's intensity scale, mm/h (the same bands as the forecast alert, rainAlerts.ts). */
const MODERATE_MMH = 2, HEAVY_MMH = 15, VERY_HEAVY_MMH = 30;
const RANK: Record<AlertSeverity, number> = { info: 0, moderate: 1, high: 2, critical: 3 };

/**
 * The intensity measured now, from the SECOND wettest gauge: one gauge is never enough to raise a
 * level (20-oct: 5,3 mm in 30 min at several Vigo gauges while the light said OK, because the
 * measured rain only made an informative notice).
 */
export function measuredIntensity(rain: RainNowInput): { severity: AlertSeverity; label: string; score: number } {
  const rates = rain.gauges.map((g) => g.mm * (60 / WINDOW_MIN)).sort((a, b) => b - a);
  const r = rates.length >= 2 ? rates[1] : 0;
  if (r >= VERY_HEAVY_MMH) return { severity: 'critical', label: 'Lluvia muy fuerte ahora', score: 85 };
  if (r >= HEAVY_MMH) return { severity: 'high', label: 'Lluvia fuerte ahora', score: 60 };
  if (r >= MODERATE_MMH) return { severity: 'moderate', label: 'Lluvia moderada ahora', score: 40 };
  return { severity: 'info', label: 'Lloviendo ahora', score: 30 };
}

/** «Lloviendo ahora» on the rain alert (or a new one) when gauges measure rain. */
export function applyRainNow(alerts: UnifiedAlert[], rain: RainNowInput | undefined): UnifiedAlert[] {
  if (!rain || rain.gauges.length === 0) return alerts;
  const n = rain.gauges.length;
  const named = rain.gauges.slice(0, 2).map((g) => `${g.name} ${mmText(g.mm)} mm`).join(', ');
  const now = `${n} ${n === 1 ? 'pluviómetro mide' : 'pluviómetros miden'} lluvia (${named}${n > 2 ? '…' : ''} en ${WINDOW_MIN} min)`;
  const m = measuredIntensity(rain);
  const i = alerts.findIndex((a) => a.category === 'rain');
  if (i >= 0) {
    const prev = alerts[i];
    const out = alerts.slice();
    // The forecast's probability badge would read as how sure we are that it rains: it is raining.
    const severity = RANK[m.severity] > RANK[prev.severity] ? m.severity : prev.severity;
    out[i] = { ...prev, severity, title: m.label, detail: `${now} · Previsión: ${prev.detail}`, score: Math.max(prev.score, m.score), confidence: undefined };
    return out;
  }
  return [...alerts, {
    id: 'rain-now', category: 'rain', severity: m.severity, score: m.score, icon: 'cloud-rain',
    title: m.label, detail: now, urgent: false, updatedAt: new Date(),
  }];
}
