/**
 * Unified Alert Service — normalizes ALL alert sources into a single
 * prioritized list for the AlertPanel.
 *
 * Each subsystem (storm, inversion, thermal, campo) emits alerts with a
 * common shape, scored 0-100 with severity levels. The composite risk
 * index is the weighted maximum across all active alerts.
 */

import type { FieldAlerts, AlertLevel as CampoAlertLevel } from '../types/campo';
import type { StormAlert, StormAlertLevel } from '../types/lightning';
import type { ThermalProfile, ThermalStatus } from './lapseRateService';
import type { ZoneAlert, MicroZoneId } from '../types/thermal';
import type { HourlyForecast } from '../types/forecast';
import type { StormShadow } from './stormShadowDetector';
import { buildInversionForecastAlert } from './inversionForecastService';
import { buildPressureTrendAlerts } from './pressureTrendService';
import { buildMaritimeFogAlerts } from './maritimeFogService';
import { buildCrossSeaAlerts } from './crossSeaService';
import type { BuoyReading } from '../api/buoyClient';
import type { TeleconnectionIndex } from '../api/naoClient';

// ── NAO/AO context helpers ──────────────────────────────────

/** Translate NAO/AO phase into actionable Spanish context for alert details */
function naoContext(nao: TeleconnectionIndex | undefined): string | null {
  if (!nao) return null;
  const v = nao.value;
  if (v > 1.5) return 'NAO muy positiva: borrascas atlánticas activas';
  if (v > 0.5) return 'NAO positiva: flujo atlántico activo';
  if (v < -1.5) return 'NAO muy negativa: bloqueo severo, frío persistente';
  if (v < -0.5) return 'NAO negativa: bloqueo anticiclónico, calmas';
  return null; // neutral — no context worth adding
}

function aoContext(ao: TeleconnectionIndex | undefined): string | null {
  if (!ao) return null;
  const v = ao.value;
  if (v < -1.5) return 'AO negativa: irrupciones de aire ártico probables';
  if (v < -0.5) return 'AO negativa: vórtice polar débil, frío posible';
  if (v > 1.5) return 'AO positiva: chorro polar fuerte, westerlies activos';
  return null; // neutral or moderate positive — not notable
}

// ── Unified Alert Types ──────────────────────────────────────

export type AlertCategory =
  | 'storm'          // ⛈️  Tormenta eléctrica
  | 'inversion'      // 🌡️  Inversión térmica
  | 'thermal'        // 🌬️  Viento térmico
  | 'frost'          // ❄️  Helada
  | 'fog'            // 🌫️  Niebla
  | 'rain'           // 🌧️  Lluvia / Granizo
  | 'drone'          // 🛩️  Vuelo dron
  | 'wind-front'     // 📡  Frente de viento
  | 'pressure';      // 📊  Tendencia barométrica

export type AlertSeverity = 'info' | 'moderate' | 'high' | 'critical';

export interface UnifiedAlert {
  id: string;                          // e.g., "storm-main", "frost-forecast"
  category: AlertCategory;
  severity: AlertSeverity;
  score: number;                       // 0-100 (weighted composite score)
  icon: string;                        // IconId from WeatherIcons
  title: string;                       // Short label (Spanish)
  detail: string;                      // 1-line description (Spanish)
  /** If true, the alert pulses / demands attention */
  urgent: boolean;
  /** When the alert was last computed */
  updatedAt: Date;
  /** Optional: which zone/area is affected */
  zoneId?: MicroZoneId;
}

export interface CompositeRisk {
  /** Overall risk score 0-100 (weighted max across all alerts) */
  score: number;
  /** Highest severity across all alerts */
  severity: AlertSeverity;
  /** Semaphore color for quick visual */
  color: 'green' | 'yellow' | 'orange' | 'red';
  /** Total number of active alerts (severity > info) */
  activeCount: number;
}

// ── Category weights (higher = more dangerous) ──────────────

