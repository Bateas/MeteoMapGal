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
import type { UnifiedAlert } from './types';

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

/** «Lloviendo ahora» on the rain alert (or a new one) when gauges measure rain. */
export function applyRainNow(alerts: UnifiedAlert[], rain: RainNowInput | undefined): UnifiedAlert[] {
  if (!rain || rain.gauges.length === 0) return alerts;
  const n = rain.gauges.length;
  const named = rain.gauges.slice(0, 2).map((g) => `${g.name} ${mmText(g.mm)} mm`).join(', ');
  const now = `${n} ${n === 1 ? 'pluviómetro mide' : 'pluviómetros miden'} lluvia (${named}${n > 2 ? '…' : ''} en ${WINDOW_MIN} min)`;
  const i = alerts.findIndex((a) => a.category === 'rain');
  if (i >= 0) {
    const prev = alerts[i];
    const out = alerts.slice();
    // The forecast's probability badge would read as how sure we are that it rains: it is raining.
    out[i] = { ...prev, title: 'Lloviendo ahora', detail: `${now} · Previsión: ${prev.detail}`, score: Math.max(prev.score, 30), confidence: undefined };
    return out;
  }
  return [...alerts, {
    id: 'rain-now', category: 'rain', severity: 'info', score: 30, icon: 'cloud-rain',
    title: 'Lloviendo ahora', detail: now, urgent: false, updatedAt: new Date(),
  }];
}
