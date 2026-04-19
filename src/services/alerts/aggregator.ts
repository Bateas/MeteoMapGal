/**
 * Alert aggregator — merges all alert sources into a single prioritized list.
 *
 * `aggregateAllAlerts()` is the main entry point called from AppShell.
 * Handles deduplication, NAO/AO context enrichment, and sorting.
 */

import type { FieldAlerts } from '../../types/campo';
import type { StormAlert } from '../../types/lightning';
import type { ThermalProfile } from '../lapseRateService';
import type { MicroZoneId, ZoneAlert } from '../../types/thermal';
import type { HourlyForecast } from '../../types/forecast';
import type { StormShadow } from '../stormShadowDetector';
import type { BuoyReading } from '../../api/buoyClient';
import type { SSTSnapshot } from '../../store/buoyStore';
import type { TeleconnectionIndex } from '../../api/naoClient';
import type { AlertCategory, AlertSeverity, CompositeRisk, UnifiedAlert } from './types';
import { buildStormAlerts, buildStormShadowAlerts } from './stormAlerts';
import { buildInversionAlerts, buildThermalAlerts } from './thermalAlerts';
import { buildFieldAlerts } from './fieldAlerts';
import { computeCompositeRisk } from './riskEngine';
import { buildInversionForecastAlert } from '../inversionForecastService';
import { buildPressureTrendAlerts } from '../pressureTrendService';
import { buildMaritimeFogAlerts } from '../maritimeFogService';
import { buildCrossSeaAlerts } from '../crossSeaService';
import { buildUpwellingAlerts } from '../upwellingService';
import { buildWindTrendAlerts } from './windTrendAlerts';
import { buildRainAlerts } from './rainAlerts';

// ── NAO/AO context helpers ──────────────────────────────────

/** Translate NAO/AO phase into actionable Spanish context for alert details */
export function naoContext(nao: TeleconnectionIndex | undefined): string | null {
  if (!nao) return null;
  const v = nao.value;
  if (v > 1.5) return 'NAO muy positiva: borrascas atlánticas activas';
  if (v > 0.5) return 'NAO positiva: flujo atlántico activo';
  if (v < -1.5) return 'NAO muy negativa: bloqueo severo, frío persistente';
  if (v < -0.5) return 'NAO negativa: bloqueo anticiclónico, calmas';
  return null; // neutral — no context worth adding
}

export function aoContext(ao: TeleconnectionIndex | undefined): string | null {
  if (!ao) return null;
  const v = ao.value;
  if (v < -1.5) return 'AO negativa: irrupciones de aire ártico probables';
  if (v < -0.5) return 'AO negativa: vórtice polar débil, frío posible';
  if (v > 1.5) return 'AO positiva: chorro polar fuerte, westerlies activos';
  return null; // neutral or moderate positive — not notable
}

/** Append NAO context to pressure trend alerts (enrichment at call site) */
export function enrichPressureAlerts(alerts: UnifiedAlert[], nao?: TeleconnectionIndex): UnifiedAlert[] {
  if (!nao || alerts.length === 0) return alerts;
  const ctx = naoContext(nao);
  if (!ctx) return alerts;
  return alerts.map((a) => ({ ...a, detail: `${a.detail} · ${ctx}` }));
}

// ── Category dedup ───────────────────────────────────────────

/**
 * Merge alerts that share the same category into a single alert per category.
 * - Winner: the alert with the highest score
 * - Detail: winner's detail + " · Tambien: " + losers' titles (abbreviated)
 * - Score: max score across merged alerts
 * - Severity: highest severity across merged alerts
 *
 * Exception: 'thermal' alerts are NOT merged (each zone is independent).
 */
export function deduplicateByCategory(alerts: UnifiedAlert[]): UnifiedAlert[] {
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

// ── Main aggregator — call this from AppShell ────────────────

export function aggregateAllAlerts(sources: {
  stormAlert: StormAlert | null;
  thermalProfile: ThermalProfile | null;
  zoneAlerts: Map<MicroZoneId, ZoneAlert>;
  fieldAlerts: FieldAlerts | null;
  forecast?: HourlyForecast[];
  stormShadow?: StormShadow | null;
  currentReadings?: Map<string, import('../../types/station').NormalizedReading>;
  readingHistory?: Map<string, import('../../types/station').NormalizedReading[]>;
  buoys?: BuoyReading[];
  sstHistory?: Map<number, SSTSnapshot[]>;
  stationsGeo?: { id: string; lat: number; lon: number }[];
  teleconnections?: TeleconnectionIndex[];
  /** True if any webcam Vision IA detects fog in the last 30min */
  webcamFogDetected?: boolean;
  /** Number of webcams detecting fog (>=2 triggers independent alert) */
  webcamFogCount?: number;
  /** IDs of webcams reporting fog */
  webcamFogIds?: string[];
  /** Detector points with coords for localized FogOverlay (S122) */
  fogSources?: { lat: number; lon: number; type: 'webcam' | 'station' | 'buoy'; id: string }[];
}): { alerts: UnifiedAlert[]; risk: CompositeRisk } {
  // Extract NAO/AO for context enrichment
  const nao = sources.teleconnections?.find((t) => t.name === 'NAO');
  const ao = sources.teleconnections?.find((t) => t.name === 'AO');

  const allAlerts: UnifiedAlert[] = [
    ...(sources.stormAlert ? buildStormAlerts(sources.stormAlert) : []),
    ...buildStormShadowAlerts(sources.stormShadow ?? null, sources.currentReadings),
    ...buildInversionAlerts(sources.thermalProfile, nao, ao),
    ...(sources.forecast ? buildInversionForecastAlert(sources.forecast) : []),
    ...buildThermalAlerts(sources.zoneAlerts),
    ...buildFieldAlerts(sources.fieldAlerts, nao, ao),
    ...(sources.currentReadings && sources.readingHistory
      ? enrichPressureAlerts(buildPressureTrendAlerts(sources.currentReadings, sources.readingHistory), nao) : []),
    ...(sources.buoys && sources.currentReadings && sources.stationsGeo
      ? buildMaritimeFogAlerts(sources.buoys, sources.currentReadings, sources.stationsGeo, sources.webcamFogDetected, sources.webcamFogCount, sources.webcamFogIds, sources.fogSources) : []),
    ...(sources.buoys ? buildCrossSeaAlerts(sources.buoys) : []),
    ...(sources.buoys && sources.sstHistory ? buildUpwellingAlerts(sources.buoys, sources.sstHistory) : []),
    ...(sources.currentReadings && sources.readingHistory
      ? buildWindTrendAlerts(sources.currentReadings, sources.readingHistory) : []),
    ...buildRainAlerts(sources.forecast),
  ];

  // ── Category dedup: merge alerts from same category into one ──
  const dedupedAlerts = deduplicateByCategory(allAlerts);

  // Sort by score descending (highest priority first)
  dedupedAlerts.sort((a, b) => b.score - a.score);

  return {
    alerts: dedupedAlerts,
    risk: computeCompositeRisk(dedupedAlerts),
  };
}
