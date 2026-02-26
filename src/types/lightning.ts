/** Raw GeoJSON feature from IDEG MapServer lightning query */
export interface LightningStrike {
  id: number;
  lat: number;
  lon: number;
  /** Unix timestamp in milliseconds (UTC) */
  timestamp: number;
  /** Peak current in kA (negative = negative polarity) */
  peakCurrent: number;
  /** 0 = cloud-to-ground, 1 = intra-cloud */
  cloudToCloud: boolean;
  /** Number of return strokes */
  multiplicity: number;
  /** Age in minutes from now (computed client-side) */
  ageMinutes: number;
}

/** Proximity alert level for reservoir area */
export type StormAlertLevel = 'none' | 'watch' | 'warning' | 'danger';

export interface StormAlert {
  level: StormAlertLevel;
  /** Distance in km of nearest strike to reservoir center */
  nearestKm: number;
  /** Number of strikes in last 30 min within alert radius */
  recentCount: number;
  /** Trend: 'approaching' if storm getting closer, 'receding' if moving away */
  trend: 'approaching' | 'receding' | 'stationary' | 'none';
  /** Timestamp of last update */
  updatedAt: Date;
}
