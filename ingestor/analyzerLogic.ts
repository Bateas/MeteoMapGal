/**
 * Pure scoring/inference logic extracted from analyzer.ts.
 *
 * No DB, no I/O — testable in isolation. Imported by analyzer.ts which
 * adds DB queries + alert dispatch around these primitives.
 *
 * Used by `analyzerLogic.test.ts` to cover the 24/7 Telegram pipeline
 * without spinning up TimescaleDB.
 */

import { haversineDistance } from '../src/services/geoUtils.js';
import { msToKnots, degreesToCardinal } from '../src/services/windUtils.js';
import { predictCesantesCanalization } from '../src/services/cesantesCanalizationDetector.js';
import { detectBocana } from '../src/services/bocanaDetector.js';
import { isWindBlacklisted, getSourceQuality, freshnessMulFor } from '../src/services/spotScoringEngine.js';
import { isBuoyFresh, BUOY_STALE_MAX_MIN } from '../src/services/buoyUtils.js';
import { getStationBiasAt } from '../src/config/stationBiases.js';
import type { BuoyReading } from '../src/api/buoyClient.js';

// Climatological monthly SST fallback for Ría de Vigo interior (matches
// frontend spotScoringEngine.ts — single source of truth would be nicer
// but the array values are static climatology, no drift risk).
const RIA_VIGO_INTERIOR_SST_BY_MONTH = [13, 13, 13, 14, 16, 18, 20, 21, 20, 18, 16, 14];

// ── Consensus weighting (mirror of spotScoringEngine.ts) ────
//
// These are the map's constants, ported so Telegram and the map answer the
// same question with the same arithmetic. Before this, the analyzer averaged
// every source FLAT: the single exposed buoy counted exactly as much as each
// of ~20 sheltered land stations, so open water scored like a valley.
const BUOY_EXPOSURE_BOOST = 1.5;        // over water, inherently unobstructed
const PREFERRED_EXPOSURE_BOOST = 1.3;   // manually vetted as representative
const BIAS_BLIND_PENALTY = 0.3;         // reading FROM a documented blind sector
const CALM_FLOOR_KT = 1;                // below this a reading carries no signal
const GUST_MAX_DIST_KM = 8;             // gusts only from sources this close
const MAX_PLAUSIBLE_GUST_KT = 45;       // Galician coast ceiling (sensor glitch)
const GUST_RATIO_CAP = 3;               // gust more than 3x the mean = glitch

// Outlier suppression (step 4 of the engine). This is what actually stops a
// sheltered or broken anemometer from dragging the consensus down: the bias
// map only knows the stations we have already audited, this catches the rest.
const OUTLIER_MIN_ENTRIES = 3;          // below this there is no majority to judge against
const OUTLIER_MIN_MEDIAN_KT = 3;        // no point ranking outliers in dead calm
const HIGH_OUTLIER_RATIO = 3.0;         // broken anemometer or gust spike
const HIGH_OUTLIER_PENALTY = 0.5;
const LOW_OUTLIER_THRESHOLD = 0.35;     // likely sheltered
const LOW_OUTLIER_PENALTY = 0.3;
const SEVERE_LOW_THRESHOLD = 0.15;      // near zero — certainly broken or blocked
const SEVERE_LOW_PENALTY = 0.1;
const CONSENSUS_BONUS_MIN_KT = 7;       // "real wind" for the agreement bonus
const CONSENSUS_BONUS_SOURCES = 3;

/** Weighted median — heavier (closer, better, more exposed) sources set the
 *  reference the others are judged against. */
function computeWeightedMedian(entries: { speedKt: number; weight: number }[]): number {
  const sorted = [...entries].sort((a, b) => a.speedKt - b.speedKt);
  const totalWeight = sorted.reduce((sum, e) => sum + e.weight, 0);
  let cumWeight = 0;
  for (const e of sorted) {
    cumWeight += e.weight;
    if (cumWeight >= totalWeight / 2) return e.speedKt;
  }
  return sorted[sorted.length - 1].speedKt;
}