const CATEGORY_WEIGHT: Record<AlertCategory, number> = {
  'storm':       3.0,   // Life-threatening
  'frost':       2.0,   // Crop damage
  'inversion':   1.8,   // Air quality + sailing impact
  'rain':        1.5,   // Crop / flood
  'fog':         1.2,   // Visibility
  'thermal':     1.0,   // Sailing / recreation
  'wind-front':  1.0,   // Propagation info
  'pressure':    2.5,   // Early storm indicator
  'drone':       0.5,   // Convenience
};

// ── Conversion helpers ───────────────────────────────────────

function severityFromScore(score: number): AlertSeverity {
  // Thresholds calibrated so "PELIGRO" (critical) is reserved for truly dangerous
  // situations: confirmed storms, severe frost, extreme wind — NOT for dense clouds
  // or light rain forecasts. Most common weather events stay at moderate/high.
  if (score >= 85) return 'critical';
  if (score >= 55) return 'high';
  if (score >= 25) return 'moderate';
  return 'info';
}

function colorFromSeverity(severity: AlertSeverity): 'green' | 'yellow' | 'orange' | 'red' {
  switch (severity) {
    case 'critical': return 'red';
    case 'high':     return 'orange';
    case 'moderate': return 'yellow';
    default:         return 'green';
  }
}

// ── Storm alerts → UnifiedAlert ──────────────────────────────

function stormAlertScore(level: StormAlertLevel, nearestKm: number): number {
  switch (level) {
    case 'danger':  return 95;
    case 'warning': return 60 + Math.max(0, (25 - nearestKm) * 1.4); // 60-95
    case 'watch':   return 25 + Math.max(0, (50 - nearestKm) * 0.7); // 25-60
    default:        return 0;
  }
}

export function buildStormAlerts(storm: StormAlert): UnifiedAlert[] {
  if (storm.level === 'none') return [];

  const score = stormAlertScore(storm.level, storm.nearestKm);
  const labels: Record<StormAlertLevel, string> = {
    danger: 'PELIGRO — Tormenta encima',
    warning: 'AVISO — Tormenta acercándose',
    watch: 'VIGILANCIA — Actividad eléctrica',
    none: '',
  };

  let detail = `${storm.nearestKm.toFixed(0)} km, ${storm.recentCount} rayos recientes`;
  if (storm.trend === 'approaching' && storm.etaMinutes != null) {
    detail += ` · ETA ~${storm.etaMinutes.toFixed(0)} min`;
  } else if (storm.trend === 'receding') {
    detail += ' · alejándose';
  }

  return [{
    id: 'storm-main',
    category: 'storm',
    severity: severityFromScore(score),
    score,
    icon: 'zap',
    title: labels[storm.level],
    detail,
    urgent: storm.level === 'danger' || (storm.level === 'warning' && storm.trend === 'approaching'),
    updatedAt: storm.updatedAt,
  }];
}

// ── Inversion alerts → UnifiedAlert ──────────────────────────

export function buildInversionAlerts(
  profile: ThermalProfile | null,
  nao?: TeleconnectionIndex,
  ao?: TeleconnectionIndex,
): UnifiedAlert[] {
  if (!profile || !profile.hasInversion || !profile.regression) return [];

  const { slopePerKm, rSquared, stationCount } = profile.regression;
  const isStrong = profile.status === 'strong-inversion';

  // ── Nocturnal inversion filter ────────────────────────────
  const hour = new Date().getHours();
  const isNight = hour >= 21 || hour < 7;
  if (isNight && !isStrong) return [];

  // Score: slope +1 to +10 → 30 to 100, scaled by R²
  const rawScore = Math.min(100, 30 + (slopePerKm - 1) * 7.8);
  const score = Math.round(rawScore * Math.min(1, rSquared / 0.5));

  const title = isStrong ? 'INVERSIÓN FUERTE' : 'Inversión térmica detectada';
  const nightNote = isNight ? ' (nocturna persistente)' : '';
  let detail = `${slopePerKm > 0 ? '+' : ''}${slopePerKm.toFixed(1)}°C/km · ${stationCount} est. · R²=${rSquared.toFixed(2)}${nightNote}`;

  // NAO/AO context: negative NAO = blocking pattern sustains inversions
  if (nao && nao.value < -0.5) detail += ' · NAO−: bloqueo persistente';
  else if (ao && ao.value < -0.5) detail += ' · AO−: aire frío atrapado';

  return [{
    id: 'inversion-main',
    category: 'inversion',
    severity: isStrong ? 'high' : 'moderate',
    score,
    icon: 'thermometer',
    title,
    detail,
    urgent: isStrong && rSquared >= 0.5,
    updatedAt: new Date(),
  }];
}

