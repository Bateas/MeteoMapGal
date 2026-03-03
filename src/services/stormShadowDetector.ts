/**
 * Storm Shadow Detector — Detects storm cloud presence and movement by analyzing
 * solar radiation drops across stations, cross-referenced with lightning data
 * AND wind anomalies (storms generate their own wind!).
 *
 * KEY INSIGHT: In Galician summer, thermal days have clear skies (>600 W/m²).
 * When a convective storm cell passes over a station, solar radiation drops
 * dramatically (often to <100 W/m²). By tracking which stations lose sunlight
 * and when, we can estimate:
 *   1. Storm cloud position (which stations are "shadowed")
 *   2. Storm movement vector (shadow propagation direction)
 *   3. Storm approach to target (will it reach Castrelo?)
 *
 * WIND VALIDATION: Convective storms produce measurable wind signatures:
 *   - Gust front (outflow): sudden speed increase (>5 m/s jump)
 *   - Direction reversal: >60° shift in a single reading cycle
 *   - Localized anomaly: one station's wind diverges from neighbors
 * When wind anomalies coincide with solar shadow → near-certain storm cell.
 * Wind anomalies WITHOUT shadow → approaching storm not yet overhead.
 *
 * Combined with lightning strike data → near-complete storm tracker.
 */

import type { NormalizedStation, NormalizedReading } from '../types/station';

// ── Types ─────────────────────────────────────────────────

export interface SolarSnapshot {
  stationId: string;
  lat: number;
  lon: number;
  radiation: number;        // W/m² current
  previousRadiation: number | null; // W/m² from previous reading (10-20 min ago)
  dropRate: number;         // W/m² drop per reading interval (negative = darkening)
  isShadowed: boolean;      // Currently under cloud shadow
  shadowOnsetTime: Date | null; // When radiation started dropping
}

export interface StormShadow {
  /** Centroid of all shadowed stations [lon, lat] */
  center: [number, number];
  /** Estimated movement vector [dx, dy] in degrees/hour */
  movementVector: [number, number] | null;
  /** Speed of shadow movement in km/h */
  movementSpeedKmh: number | null;
  /** Bearing of movement in degrees (0=N, 90=E) */
  movementBearing: number | null;
  /** Stations currently under shadow */
  shadowedStations: SolarSnapshot[];
  /** Stations with clear sky (reference) */
  clearStations: SolarSnapshot[];
  /** Wind anomalies in/near the storm zone — storms generate their own wind! */
  windContext: WindContext | null;
  /** Estimated time to reach target point (minutes), null if not approaching */
  etaMinutes: number | null;
  /** Overall confidence score 0-100 */
  confidence: number;
  /** Timestamp of this analysis */
  analyzedAt: Date;
}

export interface LightningContext {
  /** Recent strikes near shadowed area */
  strikesNearShadow: number;
  /** Average distance of strikes to shadow centroid (km) */
  avgDistanceKm: number;
  /** Strike cluster bearing relative to shadow centroid */
  strikeBearing: number | null;
}

// ── Wind anomaly types ───────────────────────────────────

export interface WindAnomaly {
  stationId: string;
  lat: number;
  lon: number;
  /** Current wind speed (m/s) */
  currentSpeed: number;
  /** Previous wind speed (m/s), null if no history */
  previousSpeed: number | null;
  /** Speed change (m/s), positive = intensifying */
  speedChange: number;
  /** Current wind direction (degrees, null if calm/variable) */
  currentDirection: number | null;
  /** Previous direction (degrees) */
  previousDirection: number | null;
  /** Absolute direction shift (degrees), null if can't compute */
  directionShift: number | null;
  /** True if sudden speed spike detected (>GUST_THRESHOLD m/s jump) */
  gustDetected: boolean;
  /** True if direction reversal + speed increase — classic storm outflow */
  outflowSignature: boolean;
}