/**
 * Age weight for a station reading. No timestamp = full weight.
 *
 * Delegates to `freshnessMulFor`, which scales the decay to how often the
 * network actually publishes. It used to be a flat ladder in minutes, which
 * asked an hourly AEMET station and a five-minute Wunderground one the same
 * question and marked the punctual one late. This is the same reasoning
 * `buoyFreshness` below already applies to PORTUS — it was only ever missing
 * for stations. Keeping both brains on one function is the point: the map and
 * the Telegram alert must not disagree about whether a reading counts.
 */
function stationFreshness(
  stationId: string,
  time: string | Date | undefined,
  now: number,
): number {
  if (!time) return 1;
  const ageMin = (now - new Date(time).getTime()) / 60_000;
  if (!Number.isFinite(ageMin)) return 1;
  return freshnessMulFor(stationId, ageMin);
}

/** Age weight for a buoy. Wider steps than a station: PORTUS publishes every
 *  30-60min with its own lag, so 20min old is normal there and stale here. */
function buoyFreshness(time: string | Date | undefined, now: number): number {
  if (!time) return 1;
  const ageMin = (now - new Date(time).getTime()) / 60_000;
  if (!Number.isFinite(ageMin)) return 1;
  return ageMin <= 10 ? 1.0 : ageMin <= 30 ? 0.95 : ageMin <= 60 ? 0.85 : 0.7;
}

// ── Types ───────────────────────────────────────────

export interface SpotDef {
  id: string;
  name: string;
  lat: number;
  lon: number;
  sector: 'embalse' | 'rias';
  radiusKm: number;
  thermalDetection: boolean;
  // Per-spot curation mirrored from frontend spots.ts (Telegram must converge
  // to the map — spotScoringEngine is the authoritative scorer). All optional:
  // callers/tests without them keep the pre-curation behavior exactly.
  /** Station IDs vetted as best-representing this spot. They weigh 1.3x in the
   *  consensus mean AND are included even beyond radiusKm (Limens case: Cabo
   *  Udra reference at ~9km vs 6km radius). */
  preferredStations?: string[];
  /** Station IDs that misrepresent THIS spot (different microclimate) even if
   *  within radius — removed before the wind consensus. */
  excludeStations?: string[];
  /** Calibration offset (kt) added to the consensus average before the verdict.
   *  Sign = relative exposure: negative when the reference over-reads (exposed
   *  cape vs sheltered beach), positive when land stations under-read. */
  windCalibrationKt?: number;
  /** Buoy IDs vetted as representative. Mirrors spots.ts preferredBuoys: a
   *  preferred buoy within 5km doubles its proximity weight. */
  preferredBuoys?: number[];
}

export type Verdict = 'calm' | 'light' | 'sailing' | 'good' | 'strong' | 'unknown';

export interface StationReading {
  station_id: string;
  latitude: number;
  longitude: number;
  wind_speed: number | null;
  wind_gust: number | null;
  wind_dir: number | null;
  temperature: number | null;
  humidity: number | null;
  /** Reading timestamp. Optional: when absent the freshness weight is 1.0,
   *  which is what every fixture without a clock expects. Production always
   *  supplies it. */
  time?: string | Date;
  // Extended fields for detector connection (Phase A — TIER 1 P0)
  dew_point?: number | null;
  solar_rad?: number | null;
  pressure?: number | null;
}

export interface BuoyWind {
  station_id: number;
  wind_speed: number;
  wind_dir: number | null;
  lat: number;
  lon: number;
  /** Reading timestamp. Optional for the same reason as StationReading.time,
   *  but here it also drives the staleness GATE — see scoreSpot. */
  time?: string | Date;
  // Extended fields for detector connection (Phase A — TIER 1 P0)
  station_name?: string;
  water_temp?: number | null;
  air_temp?: number | null;
  humidity?: number | null;
  wave_height?: number | null;
  wave_period?: number | null;
  wave_dir?: number | null;
}

