/**
 * Storm Predictor — crosses lightning, CAPE, radar presence, wind anomalies,
 * and solar radiation to predict storm approach BEFORE it arrives.
 *
 * Key insight: CAPE + cloudCover + precipitation forecast + nearby lightning
 * = storm probability in the next 30-60 minutes.
 *
 * This service does NOT fetch new data — it correlates existing data from:
 * - useForecastStore (CAPE, precipitation, cloudCover, visibility)
 * - useLightningStore (clusters, stormAlert)
 * - stormShadowDetector (solar drops, wind anomalies)
 *
 * Pure computation — no API calls, no side effects.
 */

import type { HourlyForecast } from '../types/forecast';
import type { StormAlert } from '../types/lightning';
import type { StormShadow } from './stormShadowDetector';
import type { MGWarning } from '../api/mgWarningsClient';
import { isStormSkyState } from '../api/meteoSixClient';

// ── Types ────────────────────────────────────────────────

export interface StormPrediction {
  /** Overall probability 0-100 */
  probability: number;
  /** Time horizon: 'imminent' (<30min), 'likely' (30-60min), 'possible' (1-3h), 'none' */
  horizon: 'imminent' | 'likely' | 'possible' | 'none';
  /** Predicted severity: 'moderate' (rain+wind), 'severe' (lightning+hail), 'extreme' */
  severity: 'none' | 'moderate' | 'severe' | 'extreme';
  /** Human-readable summary in Spanish */
  summary: string;
  /** Contributing signals with their individual confidence */
  signals: StormSignal[];
  /** ETA in minutes (from nearest cluster or forecast) */
  etaMinutes: number | null;
  /** Recommended action */
  action: string;
}

export interface StormSignal {
  name: string;
  active: boolean;
  value: string;
  weight: number; // 0-1 contribution to probability
}

// ── Thresholds ───────────────────────────────────────────

const CAPE_MODERATE = 300;   // J/kg — convection possible
const CAPE_HIGH = 800;       // J/kg — storms likely
const CAPE_SEVERE = 1500;    // J/kg — severe storms
const PRECIP_THRESHOLD = 2;  // mm/h — significant rain
const CLOUD_THRESHOLD = 80;  // % — heavy overcast
const VISIBILITY_LOW = 5000; // m — reduced visibility

// ── Core Predictor ───────────────────────────────────────