export interface WindContext {
  /** Stations showing wind anomalies */
  anomalies: WindAnomaly[];
  /** Number of stations with gust fronts */
  gustCount: number;
  /** Number of stations with outflow signatures */
  outflowCount: number;
  /** Average speed change across anomalous stations (m/s) */
  avgSpeedChange: number;
}

// ── Constants ─────────────────────────────────────────────

/** Below this W/m², station is considered "shadowed" during daytime */
const SHADOW_THRESHOLD = 200;

/** Minimum expected clear-sky radiation for time of day (crude estimate).
 *  If all stations are below this, it's probably just cloudy everywhere. */
const MIN_CLEAR_SKY_REFERENCE = 300;

/** Minimum radiation drop rate to flag as storm-related (W/m² per cycle) */
const SIGNIFICANT_DROP_RATE = -100;

/** Minimum number of stations with solar data to run analysis */
const MIN_STATIONS = 2;

/** Wind speed jump (m/s) to flag as a storm gust front — ~10 kt jump */
const GUST_THRESHOLD = 5;

/** Direction shift (degrees) to flag as significant */
const DIRECTION_SHIFT_THRESHOLD = 60;

/** Minimum speed (m/s) for direction analysis (below this, direction is unreliable) */
const MIN_SPEED_FOR_DIRECTION = 1.5;

/** Radius (km) to search for wind anomalies near shadow zone */
const WIND_ANOMALY_RADIUS_KM = 20;

// ── Core analysis ─────────────────────────────────────────

/**
 * Build solar snapshots from current + historical readings.
 * Compares current radiation to the reading from ~10-20 min ago.
 */
export function buildSolarSnapshots(
  stations: NormalizedStation[],
  currentReadings: Map<string, NormalizedReading>,
  previousReadings: Map<string, NormalizedReading>,
): SolarSnapshot[] {
  const snapshots: SolarSnapshot[] = [];

  for (const station of stations) {
    const current = currentReadings.get(station.id);
    if (!current || current.solarRadiation === null) continue;

    const prev = previousReadings.get(station.id);
    const prevRad = prev?.solarRadiation ?? null;

    const dropRate = prevRad !== null
      ? current.solarRadiation - prevRad
      : 0;

    const isShadowed = current.solarRadiation < SHADOW_THRESHOLD && prevRad !== null && prevRad > SHADOW_THRESHOLD;

    snapshots.push({
      stationId: station.id,
      lat: station.lat,
      lon: station.lon,
      radiation: current.solarRadiation,
      previousRadiation: prevRad,
      dropRate,
      isShadowed: current.solarRadiation < SHADOW_THRESHOLD,
      shadowOnsetTime: isShadowed ? current.timestamp : null,
    });
  }

  return snapshots;
}

/**
 * Build wind anomaly snapshots by comparing current vs previous wind readings.
 * Detects gust fronts (sudden speed spikes) and outflow signatures (direction
 * reversal + speed increase) that indicate nearby storm cells.
 *
 * Works with ALL stations (not just solar-equipped ones), so this extends
 * detection coverage to the full 40-station network.
 */