export interface SpotResult {
  spot: SpotDef;
  /** Wind in knots — may have been BOOSTED by detector (canalization/bocana).
   *  Raw measured average is preserved in `rawWindKt`. */
  avgWindKt: number;
  maxGustKt: number;
  avgDir: number | null;
  verdict: Verdict;
  stationCount: number;
  /** Inferred direction for spots without vane (e.g. Castrelo SkyX) */
  inferredDir?: string | null;
  /** Consensus wind average (incl. per-spot windCalibrationKt) BEFORE detector
   *  overrides (for debug + accuracy tracking) */
  rawWindKt?: number;
  /** Detector that boosted the verdict, if any. 'cesantes-canalization' | 'bocana-terral' | null */
  boostedBy?: 'cesantes-canalization' | 'bocana-terral' | null;
  /** Detector confidence 0-100% (when boostedBy set) */
  boostConfidence?: number;
  /** Buoys in range dropped for being older than the staleness gate. Surfaced
   *  so a silently dying buoy feed shows up in the cycle log. */
  staleBuoysDropped?: number;
}

// ── Adapter: ingestor BuoyWind → frontend BuoyReading ────────
//
// Frontend detectors (canalization, bocana) consume the BuoyReading shape
// from src/api/buoyClient. Our DB row shape is BuoyWind. The two largely
// overlap but use different field names (snake_case vs camelCase) and
// BuoyReading has more strictly-typed fields. This converter bridges them.
export function buoyWindToBuoyReading(b: BuoyWind): BuoyReading {
  return {
    stationId: b.station_id,
    stationName: b.station_name ?? `Boya ${b.station_id}`,
    timestamp: new Date().toISOString(),
    waveHeight: b.wave_height ?? null,
    waveHeightMax: null,
    wavePeriod: b.wave_period ?? null,
    wavePeriodMean: null,
    waveDir: b.wave_dir ?? null,
    windSpeed: b.wind_speed > 0 ? b.wind_speed : null,
    windDir: b.wind_dir,
    windGust: null,
    waterTemp: b.water_temp ?? null,
    airTemp: b.air_temp ?? null,
    airPressure: null,
    currentSpeed: null,
    currentDir: null,
    salinity: null,
    seaLevel: null,
    humidity: b.humidity ?? null,
    dewPoint: null,
  };
}

// ── Constants ───────────────────────────────────────

export const VERDICT_LABEL: Record<Verdict, string> = {
  calm: 'CALMA', light: 'FLOJO', sailing: 'NAVEGABLE',
  good: 'BUENO', strong: 'FUERTE', unknown: 'SIN DATOS',
};

export const ALERT_VERDICTS: Set<Verdict> = new Set(['sailing', 'good', 'strong']);
export const LOW_VERDICTS: Set<Verdict> = new Set(['calm', 'light', 'unknown']);

/**
 * Minimum independent wind sources (stations + buoys) before a verdict is
 * allowed to leave the building as a notification.
 *
 * This closes an inversion in the project's own rigour rule: the map refuses
 * to commit to a verdict below this bar — it marks the score `provisional` and
 * the marker says "calculando" — while the alert channel, the one that reaches
 * a pocket and gets acted on, had no such check. The gate was strictest where
 * a mistake is cheapest and absent where it is most expensive.
 *
 * One station can be a dirty anemometer, a sheltered garden, or a sensor that
 * froze at a value. Two independent sources is the same floor the wind-trend
 * alerts already demand before they escalate.
 */
export const MIN_SOURCES_FOR_ALERT = 2;

/** True when a scored spot is solid enough to justify a push/Telegram alert. */
export function canAlertOnResult(result: Pick<SpotResult, 'stationCount'>): boolean {
  return result.stationCount >= MIN_SOURCES_FOR_ALERT;
}

// ── windVerdict ─────────────────────────────────────

/**
 * Match frontend spotScoringEngine thresholds exactly.
 * Cies-Ria uses ocean thresholds (higher), all others use ria/embalse.
 */
