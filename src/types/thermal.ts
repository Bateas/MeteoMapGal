// ── Micro-zone system ──────────────────────────────────────

export type MicroZoneId = 'embalse' | 'ourense' | 'norte' | 'sur' | 'carballino';

export type AlertLevel = 'none' | 'low' | 'medium' | 'high';

export interface MicroZone {
  id: MicroZoneId;
  name: string;
  /** Station name patterns (case-insensitive substring match against station.name) */
  stationPatterns: string[];
  center: { lat: number; lon: number };
  /** GeoJSON-style polygon [lon, lat][] for map overlay */
  polygon: [number, number][];
  color: string;
  /** Average altitude for the zone (meters) */
  avgAltitude: number;
}

// ── Direction range (supports 0/360 wraparound) ──────────

export interface DirectionRange {
  from: number; // degrees 0-360
  to: number;   // degrees 0-360 (can be < from for wraparound)
}

// ── Thermal wind rules ───────────────────────────────────

export interface ThermalWindRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  conditions: {
    minTemp?: number;        // °C
    maxTemp?: number;        // °C
    minHumidity?: number;    // %
    maxHumidity?: number;    // %
    timeWindow?: { from: number; to: number }; // hours (0-23)
    /** Months (1-12) when this rule applies */
    months?: number[];
  };
  expectedWind: {
    zone: MicroZoneId;
    directionRange: DirectionRange;
    minSpeed: number;  // m/s
  };
  /** Source: 'historical' = derived from data, 'manual' = user-defined */
  source: 'historical' | 'manual';
}

// ── Scoring ──────────────────────────────────────────────

export interface ScoreBreakdown {
  temperature: number;   // 0-25
  humidity: number;      // 0-20
  timeOfDay: number;     // 0-15
  season: number;        // 0-10
  windDirection: number; // 0-15
  windSpeed: number;     // 0-15
}

export interface RuleScore {
  ruleId: string;
  score: number;          // 0-100
  breakdown: ScoreBreakdown;
  matchedZone: MicroZoneId;
}

export interface ZoneAlert {
  zoneId: MicroZoneId;
  maxScore: number;
  activeRules: RuleScore[];
  alertLevel: AlertLevel;
}

// ── Wind propagation ─────────────────────────────────────

export interface PropagationEvent {
  sourceZone: MicroZoneId;
  targetZone: MicroZoneId;
  /** Direction shift in degrees over the observation window */
  directionShift: number;
  /** Estimated minutes until the shift reaches target zone */
  estimatedArrivalMin: number;
  /** When the event was detected */
  detectedAt: Date;
}

// ── Forecast ─────────────────────────────────────────────

export interface ForecastPoint {
  timestamp: Date;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  windDirection: number | null;
}

export interface ForecastAlert {
  ruleId: string;
  zoneId: MicroZoneId;
  expectedTime: Date;
  score: number;
}

// ── Historical analysis ──────────────────────────────────

export interface HistoricalPattern {
  /** Temperature range [min, max] °C */
  tempRange: [number, number];
  /** Humidity range [min, max] % */
  humidityRange: [number, number];
  /** Hour range [from, to] (0-23) */
  hourRange: [number, number];
  /** Wind direction distribution: cardinal → frequency (0-1) */
  directionDistribution: Record<string, number>;
  /** Dominant wind direction */
  dominantDirection: string;
  /** Frequency of dominant direction (0-1) */
  dominantFrequency: number;
  /** Average wind speed when pattern matches (m/s) */
  avgWindSpeed: number;
  /** Number of data points in this bucket */
  sampleCount: number;
}

export interface HistoricalAnalysisResult {
  location: { lat: number; lon: number };
  periodStart: string;
  periodEnd: string;
  patterns: HistoricalPattern[];
  suggestedRules: ThermalWindRule[];
}