export function buildWindAnomalies(
  stations: NormalizedStation[],
  currentReadings: Map<string, NormalizedReading>,
  previousReadings: Map<string, NormalizedReading>,
): WindAnomaly[] {
  const anomalies: WindAnomaly[] = [];

  for (const station of stations) {
    const current = currentReadings.get(station.id);
    if (!current || current.windSpeed === null) continue;

    const prev = previousReadings.get(station.id);
    const prevSpeed = prev?.windSpeed ?? null;
    const prevDir = prev?.windDirection ?? null;

    const speedChange = prevSpeed !== null ? current.windSpeed - prevSpeed : 0;

    // Direction shift (handle 360° wrap-around)
    let directionShift: number | null = null;
    if (
      current.windDirection !== null &&
      prevDir !== null &&
      current.windSpeed >= MIN_SPEED_FOR_DIRECTION &&
      (prevSpeed ?? 0) >= MIN_SPEED_FOR_DIRECTION
    ) {
      const raw = Math.abs(current.windDirection - prevDir);
      directionShift = raw > 180 ? 360 - raw : raw;
    }

    // Gust front: sudden speed increase beyond threshold
    const gustDetected = speedChange >= GUST_THRESHOLD;

    // Outflow signature: direction reversal + speed increase
    // Storm outflow pushes air outward → direction flips + wind strengthens
    const outflowSignature =
      gustDetected &&
      directionShift !== null &&
      directionShift >= DIRECTION_SHIFT_THRESHOLD;

    // Only record stations showing actual anomalies
    if (!gustDetected && !outflowSignature && (directionShift === null || directionShift < DIRECTION_SHIFT_THRESHOLD)) {
      continue;
    }

    anomalies.push({
      stationId: station.id,
      lat: station.lat,
      lon: station.lon,
      currentSpeed: current.windSpeed,
      previousSpeed: prevSpeed,
      speedChange,
      currentDirection: current.windDirection,
      previousDirection: prevDir,
      directionShift,
      gustDetected,
      outflowSignature,
    });
  }

  return anomalies;
}

/**
 * Detect storm shadow from solar radiation analysis.
 * Cross-references with lightning and wind anomaly contexts if available.
 */