export function windVerdict(avgKt: number, spotId: string): Verdict {
  const kt = Math.round(avgKt);
  if (spotId === 'cies-ria') {
    if (kt < 5) return 'calm';
    if (kt < 10) return 'light';
    if (kt < 14) return 'sailing';
    if (kt < 18) return 'good';
    return 'strong';
  }
  if (kt < 6) return 'calm';
  if (kt < 8) return 'light';
  if (kt < 12) return 'sailing';
  if (kt < 18) return 'good';
  return 'strong';
}

// ── inferCastreloDirection ──────────────────────────

/**
 * Infer wind direction for Castrelo when SkyX has no vane.
 * Uses nearby stations with direction (AEMET Ribadavia, MG stations)
 * + time-of-day heuristic (14-18h sunny = likely SW thermal).
 */
export function inferCastreloDirection(readings: StationReading[]): string | null {
  const castreloLat = 42.2991, castreloLon = -8.1087;
  // Blacklisted anemometers (sheltered/broken for wind) must not steer the
  // inferred direction either — same gate as the wind consensus below.
  const nearby = readings.filter(r =>
    r.wind_dir != null && r.wind_speed != null && r.wind_speed > 1.0 &&
    r.latitude !== 0 && r.longitude !== 0 &&
    !isWindBlacklisted(r.station_id) &&
    haversineDistance(castreloLat, castreloLon, r.latitude, r.longitude) <= 15
  );

  if (nearby.length === 0) return null;

  let sinSum = 0, cosSum = 0;
  for (const r of nearby) {
    const rad = r.wind_dir! * Math.PI / 180;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }
  const avgDeg = (Math.round(Math.atan2(sinSum / nearby.length, cosSum / nearby.length) * 180 / Math.PI) + 360) % 360;
  const cardinal = degreesToCardinal(avgDeg);

  const hour = new Date().getHours();
  const isSWish = avgDeg >= 200 && avgDeg <= 280;
  const isAfternoon = hour >= 13 && hour <= 19;

  if (isSWish && isAfternoon) {
    return `${cardinal} (termico probable)`;
  }

  return cardinal;
}

// ── Detector boost helpers ───────────────────────────
//
// Connect-from-frontend pattern (Phase B TIER 1 P0): the analyzer used to
// compute verdicts from RAW wind consensus only. That meant Cesantes (sheltered
// behind Monte Costa da Vela) and Bocana (NE terral 6-11h) NEVER reached the
// 'good'/'sailing' threshold even when the actual sailable wind in the spot
// was 14-18kt. Telegram alerts therefore stayed silent on the most interesting
// session windows. We now wrap scoreSpot with detector overrides that mirror
// what SpotPopup does on the frontend (which is the authoritative scorer).

/**
 * Compute mouth-of-ría humidity from station readings (mirror of
 * `computeMouthHumidity` in cesantesCanalizationDetector.ts but operating on
 * our DB row shape — frontend version needs NormalizedStation + Map).
 *
 * Mouth = stations near Vigo bay entrance (lon < -8.78, lat 42.15-42.30),
 * 75th percentile is used (robust to interior dry leaking in).
 */
function computeMouthHumidityFromRows(readings: StationReading[]): number | null {
  const mouth: number[] = [];
  for (const r of readings) {
    if (r.longitude > -8.78 || r.latitude < 42.15 || r.latitude > 42.30) continue;
    if (r.humidity == null) continue;
    mouth.push(r.humidity);
  }
  if (mouth.length === 0) return null;
  const sorted = [...mouth].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75));
  return sorted[idx];
}

/**
 * Apply Cesantes canalization override to a raw verdict.
 * Returns boosted wind kt + signal info, or null if not applicable.
 *
 * Matches frontend gate exactly:
 *   - spot.id === 'cesantes'
 *   - prediction.active && predictedKt !== null
 *   - prediction.confidence >= 70
 *   - (predictedKt - rawKt) >= 4
 *   - same 7 arguments to the detector, including the wind-direction guard
 *     (this claim was false for a while — see the note at the call below)
 */
