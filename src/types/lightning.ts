import type { StormCluster } from '../services/stormTracker';

/** Lightning strike from MeteoGalicia meteo2api raios/lenda endpoint */
export interface LightningStrike {
  id: number;
  lat: number;
  lon: number;
  /** Unix timestamp in milliseconds (UTC) */
  timestamp: number;
  /** Peak current in kA */
  peakCurrent: number;
  /** True for intra-cloud, false for cloud-to-ground */
  cloudToCloud: boolean;
  /** Number of return strokes (1 if not provided by API) */
  multiplicity: number;
  /** Age in minutes from now (computed client-side) */
  ageMinutes: number;
}

/**
 * Alert levels — unified color scheme:
 * - none:    green/blue = all clear
 * - watch:   yellow = elevated instability (CAPE high, distant activity)
 * - warning: orange = storm approaching (<25 km)
 * - danger:  red = storm overhead or imminent (<5 km)
 */
export type StormAlertLevel = 'none' | 'watch' | 'warning' | 'danger';

export interface StormAlert {
  level: StormAlertLevel;
  /** Distance in km of nearest strike to reservoir center */
  nearestKm: number;
  /** Number of strikes in last 30 min within alert radius */
  recentCount: number;
  /** Trend: 'approaching' if storm getting closer, 'receding' if moving away */
  trend: 'approaching' | 'receding' | 'stationary' | 'none';
  /** Estimated time of arrival in minutes (from cluster velocity) — null if unknown */
  etaMinutes: number | null;
  /** Storm cluster velocity in km/h — null if no cluster tracking available */
  speedKmh: number | null;
  /** Storm cluster bearing in degrees — null if no tracking */
  bearingDeg: number | null;
  /** Detected storm clusters */
  clusters: StormCluster[];
  /** Timestamp of last update */
  updatedAt: Date;
}