export function detectStormShadow(
  snapshots: SolarSnapshot[],
  targetPoint: [number, number], // [lon, lat] — e.g. Castrelo reservoir center
  lightning?: LightningContext,
  windAnomalies?: WindAnomaly[],
): StormShadow | null {
  if (snapshots.length < MIN_STATIONS) return null;

  // Separate shadowed vs clear stations
  const shadowed = snapshots.filter((s) => s.isShadowed);
  const clear = snapshots.filter((s) => !s.isShadowed && s.radiation >= MIN_CLEAR_SKY_REFERENCE);

  // If no clear stations as reference, can't distinguish storm shadow from general overcast
  if (clear.length === 0 && shadowed.length > 0) {
    // All stations are dark → general cloud cover, not localized storm
    return null;
  }

  if (shadowed.length === 0) return null;

  // Compute shadow centroid
  const center: [number, number] = [
    shadowed.reduce((sum, s) => sum + s.lon, 0) / shadowed.length,
    shadowed.reduce((sum, s) => sum + s.lat, 0) / shadowed.length,
  ];

  // Estimate movement from stations that recently entered shadow
  // (stations with biggest drops are the "leading edge")
  const recentShadows = shadowed
    .filter((s) => s.dropRate < SIGNIFICANT_DROP_RATE)
    .sort((a, b) => a.dropRate - b.dropRate); // Most dramatic drops first

  let movementVector: [number, number] | null = null;
  let movementSpeedKmh: number | null = null;
  let movementBearing: number | null = null;

  if (recentShadows.length >= 2) {
    // Use the two stations with biggest drops to estimate direction
    const leading = recentShadows[0]; // Most dramatic drop = newest shadow edge
    const trailing = recentShadows[recentShadows.length - 1]; // Least dramatic = older shadow

    // Direction from trailing → leading = storm movement direction
    const dLon = leading.lon - trailing.lon;
    const dLat = leading.lat - trailing.lat;

    // Bearing
    const bearing = (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
    movementBearing = bearing;
    movementVector = [dLon, dLat];

    // Speed estimate (crude: assume ~10-20 min between shadow arrivals)
    const distKm = haversineKm(trailing.lat, trailing.lon, leading.lat, leading.lon);
    // Typical convective storm: 20-60 km/h
    movementSpeedKmh = Math.min(distKm * 3, 80); // Cap at 80 km/h
  }

  // ETA to target
  let etaMinutes: number | null = null;
  if (movementBearing !== null && movementSpeedKmh !== null && movementSpeedKmh > 5) {
    const distToTarget = haversineKm(center[1], center[0], targetPoint[1], targetPoint[0]);
    // Check if storm is moving TOWARD the target
    const bearingToTarget = bearingDeg(center[1], center[0], targetPoint[1], targetPoint[0]);
    const angleDiff = Math.abs(((movementBearing - bearingToTarget) + 180) % 360 - 180);

    if (angleDiff < 60) {
      // Storm is heading roughly toward target
      etaMinutes = Math.round((distToTarget / movementSpeedKmh) * 60);
    }
  }

  // ── Wind anomaly analysis near shadow zone ──────────────
  let windContext: WindContext | null = null;
  if (windAnomalies && windAnomalies.length > 0) {
    // Find wind anomalies within WIND_ANOMALY_RADIUS_KM of shadow centroid
    const nearAnomalies = windAnomalies.filter((wa) =>
      haversineKm(wa.lat, wa.lon, center[1], center[0]) < WIND_ANOMALY_RADIUS_KM
    );

    if (nearAnomalies.length > 0) {
      const gustCount = nearAnomalies.filter((wa) => wa.gustDetected).length;
      const outflowCount = nearAnomalies.filter((wa) => wa.outflowSignature).length;
      const avgSpeedChange =
        nearAnomalies.reduce((sum, wa) => sum + wa.speedChange, 0) / nearAnomalies.length;

      windContext = {
        anomalies: nearAnomalies,
        gustCount,
        outflowCount,
        avgSpeedChange,
      };
    }
  }

  // ── Confidence scoring ─────────────────────────────────
  let confidence = 30; // Base

  // More shadowed stations = higher confidence
  confidence += Math.min(shadowed.length * 10, 30);

  // Clear reference stations exist
  if (clear.length >= 2) confidence += 10;

  // Strong radiation drops
  const strongDrops = shadowed.filter((s) => s.dropRate < -200).length;
  confidence += Math.min(strongDrops * 5, 15);

  // Lightning correlation boost
  if (lightning && lightning.strikesNearShadow > 0) {
    confidence += 15; // Lightning near shadow = almost certainly a storm
  }

  // Wind anomaly correlation boost — storms generate their own wind!
  if (windContext) {
    // Outflow signature (direction reversal + gust) = strongest storm indicator
    if (windContext.outflowCount > 0) {
      confidence += 15; // Almost certain: shadow + outflow = convective storm cell
    }
    // Gust fronts near shadow = very likely storm
    else if (windContext.gustCount > 0) {
      confidence += 10;
    }
    // Multiple stations with increasing wind near shadow
    if (windContext.anomalies.length >= 2 && windContext.avgSpeedChange > 3) {
      confidence += 5; // Widespread wind increase corroborates storm presence
    }
  }

  confidence = Math.min(confidence, 100);

  return {
    center,
    movementVector,
    movementSpeedKmh,
    movementBearing,
    shadowedStations: shadowed,
    clearStations: clear,
    windContext,
    etaMinutes,
    confidence,
    analyzedAt: new Date(),
  };
}

/**
 * Compute an aggregate "solar index" for a zone from all stations with solar data.
 * Returns 0 (total shadow) to 100 (full clear sky).
 * Useful for replacing Open-Meteo forecast cloudCover with real data.
 */
export function computeSolarIndex(
  snapshots: SolarSnapshot[],
  maxExpectedRadiation = 900, // Peak summer W/m² in Galicia
): number {
  if (snapshots.length === 0) return -1; // No data
  const avg = snapshots.reduce((sum, s) => sum + s.radiation, 0) / snapshots.length;
  return Math.round(Math.min(100, (avg / maxExpectedRadiation) * 100));
}

/**
 * Estimate cloud cover percentage from solar radiation.
 * Inverse of solar index — useful for feeding into thermal scoring.
 * Returns 0 (clear) to 100 (overcast).
 */
export function estimateCloudCover(
  solarRadiation: number,
  maxExpectedRadiation = 900,
): number {
  if (solarRadiation <= 0) return 100;
  const clearFraction = Math.min(1, solarRadiation / maxExpectedRadiation);
  return Math.round((1 - clearFraction) * 100);
}

// ── Geo helpers ───────────────────────────────────────────

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  const x =
    Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
