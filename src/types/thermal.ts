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
  temperature: number;      // 0-20 (gradient-based, strong predictor)
  humidity: number;         // 0-20 (AEMET data: strongest discriminator)
  timeOfDay: number;        // 0-15 (reliable, solar cycle)
  season: number;           // 0-15 (month-proportional from 7yr data)
  windDirection: number;    // 0-10 (W dominant 74%, but synoptic can mislead)
  windSpeed: number;        // 0-10 (thermal = 0→7-12kt ramp)
  deltaTContext: number;    // 0-10 (ΔT diurnal range, very strong predictor)
  gustBonus: number;        // 0-5 (strong gusts = established thermal)
  environmentBonus: number; // 0-5 (clear sky + high radiation)
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
  /** Cloud cover percentage (0-100) from Open-Meteo */
  cloudCover: number | null;
  /** Shortwave solar radiation (W/m²) — proxy for clear sky / convection driver */
  solarRadiation: number | null;
  /** Convective Available Potential Energy (J/kg) — direct thermal indicator */
  cape: number | null;
}

export interface ForecastAlert {
  ruleId: string;
  zoneId: MicroZoneId;
  expectedTime: Date;
  score: number;
}

// ── Enhanced atmospheric context ──────────────────────────

/**
 * Extended atmospheric data from Open-Meteo, beyond basic wind/temp/humidity.
 * These parameters improve thermal prediction accuracy:
 * - Cloud cover: clear skies = stronger thermals
 * - Solar radiation: direct energy driving convection
 * - CAPE: thermodynamic measure of convective potential
 */
export interface AtmosphericContext {
  /** Cloud cover % for embalse zone (0 = clear, 100 = overcast) */
  cloudCover: number | null;
  /** Shortwave radiation W/m² at surface */
  solarRadiation: number | null;
  /** CAPE J/kg — >500 = moderate convection, >1000 = strong */
  cape: number | null;
  /** When this context was fetched */
  fetchedAt: Date;
}

// ── Daily context (ΔT scoring from AEMET analysis) ──────

/**
 * Daily-scale context used for ΔT (diurnal temperature range) scoring.
 * AEMET station data shows ΔT > 20°C → 42% thermal probability.
 * ΔT < 8°C → thermals very unlikely.
 */
export interface DailyContext {
  /** Today's predicted max temperature (°C) */
  tempMax: number | null;
  /** Today's predicted min temperature (°C) */
  tempMin: number | null;
  /** Diurnal temperature range ΔT = Tmax - Tmin (°C) */
  deltaT: number | null;
}

// ── Tendency detection (precursor signals) ──────────────

export type TendencyLevel = 'none' | 'building' | 'likely' | 'active';

export interface TendencySignal {
  /** Zone being analyzed */
  zoneId: MicroZoneId;
  /** Overall tendency score 0-100 */
  score: number;
  /** Qualitative level derived from score */
  level: TendencyLevel;
  /** Individual precursor scores */
  precursors: {
    /** Temperature rise rate (°C/h over last 2-3h) */
    tempRiseRate: number | null;
    /** Temperature rise score 0-25 (≥2°C/h = high) */
    tempRiseScore: number;
    /** Current wind direction already in thermal sector (W/SW/NW) */
    windInSector: boolean;
    /** Wind direction score 0-25 */
    windDirScore: number;
    /** Humidity dropping trend (% drop/h) */
    humidityDropRate: number | null;
    /** Humidity trend score 0-20 */
    humidityScore: number;
    /** ΔT context score 0-15 (from daily forecast) */
    deltaTScore: number;
    /** Temperature already above threshold */
    tempAboveThreshold: boolean;
    /** Temperature threshold score 0-15 */
    tempScore: number;
  };
  /** Estimated time to thermal onset (minutes), null if not estimable */
  estimatedOnsetMin: number | null;
  /** Human-readable summary */
  summary: string;
  /** When this signal was computed */
  computedAt: Date;
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