export function predictStorm(
  forecast: HourlyForecast[],
  stormAlert: StormAlert,
  stormShadow: StormShadow | null,
  mgWarnings?: MGWarning[],
): StormPrediction {
  const signals: StormSignal[] = [];
  let probability = 0;

  // ── 1. Current forecast CAPE (next 3 hours) ──
  const now = Date.now();
  const next3h = forecast.filter((f) => {
    const diff = f.time.getTime() - now;
    return diff >= 0 && diff < 3 * 3600_000;
  });

  const maxCape = Math.max(0, ...next3h.map((f) => f.cape ?? 0));

  // CIN: Convective Inhibition acts as a "lid" on convection.
  // High CIN (>100 J/kg) suppresses storms even with high CAPE.
  // We want the MINIMUM positive CIN value (lowest barrier to convection).
  // If no positive CIN → no lid → cinSuppression = 1.0 (no suppression).
  const cinValues = next3h.map((f) => f.cin ?? 0).filter((v) => v > 0);
  const minCin = cinValues.length > 0 ? Math.min(...cinValues) : 0;
  const cinSuppression = minCin > 200 ? 0.5 : minCin > 100 ? 0.7 : 1.0;

  // Lifted Index: negative = unstable. < -4 is strong instability signal.
  const minLI = next3h.length > 0
    ? Math.min(...next3h.map((f) => f.liftedIndex ?? 0))
    : 0;
  const liBoost = minLI < -6 ? 0.1 : minLI < -3 ? 0.05 : 0;

  // CAPE weight adjusted by CIN suppression
  const rawCapeWeight = maxCape >= CAPE_SEVERE ? 0.3 : maxCape >= CAPE_HIGH ? 0.2 : maxCape >= CAPE_MODERATE ? 0.1 : 0;
  const capeSignal: StormSignal = {
    name: 'CAPE',
    active: maxCape >= CAPE_MODERATE,
    value: `${maxCape.toFixed(0)} J/kg${minCin > 100 ? ` (CIN ${minCin.toFixed(0)})` : ''}${minLI < -3 ? ` LI ${minLI.toFixed(0)}` : ''}`,
    weight: rawCapeWeight * cinSuppression + liBoost,
  };
  signals.push(capeSignal);
  probability += capeSignal.weight * 100;

  // ── 2. Precipitation forecast (next 3h) ──
  const maxPrecip = Math.max(0, ...next3h.map((f) => f.precipitation ?? 0));
  const precipProb = Math.max(0, ...next3h.map((f) => f.precipProbability ?? 0));
  const precipSignal: StormSignal = {
    name: 'Lluvia prevista',
    active: maxPrecip >= PRECIP_THRESHOLD || precipProb >= 70,
    value: `${maxPrecip.toFixed(1)} mm/h, ${precipProb}%`,
    weight: maxPrecip >= 10 ? 0.25 : maxPrecip >= PRECIP_THRESHOLD ? 0.15 : precipProb >= 70 ? 0.1 : 0,
  };
  signals.push(precipSignal);
  probability += precipSignal.weight * 100;

  // ── 3. Cloud cover (next 3h) ──
  const maxCloud = Math.max(0, ...next3h.map((f) => f.cloudCover ?? 0));
  const cloudSignal: StormSignal = {
    name: 'Nubosidad',
    active: maxCloud >= CLOUD_THRESHOLD,
    value: `${maxCloud.toFixed(0)}%`,
    weight: maxCloud >= 95 ? 0.1 : maxCloud >= CLOUD_THRESHOLD ? 0.05 : 0,
  };
  signals.push(cloudSignal);
  probability += cloudSignal.weight * 100;

  // ── 4. Active lightning nearby ──
  const lightningSignal: StormSignal = {
    name: 'Rayos detectados',
    active: stormAlert.level !== 'none',
    value: stormAlert.level !== 'none'
      ? `${stormAlert.recentCount} rayos a ${stormAlert.nearestKm.toFixed(0)}km (${stormAlert.trend})`
      : 'Ninguno',
    weight: stormAlert.level === 'danger' ? 0.35
      : stormAlert.level === 'warning' ? 0.3
      : stormAlert.level === 'watch' ? 0.2
      : 0,
  };
  signals.push(lightningSignal);
  probability += lightningSignal.weight * 100;

  // ── 5. Storm approaching (velocity vector) ──
  const approachSignal: StormSignal = {
    name: 'Tormenta acercandose',
    active: stormAlert.trend === 'approaching' && stormAlert.etaMinutes != null,
    value: stormAlert.etaMinutes != null ? `ETA ${stormAlert.etaMinutes}min a ${stormAlert.speedKmh?.toFixed(0) ?? '?'}km/h` : 'No',
    weight: stormAlert.trend === 'approaching' ? 0.15 : 0,
  };
  signals.push(approachSignal);
  probability += approachSignal.weight * 100;

  // ── 6. Storm shadow (solar drop + wind anomaly) ──
  const shadowSignal: StormSignal = {
    name: 'Sombra de tormenta',
    active: stormShadow != null && stormShadow.confidence > 40,
    value: stormShadow ? `${stormShadow.confidence}% confianza, ${stormShadow.shadowedStations.length} estaciones` : 'No detectada',
    weight: stormShadow && stormShadow.confidence > 60 ? 0.15 : stormShadow && stormShadow.confidence > 40 ? 0.1 : 0,
  };
  signals.push(shadowSignal);
  probability += shadowSignal.weight * 100;

  // ── 7. Wind gusts forecast ──
  const maxGusts = Math.max(0, ...next3h.map((f) => f.windGusts ?? 0));
  const gustSignal: StormSignal = {
    name: 'Rachas previstas',
    active: maxGusts > 10, // >10 m/s = ~20kt
    value: `${(maxGusts * 1.944).toFixed(0)} kt`,
    weight: maxGusts > 15 ? 0.1 : maxGusts > 10 ? 0.05 : 0,
  };
  signals.push(gustSignal);
  probability += gustSignal.weight * 100;

  // ── 8. Official MG adverse warnings ──
  // MeteoGalicia storm/rain warnings are high-confidence signals — they incorporate
  // the full NWP model suite + human meteorologist review.
  const stormWarnings = (mgWarnings ?? []).filter((w) =>
    w.type === 'Tormenta' || w.type === 'Treboada' || w.type === 'Choiva' || w.type === 'Chuvia',
  );
  const maxWarningLevel = stormWarnings.length > 0
    ? Math.max(...stormWarnings.map((w) => w.maxLevel))
    : 0;
  const warningSignal: StormSignal = {
    name: 'Aviso MG oficial',
    active: maxWarningLevel > 0,
    value: maxWarningLevel === 3 ? 'Rojo'
      : maxWarningLevel === 2 ? 'Naranja'
      : maxWarningLevel === 1 ? 'Amarillo'
      : 'Ninguno',
    weight: maxWarningLevel === 3 ? 0.3
      : maxWarningLevel === 2 ? 0.2
      : maxWarningLevel === 1 ? 0.1
      : 0,
  };
  signals.push(warningSignal);
  probability += warningSignal.weight * 100;

  // ── 9. WRF sky_state "STORMS" forecast (MeteoSIX) ──
  // Categorical storm prediction from WRF model — complements CAPE (which is potential, not actual).
  const stormSkyCount = next3h.filter((f) => isStormSkyState(f.skyState)).length;
  const skyStateSignal: StormSignal = {
    name: 'WRF prevé tormentas',
    active: stormSkyCount > 0,
    value: stormSkyCount > 0 ? `${stormSkyCount}h de ${next3h.length}h` : 'No',
    weight: stormSkyCount >= 2 ? 0.1 : stormSkyCount === 1 ? 0.06 : 0,
  };
  signals.push(skyStateSignal);
  probability += skyStateSignal.weight * 100;

  // Cap at 100
  probability = Math.min(100, Math.round(probability));

  // ── Determine horizon ──
  let horizon: StormPrediction['horizon'] = 'none';
  if (stormAlert.level === 'danger' || (stormAlert.level === 'warning' && stormAlert.trend === 'approaching')) {
    horizon = 'imminent';
  } else if (stormAlert.level === 'warning' || (stormAlert.level === 'watch' && stormAlert.trend === 'approaching')) {
    horizon = 'likely';
  } else if (probability >= 40) {
    horizon = 'possible';
  }

  // ── Determine severity ──
  // Lightning confirmation required for severe/extreme — CAPE alone is potential, not actual
  const hasLightning = stormAlert.level !== 'none';
  let severity: StormPrediction['severity'] = 'none';
  if ((maxCape >= CAPE_SEVERE && hasLightning) || (stormAlert.level === 'danger' && maxPrecip > 10)) {
    severity = 'extreme';
  } else if (stormAlert.level === 'danger' || (stormAlert.level === 'warning' && maxCape >= CAPE_HIGH)) {
    severity = 'severe';
  } else if (hasLightning || maxCape >= CAPE_HIGH || probability >= 30) {
    severity = 'moderate';
  }

  // ── ETA ──
  const etaMinutes = stormAlert.etaMinutes ?? (stormShadow?.etaMinutes ?? null);

  // ── Summary ──
  const summary = buildSummary(probability, horizon, severity, signals, etaMinutes);

  // ── Action ──
  const action = horizon === 'imminent'
    ? 'Salir del agua inmediatamente. Buscar refugio.'
    : horizon === 'likely'
    ? 'Preparar para salir. No alejarse de la orilla.'
    : horizon === 'possible'
    ? 'Vigilar la evolucion. Tener plan de salida.'
    : 'Sin riesgo detectado.';

  return { probability, horizon, severity, summary, signals, etaMinutes, action };
}

function buildSummary(
  prob: number,
  horizon: string,
  severity: string,
  signals: StormSignal[],
  eta: number | null,
): string {
  if (prob < 15) return 'Sin indicios de tormenta.';
  const active = signals.filter((s) => s.active).map((s) => s.name);
  const parts: string[] = [];

  if (horizon === 'imminent') {
    parts.push('Tormenta inminente');
  } else if (horizon === 'likely') {
    parts.push('Tormenta probable en la próxima hora');
  } else {
    parts.push(`Riesgo de tormenta (${prob}%)`);
  }

  if (eta != null && eta < 120) {
    parts.push(`ETA ~${eta}min`);
  }

  if (severity === 'extreme') {
    parts.push('Severa (posible granizo)');
  } else if (severity === 'severe') {
    parts.push('Con actividad electrica confirmada');
  } else if (severity === 'moderate') {
    parts.push('Inestabilidad atmosférica');
  }

  if (active.length > 0) {
    parts.push(`Señales: ${active.join(', ')}`);
  }

  return parts.join('. ') + '.';
}