function applyCesantesBoost(
  rawKt: number,
  readings: StationReading[],
  buoys: BuoyWind[],
  /** Consensus wind direction (deg) — the detector's own suppression guard. */
  localWindDir: number | null,
): { effectiveKt: number; confidence: number; predictedDir: number | null } | null {
  // Compute mouth humidity from interior station readings
  const mouthHumidity = computeMouthHumidityFromRows(readings);

  // Find airTemp near Cesantes (nearest station with temperature, sorted by distance)
  const cesantesLat = 42.307, cesantesLon = -8.619;
  const stationsWithTemp = readings
    .filter(r => r.temperature != null && r.latitude !== 0 && r.longitude !== 0)
    .map(r => ({ r, d: haversineDistance(cesantesLat, cesantesLon, r.latitude, r.longitude) }))
    .sort((a, b) => a.d - b.d);
  const airTempLocal = stationsWithTemp[0]?.r.temperature ?? null;

  // Peak radiation INLAND, mirroring computeInteriorSolar on the frontend.
  // Cesantes can be under mist and still blow — the engine is the thermal low
  // further in. What kills the boost is the interior being covered too.
  // MAX rather than nearest: one station clearly in the sun proves the
  // interior is heating; an average is dragged down by passing cloud.
  let solarRadInterior: number | null = null;
  for (const r of readings) {
    if (r.solar_rad == null) continue;
    if (r.longitude < -8.60 || r.longitude > -7.80) continue;
    if (r.latitude < 42.10 || r.latitude > 42.60) continue;
    if (solarRadInterior === null || r.solar_rad > solarRadInterior) solarRadInterior = r.solar_rad;
  }

  // Find waterTemp from nearby buoy or climatology fallback
  // (matches frontend RIA_VIGO_INTERIOR_SST_BY_MONTH pattern)
  const nearbyBuoyWithSST = buoys.find(b =>
    b.water_temp != null && haversineDistance(cesantesLat, cesantesLon, b.lat, b.lon) <= 15
  );
  const summerLike = airTempLocal !== null && airTempLocal >= 20;
  const waterTemp = nearbyBuoyWithSST?.water_temp
    ?? (summerLike ? RIA_VIGO_INTERIOR_SST_BY_MONTH[new Date().getMonth()] : null);

  // Convert ingestor buoys to frontend BuoyReading shape
  const buoyReadings = buoys.map(buoyWindToBuoyReading);

  const prediction = predictCesantesCanalization(
    buoyReadings,
    mouthHumidity,
    false, // no webcam vision in ingestor (frontend-only feature)
    airTempLocal,
    waterTemp,
    rawKt, // localStationKt — used in thermal-only mode as base
    // The 7th argument is the detector's own suppression guard: with a real
    // flow from outside the SW arc (N/NW), the islands and Monte da Vela block
    // it from reaching the Cesantes shore, so the thermal canalization is not
    // establishing and the prediction must be dropped. Omitting it meant the
    // map suppressed the boost on a NW day and Telegram still sent it — while
    // the comment above this function claimed the gates matched exactly.
    localWindDir,
    solarRadInterior,
  );

  if (!prediction.active || prediction.predictedKt === null) return null;
  if (prediction.confidence < 70) return null;
  if (prediction.predictedKt - rawKt < 4) return null;

  return {
    effectiveKt: prediction.predictedKt,
    confidence: prediction.confidence,
    predictedDir: prediction.predictedDir,
  };
}

/**
 * Apply Bocana (NE terral matinal 6-11h) boost to a raw verdict.
 * Returns boosted wind kt + signal info, or null if not applicable.
 */
