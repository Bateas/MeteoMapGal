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

/**
 * Recent lightning activity within the alert radius, bucketed by time
 * window. Used for temporal hysteresis: `stormAlert.level` is the
 * INSTANTANEOUS state (strikes in the last poll). During an active storm
 * there are 60-90s gaps between strikes, so the instantaneous level flaps
 * to 'none' even though the storm is obviously ongoing — this caused the
 * 2026-04-28 audit to show severe→none→severe bouncing within 1 minute,
 * and a 6h "none" miss while 625 strikes/window were observed.
 *
 * These windowed counts let the predictor hold a severity floor through
 * brief lulls and anticipate a building storm.
 */
export interface RecentLightningActivity {
  /** Strikes within alert radius in the last 30 min */
  count30m: number;
  /** Last 15 min */
  count15m: number;
  /** Last 5 min */
  count5m: number;
}

// ── Thresholds ───────────────────────────────────────────

const CAPE_MODERATE = 300;   // J/kg — convection possible
const CAPE_HIGH = 800;       // J/kg — storms likely
const CAPE_SEVERE = 1500;    // J/kg — severe storms
const PRECIP_THRESHOLD = 2;  // mm/h — significant rain
const CLOUD_THRESHOLD = 80;  // % — heavy overcast

// ── Core Predictor ───────────────────────────────────────

export function predictStorm(
  forecast: HourlyForecast[],
  stormAlert: StormAlert,
  stormShadow: StormShadow | null,
  mgWarnings?: MGWarning[],
  recentActivity?: RecentLightningActivity,
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
  // Cloud cover alone is a weak storm signal — only counts when other signals active
  const hasOtherSignals = capeSignal.active || precipSignal.active;
  const cloudSignal: StormSignal = {
    name: 'Nubosidad',
    active: maxCloud >= CLOUD_THRESHOLD && hasOtherSignals,
    value: `${maxCloud.toFixed(0)}%`,
    // Clouds alone = 0 weight. Only amplifies when CAPE or precip present
    weight: !hasOtherSignals ? 0 : maxCloud >= 95 ? 0.08 : maxCloud >= CLOUD_THRESHOLD ? 0.04 : 0,
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
  //
  // Weight 0 since v2.90.0 — measured, not assumed. Across 1212 predictions
  // checked against reality (Apr-Jul 2026), windows where this fired saw
  // lightning 22.9% of the time versus 45.9% when it did not: it predicted the
  // OPPOSITE of what it claimed, while firing in 64% of all windows and adding
  // probability every time.
  //
  // The physics say the same thing. The detector reads a drop in solar
  // radiation and calls it "the storm's cloud arriving", but what it actually
  // reads is "it is cloudy" — and an overcast Galician afternoon never builds
  // the CAPE a convective storm needs. The confounder (ordinary cloud) is the
  // overwhelming majority of hits.
  //
  // Still computed and still pushed: the signal keeps its slot in the storage
  // contract (storm_predictions.signal_shadow) so we go on measuring it, and
  // the shadow detector stays useful elsewhere. Give it weight again only when
  // it can tell convective cloud from stratiform — and only with numbers.
  const shadowSignal: StormSignal = {
    name: 'Sombra de tormenta',
    active: stormShadow != null && stormShadow.confidence > 40,
    value: stormShadow ? `${stormShadow.confidence}% confianza, ${stormShadow.shadowedStations.length} estaciones` : 'No detectada',
    weight: 0,
  };
  signals.push(shadowSignal);
  probability += shadowSignal.weight * 100;

  // ── 7. Wind gusts forecast ──
  //
  // Weight 0 since v2.90.0 — same audit: 31.8% of windows with gusts forecast
  // saw lightning versus 31.2% without. A 0.6 point lift is not a signal, it
  // is the base rate. Kept in the list for its storage slot and its display
  // value; it was paying rent on the probability for nothing.
  const maxGusts = Math.max(0, ...next3h.map((f) => f.windGusts ?? 0));
  const gustSignal: StormSignal = {
    name: 'Rachas previstas',
    active: maxGusts > 10, // >10 m/s = ~20kt
    value: `${(maxGusts * 1.944).toFixed(0)} kt`,
    weight: 0,
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
  // Lightning confirmation required for severe/extreme — CAPE alone is potential, not actual.
  //
  // Temporal hysteresis (fixes 2026-04-28 bouncing): treat the storm as
  // "electrically active" if EITHER the instantaneous alert fired OR there
  // was sustained recent activity. A 60-90s gap between strikes must not
  // collapse severity to 'none' mid-storm.
  const ra = recentActivity;
  const sustainedRecent = ra != null && ra.count30m >= 30;
  const hasLightning = stormAlert.level !== 'none' || sustainedRecent;
  let severity: StormPrediction['severity'] = 'none';
  if ((maxCape >= CAPE_SEVERE && hasLightning) || (stormAlert.level === 'danger' && maxPrecip > 10)) {
    severity = 'extreme';
  } else if (stormAlert.level === 'danger' || (stormAlert.level === 'warning' && maxCape >= CAPE_HIGH)) {
    severity = 'severe';
  } else if (hasLightning || maxCape >= CAPE_HIGH || probability >= 30) {
    severity = 'moderate';
  }

  // ── Hysteresis floors & anticipation ──
  // 1. Heavy recent activity + instability → at least 'severe' even if the
  //    last poll happened to land in a lull (the 17:07/18:02 misses).
  if (ra != null && ra.count30m >= 200 && maxCape >= CAPE_HIGH && severity !== 'extreme') {
    severity = 'severe';
  }
  // 2. Storm was clearly active in the last 30 min but the instantaneous
  //    state is calm → never report 'none'. Hold 'moderate' so the user
  //    isn't told "all clear" 1 minute after a severe alert.
  if (ra != null && ra.count30m >= 30 && severity === 'none') {
    severity = 'moderate';
  }
  // 3. Pre-storm anticipation: strong instability building, no strikes YET.
  //    This is the 11:00-13:00 miss — CAPE 1500+/LI<-4/overcast for hours
  //    while the predictor sat at 'none'. Bump to 'moderate' so the user
  //    gets a heads-up before the first strike.
  if (
    severity === 'none' &&
    maxCape >= CAPE_SEVERE &&
    minLI < -4 &&
    maxCloud >= CLOUD_THRESHOLD &&
    (ra == null || ra.count30m === 0)
  ) {
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