// ── Thermal wind alerts → UnifiedAlert ───────────────────────

export function buildThermalAlerts(
  zoneAlerts: Map<MicroZoneId, ZoneAlert>,
): UnifiedAlert[] {
  const results: UnifiedAlert[] = [];

  for (const [zoneId, za] of zoneAlerts) {
    if (za.alertLevel === 'none') continue;

    const score = za.maxScore;
    const levelLabel = za.alertLevel === 'high' ? 'ALTO' : za.alertLevel === 'medium' ? 'MEDIO' : 'BAJO';

    results.push({
      id: `thermal-${zoneId}`,
      category: 'thermal',
      severity: za.alertLevel === 'high' ? 'high' : za.alertLevel === 'medium' ? 'moderate' : 'info',
      score,
      icon: 'thermal-wind',
      title: `Térmico ${levelLabel} — ${zoneId}`,
      detail: `${score}% — ${za.activeRules.length} regla(s) activa(s)`,
      urgent: za.alertLevel === 'high' && score >= 70,
      updatedAt: new Date(),
      zoneId,
    });
  }
  return results;
}

// ── Storm shadow alerts → UnifiedAlert ───────────────────────

export function buildStormShadowAlerts(shadow: StormShadow | null): UnifiedAlert[] {
  if (!shadow || shadow.confidence < 40) return [];

  const now = new Date();
  const score = Math.min(95, shadow.confidence);
  const hasLightning = shadow.lightningNearby > 0;
  const hasWindConfirmation = shadow.windContext !== null && shadow.windContext.outflowCount > 0;

  // ── Contextual title based on lightning presence ──
  let title: string;
  if (shadow.etaMinutes !== null) {
    title = hasLightning
      ? `Tormenta acercándose — ETA ~${shadow.etaMinutes} min`
      : `Nubosidad densa acercándose — ETA ~${shadow.etaMinutes} min`;
  } else if (hasLightning) {
    title = 'Tormenta cercana detectada';
  } else {
    title = 'Nubosidad densa detectada';
  }

  // ── Detail ──
  let detail = `${shadow.shadowedStations.length} estación(es) afectada(s)`;

  if (shadow.movementSpeedKmh !== null) {
    detail += ` · ${shadow.movementSpeedKmh.toFixed(0)} km/h`;
  }
  if (shadow.movementBearing !== null) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const idx = Math.round(shadow.movementBearing / 45) % 8;
    detail += ` hacia ${dirs[idx]}`;
  }
  if (shadow.etaMinutes !== null) {
    detail += ` · ETA ~${shadow.etaMinutes} min al embalse`;
  }

  // Lightning context
  if (hasLightning) {
    detail += ` · ${shadow.lightningNearby} rayo(s)`;
  } else {
    detail += ' · Caída de radiación solar. Sin rayos por ahora.';
  }

  // Wind anomaly context
  if (shadow.windContext) {
    if (shadow.windContext.outflowCount > 0) {
      detail += ` · ${shadow.windContext.outflowCount} estación(es) con viento de tormenta`;
    } else if (shadow.windContext.gustCount > 0) {
      detail += ` · ${shadow.windContext.gustCount} racha(s) detectada(s)`;
    }
  }

  // ── Severity: downgrade when no lightning and no wind confirmation ──
  let severity: AlertSeverity;
  if (shadow.etaMinutes !== null && shadow.etaMinutes < 30) {
    severity = 'high';
  } else if (hasWindConfirmation) {
    severity = 'high';
  } else if (hasLightning && shadow.confidence >= 60) {
    severity = 'moderate';
  } else if (!hasLightning) {
    // No lightning, no wind outflow → just dense clouds, lower severity
    severity = shadow.confidence >= 70 ? 'moderate' : 'info';
  } else {
    severity = shadow.confidence >= 60 ? 'moderate' : 'info';
  }

  // Cap score for non-confirmed events: dense clouds without lightning or wind
  // outflow are NOT dangerous — just notable. Prevents "PELIGRO" for plain clouds.
  let finalScore = score;
  if (!hasLightning && !hasWindConfirmation) {
    finalScore = Math.min(45, score); // max "moderate" — just clouds
  } else if (hasWindConfirmation) {
    finalScore = Math.min(100, score + 10);
  }

  return [{
    id: 'storm-shadow',
    category: 'storm',
    severity,
    score: finalScore,
    icon: hasLightning ? 'zap' : 'cloud',
    title,
    detail,
    urgent: (shadow.etaMinutes !== null && shadow.etaMinutes < 20) || hasWindConfirmation,
    updatedAt: now,
  }];
}