function applyBocanaBoost(
  rawKt: number,
  readings: StationReading[],
  buoys: BuoyWind[],
): { effectiveKt: number; confidence: number; signal: string } | null {
  // Find solar reading from nearest station with solar_rad (for cloud gating)
  const bocanaLat = 42.268, bocanaLon = -8.714;
  const nearestSolar = readings
    .filter(r => r.solar_rad != null && r.latitude !== 0 && r.longitude !== 0)
    .map(r => ({ r, d: haversineDistance(bocanaLat, bocanaLon, r.latitude, r.longitude) }))
    .sort((a, b) => a.d - b.d)[0]?.r;
  const solarRad = nearestSolar?.solar_rad ?? null;

  const buoyReadings = buoys.map(buoyWindToBuoyReading);
  const signal = detectBocana(buoyReadings, solarRad);
  if (!signal.active || signal.confidence < 40) return null;

  return {
    effectiveKt: rawKt + signal.boostKt,
    confidence: signal.confidence,
    signal: signal.signal ?? 'Terral matinal detectado',
  };
}

// ── scoreSpot ───────────────────────────────────────

/**
 * Score a spot based on nearby station wind consensus.
 * Filters stations by distance to spot (radiusKm).
 * Matches frontend spotScoringEngine logic INCLUDING detector overrides
 * (Cesantes canalization + Bocana terral matinal — Phase B TIER 1 P0) and
 * per-spot curation (excludeStations / preferredStations 1.3x weight /
 * windCalibrationKt) so a curated spot gets the SAME verdict on Telegram
 * as on the map.
 *
 * NB: surf spots (`surf-*` IDs in frontend `spots.ts`) are NOT in the
 * ingestor SPOTS array — only sailing/thermal sailing spots get Telegram
 * verdicts (wind verdict is meaningless for waves). No skip-list needed.
 */
