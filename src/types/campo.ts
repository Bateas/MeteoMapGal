/**
 * Types for agricultural alerts ("Campo"), wind roses, and best-days search.
 */

// ── Alert levels ─────────────────────────────────────────

export type AlertLevel = 'none' | 'riesgo' | 'alto' | 'critico';

// ── Frost alert ──────────────────────────────────────────

export interface FrostAlert {
  level: AlertLevel;
  /** Minimum forecasted temperature (°C) */
  minTemp: number | null;
  /** ISO window when frost risk is highest */
  timeWindow: { from: Date; to: Date } | null;
  /** Cloud cover during the risk window (%) */
  cloudCover: number | null;
  /** Wind speed during the risk window (m/s) */
  windSpeed: number | null;
}

// ── Rain / hail alert ────────────────────────────────────

export interface RainAlert {
  level: AlertLevel;
  /** Max precipitation in any single hour (mm) */
  maxPrecip: number;
  /** Max precipitation probability (%) */
  maxProbability: number;
  /** Accumulated rain in next 6 hours (mm) */
  rainAccum6h: number;
  /** Hail risk detected (CAPE > 1000 + heavy precip) */
  hailRisk: boolean;
}

// ── Fog / dew point alert ────────────────────────────────

export interface FogAlert {
  level: AlertLevel;
  /** Current dew point (°C), from real station data */
  dewPoint: number | null;
  /** Dew point spread: temp - dewPoint (°C). Smaller → closer to fog. */
  spread: number | null;
  /** Spread trend over last hours: negative = converging → fog likely */
  spreadTrend: number | null; // °C/h
  /** Estimated time when spread could reach 0 (fog forms), null if diverging */
  fogEta: Date | null;
  /** Current humidity (%) */
  humidity: number | null;
  /** Current wind speed (m/s) — calm favors fog */
  windSpeed: number | null;
  /** Confidence in the prediction (0-100) based on data quality/quantity */
  confidence: number;
  /** Human-readable hypothesis */
  hypothesis: string;
}

// ── Drone flight conditions ──────────────────────────────

export interface DroneConditions {
  /** Overall: safe to fly? */
  flyable: boolean;
  /** Current/forecast wind in knots */
  windKt: number;
  /** Current/forecast gust in knots */
  gustKt: number;
  /** Rain expected? */
  rain: boolean;
  /** Storms within range? */
  storms: boolean;
  /** Human-readable reasons why NOT flyable */
  reasons: string[];
  /** Airspace restricted at this location? */
  airspaceRestricted: boolean;
  /** Airspace restriction severity */
  airspaceSeverity: 'none' | 'caution' | 'prohibited';
  /** Airspace restriction reasons */
  airspaceReasons: string[];
  /** Number of active NOTAMs in the area */
  activeNotams: number;
}

// ── Wind propagation alert ───────────────────────────────

export interface WindPropagationInfo {
  /** Is there a propagation event detected? */
  active: boolean;
  /** Dominant wind direction label */
  directionLabel: string;
  /** Number of upwind stations intensifying */
  upwindCount: number;
  /** Average speed increase at upwind stations (kt per 10min) */
  avgIncreaseKt: number;
  /** Current front speed (kt) */
  frontSpeedKt: number;
  /** Estimated arrival at downstream stations (minutes) */
  estimatedArrivalMin: number | null;
  /** Confidence (0-100) */
  confidence: number;
  /** Human-readable summary */
  summary: string;
}

// ── Evapotranspiration (ET₀) ─────────────────────────────

export interface ET0Result {
  /** Estimated daily reference evapotranspiration (mm/day) */
  et0Daily: number | null;
  /** Irrigation advice (Spanish) */
  irrigationAdvice: string;
  /** Alert level based on water demand */
  level: AlertLevel;
}

// ── Disease risk (viticulture) ──────────────────────────

export interface DiseaseRisk {
  mildiu: { risk: boolean; level: AlertLevel; hours: number; detail: string };
  oidio: { risk: boolean; level: AlertLevel; hours: number; detail: string };
}

// ── Growing Degree Days (GDD) ────────────────────────────

export interface GDDInfo {
  /** Accumulated GDD from season start (°C·days), null if no season active */
  accumulated: number | null;
  /** Today's GDD contribution (°C·days) */
  todayGDD: number | null;
  /** Current phenological growth stage (Spanish) */
  growthStage: string;
  /** Growth stage progress within current phase (0-100%) */
  stageProgress: number;
  /** Spanish crop management advice */
  advice: string;
  /** Next phenological milestone */
  nextMilestone: { name: string; gddNeeded: number } | null;
  /** Days since season start */
  daysSinceStart: number;
  /** Alert level (critico during critical phases like flowering) */
  level: AlertLevel;
}

// ── Combined field alerts ────────────────────────────────

export interface FieldAlerts {
  frost: FrostAlert;
  rain: RainAlert;
  fog: FogAlert;
  drone: DroneConditions;
  wind: WindPropagationInfo;
  et0: ET0Result;
  disease: DiseaseRisk;
  gdd: GDDInfo;
  /** Highest alert level across all checks */
  maxLevel: AlertLevel;
}

// ── Wind rose ────────────────────────────────────────────

export interface WindRosePoint {
  /** Cardinal direction label (N, NNE, NE, …) */
  direction: string;
  /** Number of occurrences */
  count: number;
  /** Percentage of total */
  percentage: number;
  /** Average wind speed for this direction (m/s) — for speed-weighted roses */
  avgSpeed?: number;
}

export interface WindRoseData {
  points: WindRosePoint[];
  totalDays: number;
  filters: {
    stationId?: string;
    months?: number[];
    minTemp?: number;
    maxHumidity?: number;
  };
}

// ── Best days search ─────────────────────────────────────

export interface DaySearchCriteria {
  minTemp?: number;
  maxTemp?: number;
  /** Wind direction "from" (degrees) */
  windDirFrom?: number;
  /** Wind direction "to" (degrees) */
  windDirTo?: number;
  minSpeed?: number;  // m/s
  maxSpeed?: number;  // m/s
  maxPrecip?: number; // mm
  /** Months to include (1-12) */
  months?: number[];
}

export interface DaySearchResult {
  fecha: string;
  temp: number;
  wind: number;    // m/s
  dir: number;     // degrees
  precip: number;  // mm
  humidity: number; // %
  gust: number;    // m/s
  /** Match score (0-100) */
  score: number;
}

// ── Telegram alert skeleton ──────────────────────────────

export type AlertType = 'frost' | 'rain' | 'hail' | 'fog' | 'drone_ok' | 'drone_bad';

export interface AlertMessage {
  type: AlertType;
  level: AlertLevel;
  text: string;
  timestamp: Date;
}