// ── Campo (field) alerts → UnifiedAlert ──────────────────────

function campoLevelToScore(level: CampoAlertLevel): number {
  switch (level) {
    case 'critico': return 85;
    case 'alto':    return 55;
    case 'riesgo':  return 30;
    default:        return 0;
  }
}

export function buildFieldAlerts(
  field: FieldAlerts | null,
  nao?: TeleconnectionIndex,
  ao?: TeleconnectionIndex,
): UnifiedAlert[] {
  if (!field) return [];
  const now = new Date();
  const results: UnifiedAlert[] = [];

  // Frost
  if (field.frost.level !== 'none') {
    const score = campoLevelToScore(field.frost.level);
    const tempStr = field.frost.minTemp != null ? `${field.frost.minTemp.toFixed(1)}°C` : '?';
    let frostDetail = `Mín prevista ${tempStr}`;
    // NAO/AO context: negative phases amplify and sustain cold events
    if (nao && nao.value < -1) frostDetail += ' · NAO−: patrón frío persistente';
    else if (ao && ao.value < -1) frostDetail += ' · AO−: aire ártico activo';
    results.push({
      id: 'frost-forecast',
      category: 'frost',
      severity: severityFromScore(score),
      score,
      icon: 'snowflake',
      title: field.frost.level === 'critico' ? 'HELADA SEVERA' : 'Riesgo de helada',
      detail: frostDetail,
      urgent: field.frost.level === 'critico',
      updatedAt: now,
    });
  }

  // Rain / Hail
  if (field.rain.level !== 'none') {
    const score = campoLevelToScore(field.rain.level);

    // Temporal context: WHEN is rain expected?
    let timeLabel: string;
    if (field.rain.hoursUntilRain !== null && field.rain.hoursUntilRain <= 1) {
      timeLabel = 'inminente';
    } else if (field.rain.hoursUntilRain !== null && field.rain.hoursUntilRain <= 3) {
      timeLabel = `en ~${Math.round(field.rain.hoursUntilRain)}h`;
    } else if (field.rain.firstRainAt) {
      timeLabel = `~${field.rain.firstRainAt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
    } else {
      timeLabel = 'próximas horas';
    }

    let detail = `${field.rain.maxPrecip.toFixed(1)} mm/h · ${timeLabel}`;
    if (field.rain.rainAccum6h > 0) detail += ` · ${field.rain.rainAccum6h}mm en 6h`;
    if (field.rain.hailRisk) detail += ' · GRANIZO';

    // Title reflects imminence
    let title: string;
    if (field.rain.hailRisk) {
      title = 'Riesgo de GRANIZO';
    } else if (field.rain.hoursUntilRain !== null && field.rain.hoursUntilRain <= 1) {
      title = 'Lluvia inminente';
    } else {
      title = 'Lluvia prevista';
    }

    results.push({
      id: 'rain-forecast',
      category: 'rain',
      severity: severityFromScore(score),
      score: Math.min(100, field.rain.hailRisk ? score + 20 : score),
      icon: field.rain.hailRisk ? 'hail' : 'cloud-rain',
      title,
      detail,
      urgent: field.rain.hailRisk || field.rain.level === 'critico',
      updatedAt: now,
    });
  }

  // Fog
  if (field.fog.level !== 'none') {
    const score = campoLevelToScore(field.fog.level);
    const spreadStr = field.fog.spread != null ? `ΔT=${field.fog.spread.toFixed(1)}°C` : '';
    results.push({
      id: 'fog-alert',
      category: 'fog',
      severity: severityFromScore(score),
      score,
      icon: 'fog',
      title: field.fog.level === 'critico' ? 'NIEBLA INMINENTE' : 'Riesgo de niebla',
      detail: `${spreadStr} · ${field.fog.confidence}% confianza`,
      urgent: field.fog.level === 'critico',
      updatedAt: now,
    });
  }

  // Drone — meteo conditions (score scales with reason count)
  if (!field.drone.flyable) {
    const droneReasons = field.drone.reasons.length;
    const droneScore = Math.min(100, 30 + droneReasons * 15); // 1 reason=45, 2=60, 3=75
    results.push({
      id: 'drone-nogo',
      category: 'drone',
      severity: severityFromScore(droneScore),
      score: droneScore,
      icon: 'drone',
      title: 'Dron: Precaución',
      detail: field.drone.reasons.slice(0, 2).join(' · '),
      urgent: false,
      updatedAt: now,
    });
  }

  // Drone — airspace restrictions: shown only in FieldDrawer Dron panel, not in general AlertPanel
  // (broad zone coverage doesn't warrant a persistent map-center alert)

  // Wind propagation: shown as ETA badge in Header bar, not in AlertPanel
  // (ETA is actionable time info that fits better in the persistent top bar)

  return results;
}

// ── Composite risk index ─────────────────────────────────────

/**
 * Compute composite risk from all active alerts.
 *
 * Uses weighted-max: the highest (score × weight) determines overall risk.
 * Weights amplify dangerous categories (storm ×3.0) and suppress low-impact
 * ones (drone ×0.5). The final score is normalized by dividing by the
 * HIGHEST weight among active alerts, so the weight hierarchy is preserved.
 *
 * Example with raw score 55:
 *   storm  (×3.0): 55×3.0 = 165, /3.0 = 55  → weights matter
 *   frost  (×2.0): 55×2.0 = 110, /3.0 = 37  → deprioritized vs storm
 *   fog    (×1.2): 55×1.2 =  66, /3.0 = 22  → further deprioritized
 *   drone  (×0.5): 55×0.5 =  28, /3.0 =  9  → low composite impact
 */
export function computeCompositeRisk(alerts: UnifiedAlert[]): CompositeRisk {
  if (alerts.length === 0) {
    return { score: 0, severity: 'info', color: 'green', activeCount: 0 };
  }

  // Weighted max: the highest (score × weight) determines overall risk
  let maxWeightedScore = 0;
  let maxWeight = 1;
  let activeCount = 0;

  for (const a of alerts) {
    if (a.severity !== 'info') activeCount++;
    const weight = CATEGORY_WEIGHT[a.category] ?? 1;
    const weighted = a.score * weight;
    if (weighted > maxWeightedScore) {
      maxWeightedScore = weighted;
      maxWeight = weight;
    }
  }

  // Normalize by the winning alert's own weight → preserves its raw score,
  // while alerts from lighter categories get scaled down proportionally
  // when they compete via maxWeightedScore.
  const finalScore = Math.min(100, Math.round(maxWeightedScore / maxWeight));
  const severity = severityFromScore(finalScore);

  return {
    score: finalScore,
    severity,
    color: colorFromSeverity(severity),
    activeCount,
  };
}

/** Append NAO context to pressure trend alerts (enrichment at call site) */
function enrichPressureAlerts(alerts: UnifiedAlert[], nao?: TeleconnectionIndex): UnifiedAlert[] {
  if (!nao || alerts.length === 0) return alerts;
  const ctx = naoContext(nao);
  if (!ctx) return alerts;
  return alerts.map((a) => ({ ...a, detail: `${a.detail} · ${ctx}` }));
}

// ── Main aggregator — call this from AppShell ────────────────

export function aggregateAllAlerts(sources: {
  stormAlert: StormAlert | null;
  thermalProfile: ThermalProfile | null;
  zoneAlerts: Map<MicroZoneId, ZoneAlert>;
  fieldAlerts: FieldAlerts | null;
  forecast?: HourlyForecast[];
  stormShadow?: StormShadow | null;
  currentReadings?: Map<string, import('../types/station').NormalizedReading>;
  readingHistory?: Map<string, import('../types/station').NormalizedReading[]>;
  buoys?: BuoyReading[];
  stationsGeo?: { id: string; lat: number; lon: number }[];
  teleconnections?: TeleconnectionIndex[];
}): { alerts: UnifiedAlert[]; risk: CompositeRisk } {
  // Extract NAO/AO for context enrichment
  const nao = sources.teleconnections?.find((t) => t.name === 'NAO');
  const ao = sources.teleconnections?.find((t) => t.name === 'AO');

  const allAlerts: UnifiedAlert[] = [
    ...(sources.stormAlert ? buildStormAlerts(sources.stormAlert) : []),
    ...buildStormShadowAlerts(sources.stormShadow ?? null),
    ...buildInversionAlerts(sources.thermalProfile, nao, ao),
    ...(sources.forecast ? buildInversionForecastAlert(sources.forecast) : []),
    ...buildThermalAlerts(sources.zoneAlerts),
    ...buildFieldAlerts(sources.fieldAlerts, nao, ao),
    ...(sources.currentReadings && sources.readingHistory
      ? enrichPressureAlerts(buildPressureTrendAlerts(sources.currentReadings, sources.readingHistory), nao) : []),
    ...(sources.buoys && sources.currentReadings && sources.stationsGeo
      ? buildMaritimeFogAlerts(sources.buoys, sources.currentReadings, sources.stationsGeo) : []),
    ...(sources.buoys ? buildCrossSeaAlerts(sources.buoys) : []),
  ];

  // ── Category dedup: merge alerts from same category into one ──
  // When multiple services emit for the same phenomenon (e.g., fog-alert + maritime-fog),
  // keep the highest-score alert and append other sources' context to its detail.
  const dedupedAlerts = deduplicateByCategory(allAlerts);

  // Sort by score descending (highest priority first)
  dedupedAlerts.sort((a, b) => b.score - a.score);

  return {
    alerts: dedupedAlerts,
    risk: computeCompositeRisk(dedupedAlerts),
  };
}

/**
 * Merge alerts that share the same category into a single alert per category.
 * - Winner: the alert with the highest score
 * - Detail: winner's detail + " · También: " + losers' titles (abbreviated)
 * - Score: max score across merged alerts
 * - Severity: highest severity across merged alerts
 *
 * Exception: 'thermal' alerts are NOT merged (each zone is independent).
 */
function deduplicateByCategory(alerts: UnifiedAlert[]): UnifiedAlert[] {
  const categoryMap = new Map<AlertCategory, UnifiedAlert[]>();

  for (const alert of alerts) {
    const existing = categoryMap.get(alert.category);
    if (existing) existing.push(alert);
    else categoryMap.set(alert.category, [alert]);
  }

  const result: UnifiedAlert[] = [];

  for (const [category, group] of categoryMap) {
    // Thermal alerts: keep all (each zone is independent)
    if (category === 'thermal') {
      result.push(...group);
      continue;
    }

    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    // Sort by score desc, then by severity
    group.sort((a, b) => b.score - a.score);
    const winner = { ...group[0] };

    // Merge: upgrade severity if any secondary is higher
    const SEVERITY_ORDER: Record<AlertSeverity, number> = { info: 0, moderate: 1, high: 2, critical: 3 };
    for (let i = 1; i < group.length; i++) {
      if (SEVERITY_ORDER[group[i].severity] > SEVERITY_ORDER[winner.severity]) {
        winner.severity = group[i].severity;
      }
      if (group[i].urgent) winner.urgent = true;
    }

    // Append secondary sources' titles to detail
    const secondaryTitles = group.slice(1).map(a => a.title);
    winner.detail += ` · También: ${secondaryTitles.join(', ')}`;

    result.push(winner);
  }

  return result;
}