export function scoreSpot(spot: SpotDef, readings: StationReading[], buoyWinds: BuoyWind[]): SpotResult {
  // ── Per-spot curation (mirror of frontend selectStationsForSpot) ──
  //
  // Exclusion is applied at the source so nothing downstream (wind mean, gust,
  // direction) sees the station. Detector helpers (Cesantes/Bocana boosts)
  // still read the unfiltered `readings` array on purpose: they consume
  // REGIONAL signals (mouth humidity, solar gating), not this spot's consensus.
  //
  // Preferred stations bypass the radius gate — the curated reference can sit
  // beyond a deliberately short radius (Limens: Cabo Udra ~9km vs 6km radius).
  const excludeSet = new Set(spot.excludeStations ?? []);
  const preferredSet = new Set(spot.preferredStations ?? []);

  const preferredBuoySet = new Set(spot.preferredBuoys ?? []);

  // Distance is computed once per station and KEPT. It used to be thrown away
  // the instant the radius gate passed, which is precisely why every station
  // ended up with the same vote no matter how far away it sat.
  const nearby: { r: StationReading; distKm: number }[] = [];
  for (const r of readings) {
    if (r.latitude === 0 || r.longitude === 0) continue;
    if (excludeSet.has(r.station_id)) continue;
    const distKm = haversineDistance(spot.lat, spot.lon, r.latitude, r.longitude);
    if (!preferredSet.has(r.station_id) && distKm > spot.radiusKm) continue;
    nearby.push({ r, distKm });
  }

  // Buoys carry the x1.5 over-water boost, so they need the map's staleness
  // gate too: the query feeding this serves readings up to 6h old, and without
  // the gate one stale buoy would hold a verdict it stopped measuring hours
  // ago. A buoy with no timestamp at all is treated as fresh — production
  // always supplies one, fixtures usually do not.
  const nearbyBuoys: { b: BuoyWind; distKm: number }[] = [];
  let staleBuoysDropped = 0;
  for (const b of buoyWinds) {
    if (b.lat === 0 || b.lon === 0 || b.wind_speed <= 0) continue;
    const distKm = haversineDistance(spot.lat, spot.lon, b.lat, b.lon);
    if (distKm > spot.radiusKm) continue;
    if (b.time != null && !isBuoyFresh({ timestamp: b.time }, BUOY_STALE_MAX_MIN)) {
      staleBuoysDropped++;
      continue;
    }
    nearbyBuoys.push({ b, distKm });
  }

  // ── Weighted consensus (port of computeSpotWindConsensus) ──
  type WindEntry = { speedKt: number; weight: number; dir: number | null };
  const entries: WindEntry[] = [];
  let calmDiscarded = 0;
  const now = Date.now();

  for (const { r, distKm } of nearby) {
    if (r.wind_speed == null) continue;
    // Blacklist: stations statistically confirmed sheltered or broken for wind
    // (mean ratio < 0.20 against buoys) never enter the wind consensus. They
    // stay valid for temperature and humidity — the detector helpers below
    // read the unfiltered `readings` array on purpose.
    if (isWindBlacklisted(r.station_id)) continue;
    const speedKt = msToKnots(r.wind_speed);
    if (speedKt < CALM_FLOOR_KT) { calmDiscarded++; continue; }
    const isPreferred = preferredSet.has(r.station_id);
    const proximityBoost = isPreferred ? (distKm <= 2 ? 3.0 : distKm <= 5 ? 2.0 : 1.5) : 1.0;
    const distWeight = proximityBoost / (distKm + 1);
    // Documented orographic bias (stationBiases.ts): a station reading FROM a
    // sector it is known to misread gets DEMOTED, not dropped. The previous
    // code excluded it outright, which then needed a "put it back if too few
    // survive" escape hatch; demoting can never empty the consensus, so that
    // whole branch is gone.
    const biasMul = (r.wind_dir != null && getStationBiasAt(r.station_id, r.wind_dir))
      ? BIAS_BLIND_PENALTY : 1;
    let weight = distWeight * getSourceQuality(r.station_id)
      * stationFreshness(r.station_id, r.time, now) * biasMul;
    if (isPreferred) weight *= PREFERRED_EXPOSURE_BOOST;
    entries.push({ speedKt, weight, dir: r.wind_dir });
  }

  for (const { b, distKm } of nearbyBuoys) {
    const speedKt = msToKnots(b.wind_speed);
    if (speedKt < CALM_FLOOR_KT) { calmDiscarded++; continue; }
    const proximityBoost = (preferredBuoySet.has(b.station_id) && distKm <= 5) ? 2.0 : 1.0;
    const weight = (proximityBoost / (distKm + 1))
      * buoyFreshness(b.time, now) * BUOY_EXPOSURE_BOOST;
    entries.push({ speedKt, weight, dir: b.wind_dir });
  }

  // ── Outlier suppression (port of engine step 4) ──
  // Without this the port would have LOOSENED the rules: the directional bias
  // map used to EXCLUDE a station reading from its blind sector outright, and
  // demoting it to 0.3 alone would let it back into the mean. Median plus
  // demotion lands it at ~0.09, which is where exclusion effectively had it.
  if (entries.length >= OUTLIER_MIN_ENTRIES) {
    const median = computeWeightedMedian(entries);
    if (median > OUTLIER_MIN_MEDIAN_KT) {
      for (const e of entries) {
        const ratio = e.speedKt / median;
        if (ratio > HIGH_OUTLIER_RATIO) e.weight *= HIGH_OUTLIER_PENALTY;
        else if (ratio < SEVERE_LOW_THRESHOLD) e.weight *= SEVERE_LOW_PENALTY;
        else if (ratio < LOW_OUTLIER_THRESHOLD) e.weight *= LOW_OUTLIER_PENALTY;
      }
    }
  }

  let windSum = 0, weightSum = 0, sinSum = 0, cosSum = 0, dirCount = 0;
  for (const e of entries) {
    windSum += e.speedKt * e.weight;
    weightSum += e.weight;
    if (e.dir != null) {
      const rad = e.dir * Math.PI / 180;
      // A curated reference should steer the reported direction exactly as
      // much as it steers the speed, so direction uses the same weight.
      sinSum += Math.sin(rad) * e.weight;
      cosSum += Math.cos(rad) * e.weight;
      dirCount++;
    }
  }
  const count = entries.length;

  // Gusts come from the CLOSEST sources only, mirroring the map: a gust off a
  // distant ridge must not inflate a sheltered spot's number. Deliberately NOT
  // subject to the calm floor above — a gust on an otherwise calm station is
  // still a gust, and this figure feeds safety messages.
  let gustMax = 0;
  for (const { r, distKm } of nearby) {
    if (r.wind_gust == null || distKm > GUST_MAX_DIST_KM) continue;
    if (isWindBlacklisted(r.station_id)) continue;
    const gKt = msToKnots(r.wind_gust);
    if (gKt > gustMax) gustMax = gKt;
  }

  if (count === 0) {
    // Sources were present but every one of them read below the calm floor.
    // That is MEASURED calm, and it is not the same thing as having no data:
    // 'unknown' has to keep meaning "we cannot see this spot".
    const measuredCalm = calmDiscarded > 0;
    return {
      spot,
      avgWindKt: 0,
      maxGustKt: 0,
      avgDir: null,
      verdict: measuredCalm ? 'calm' : 'unknown',
      stationCount: measuredCalm ? calmDiscarded : 0,
      staleBuoysDropped,
    };
  }

  // windCalibrationKt is part of the consensus itself, not a detector override
  // (mirror of the engine: avgSpeed = max(0, weightedMean + calibration)).
  // Baking it into rawWindKt means detector gates below (predictedKt - rawKt
  // >= 4) compare against the same calibrated base the frontend uses.
  const calibration = spot.windCalibrationKt ?? 0;
  let avgKt = Math.max(0, windSum / weightSum + calibration);
  // Consensus bonus, same as the map: when this many independent sources all
  // see real wind, the weighted mean is understating it — the sheltered ones
  // still in the mix pull it down.
  if (entries.filter(e => e.speedKt >= CONSENSUS_BONUS_MIN_KT).length >= CONSENSUS_BONUS_SOURCES) {
    avgKt += 1;
  }
  const rawWindKt = Math.round(avgKt);
  // Sanity cap, same as the map: a gust above the Galician ceiling, or more
  // than 3x this spot's own mean, is a sensor glitch rather than weather.
  if (gustMax > MAX_PLAUSIBLE_GUST_KT
    || (rawWindKt > 0 && gustMax > rawWindKt * GUST_RATIO_CAP)) gustMax = 0;
  // atan2 is scale-invariant, so weighting sin/cos sums needs no normalization.
  const avgDir = dirCount > 0
    ? (Math.round(Math.atan2(sinSum, cosSum) * 180 / Math.PI) + 360) % 360
    : null;

  // ── Apply detector overrides ──
  let effectiveKt = rawWindKt;
  let boostedBy: 'cesantes-canalization' | 'bocana-terral' | null = null;
  let boostConfidence: number | undefined;

  if (spot.id === 'cesantes') {
    const boost = applyCesantesBoost(rawWindKt, readings, buoyWinds, avgDir);
    if (boost) {
      effectiveKt = boost.effectiveKt;
      boostedBy = 'cesantes-canalization';
      boostConfidence = boost.confidence;
    }
  } else if (spot.id === 'bocana') {
    const boost = applyBocanaBoost(rawWindKt, readings, buoyWinds);
    if (boost) {
      effectiveKt = boost.effectiveKt;
      boostedBy = 'bocana-terral';
      boostConfidence = boost.confidence;
    }
  }

  const verdict = windVerdict(effectiveKt, spot.id);

  let inferredDir: string | null = null;
  if (avgDir === null && rawWindKt >= 3 && spot.id === 'castrelo') {
    inferredDir = inferCastreloDirection(readings);
  }

  return {
    spot,
    avgWindKt: effectiveKt,
    maxGustKt: Math.round(gustMax),
    avgDir,
    verdict,
    stationCount: count,
    inferredDir,
    rawWindKt,
    boostedBy,
    boostConfidence,
    staleBuoysDropped,
  };
}
