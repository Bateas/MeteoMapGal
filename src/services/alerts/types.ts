/**
 * Shared alert types — used across all alert builders and consumers.
 *
 * Defines the unified alert shape, composite risk index, alert categories,
 * severity levels, and category weights for risk scoring.
 */

import type { MicroZoneId } from '../../types/thermal';

// ── Unified Alert Types ──────────────────────────────────────

export type AlertCategory =
  | 'storm'          // Tormenta eléctrica
  | 'inversion'      // Inversión térmica
  | 'thermal'        // Viento térmico
  | 'frost'          // Helada
  | 'fog'            // Niebla
  | 'rain'           // Lluvia / Granizo
  | 'drone'          // Vuelo dron
  | 'wind-front'     // Frente de viento
  | 'pressure'       // Tendencia barométrica
  | 'marine'         // Mar cruzada / oleaje
  | 'upwelling';     // Afloramiento costero

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
  /** Optional confidence 0-100 (shown as badge in AlertPanel) */
  confidence?: number;
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

export const CATEGORY_WEIGHT: Record<AlertCategory, number> = {
  'storm':       3.0,   // Life-threatening
  'frost':       2.0,   // Crop damage
  'inversion':   1.8,   // Air quality + sailing impact
  'rain':        1.5,   // Crop / flood
  'fog':         1.2,   // Visibility
  'thermal':     1.0,   // Sailing / recreation
  'wind-front':  1.0,   // Propagation info
  'pressure':    2.5,   // Early storm indicator
  'marine':      2.0,   // Cross-sea / wave safety
  'upwelling':   1.0,   // Coastal upwelling info
  'drone':       0.5,   // Convenience
};
