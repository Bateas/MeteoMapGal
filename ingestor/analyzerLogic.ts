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
import { assessRainVeto } from '../src/services/rainVeto.js';
import { assessSynopticRegime, type UpperWind } from '../src/services/synopticRegime.js';
import type { ThermalVeto } from '../src/services/cesantesCanalizationDetector.js';
import type { PrecipSample } from '../src/services/precipSemantics.js';
import { detectBocana } from '../src/services/bocanaDetector.js';
import { isWindBlacklisted, getSourceQuality, freshnessMulFor, staleGateMinFor, gustIsPlausible, peakPlausibleGustKt } from '../src/services/spotScoringEngine.js';
import { isBuoyFresh, isLandStationCopy, BUOY_STALE_MAX_MIN } from '../src/services/buoyUtils.js';
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
const MAX_PLAUSIBLE_GUST_KT = 90;       // Galician coast ceiling (was 45: dropped real frontal gusts, 29-sep)
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
  // Station metadata, so the map's engine can be run on the same rows (engineShadow.ts)
  name?: string | null;
  source?: string | null;
  altitude?: number | null;
}

export interface BuoyWind {
  station_id: number;
  wind_speed: number;
  wind_dir: number | null;
  /** m/s. Only the strong-wind safety alert reads it (windSafetyLogic.ts). */
  wind_gust?: number | null;
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
  /** Cesantes rain veto: its reason when rain at the nearby stations vetoed the thermal
   *  breeze, null when it was assessed and did not, absent when there was no rain data. */
  rainVeto?: string | null;
  /** Front aloft (850 hPa, synopticRegime.ts): its reason when it vetoed the Cesantes
   *  breeze, null when assessed and it did not, absent when there was no upper-air data. */
  regimeVeto?: string | null;
}

/** 850 hPa wind per sector, from upper_air_hourly (synopticRegime.ts). */
export type UpperWindBySector = Partial<Record<'rias' | 'embalse', UpperWind | null>>;

/** Everything scoreSpot needs beyond the latest rows. */
export interface ScoreContext {
  /** Precipitation samples per station (the last ~150 min), for the Cesantes rain veto */
  precip?: Map<string, PrecipSample[]>;
  /** The instant the rain window ends at; defaults to now */
  nowMs?: number;
  /** 850 hPa wind now, per sector. A front aloft vetoes the Cesantes breeze like rain. */
  upperWind?: UpperWindBySector;
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

/**
 * Whether a spot's rise into a sailable verdict may be announced at all. That alert invites
 * people out, so it stays quiet while a front is on — the same 850 hPa veto that already
 * switches off the breeze boosts. On 29-sep, with the front in, it announced «Cies NAVEGABLE
 * 11kt» and «Limens BUENO 15kt» while buoys and stations around them measured 28-29 kt with
 * 37-41 kt gusts. A front is a safety matter, not an opportunity. No upper-air data: no veto.
 */
export function opportunityAlertAllowed(sector: 'rias' | 'embalse', upperWind: UpperWindBySector | undefined): boolean {
  return !assessSynopticRegime(upperWind?.[sector])?.vetoed;
}

/**
 * Cycles a rise must hold before it is announced (5 min each). Measured on 14 days of stored
 * pipeline verdicts to 29-sep, 11 spots: announcing on the first cycle sent 50 alerts and 29 of
 * them were back to calm or light within 30 min; holding 4 cycles sends 20, 4 of them bounce,
 * and the same 8 of 10 real wind episodes (60+ min) are still announced, 15 min later.
 * Asking for a calm spell before the rise as well lost real episodes, so it is not done.
 */
export const OPPORTUNITY_CONFIRM_CYCLES = 4;

export interface RiseState { armed: boolean; pending: number }

/**
 * One cycle of the opportunity alert: a spot has to be seen calm or light (that arms it) and
 * then worth announcing for OPPORTUNITY_CONFIRM_CYCLES cycles in a row. Anything in between that
 * is not worth announcing disarms it. 'unknown' does not arm: after a restart, or a data gap,
 * filling in ignorance is not a rise. `ok` = sailable verdict, worth alerting, enough sources.
 */
export function stepOpportunityRise(prev: RiseState | undefined, verdict: Verdict, ok: boolean): { state: RiseState; confirmed: boolean } {
  if (verdict === 'calm' || verdict === 'light') return { state: { armed: true, pending: 0 }, confirmed: false };
  if (!ok || !prev?.armed) return { state: { armed: false, pending: 0 }, confirmed: false };
  const pending = prev.pending + 1;
  if (pending >= OPPORTUNITY_CONFIRM_CYCLES) return { state: { armed: false, pending: 0 }, confirmed: true };
  return { state: { armed: true, pending }, confirmed: false };
}

/** Whether a verdict is worth announcing when a spot rises into it: good or strong, or
 *  sailing from 10kt (marginal sailing below that flips too often to be worth a message). */
export function isWorthAlerting(verdict: string, windKt: number | null): boolean {
  return verdict === 'good' || verdict === 'strong' || (verdict === 'sailing' && (windKt ?? 0) >= 10);
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
 * Apply Cesantes canalization override to a raw verdict.
 * Returns boosted wind kt + signal info, or null if not applicable.
 *
 * Matches frontend gate exactly:
 *   - spot.id === 'cesantes'
 *   - prediction.active && predictedKt !== null
 *   - prediction.confidence >= 70
 *   - (predictedKt - rawKt) >= 4
 *   - same arguments to the detector, including the wind-direction guard
 *     (this claim was false for a while — see the note at the call below)
 *     and the rain veto
 */
function applyCesantesBoost(
  rawKt: number,
  readings: StationReading[],
  /** For the water temperature only (nearest buoy with SST) */
  buoys: BuoyWind[],
  /** Consensus wind direction (deg) — the detector's own suppression guard. */
  localWindDir: number | null,
  /** Peak local station wind gust (kt) — distinguishes sheltered thermal lulls from dead calm */
  localGustKt: number | null = null,
  /** Rain at the nearby stations (assessRainVeto) or a front aloft
   *  (assessSynopticRegime); vetoed = no boost */
  veto: ThermalVeto | null = null,
): { effectiveKt: number; confidence: number; predictedDir: number | null } | null {
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

  const prediction = predictCesantesCanalization(
    airTempLocal,
    waterTemp,
    rawKt, // localStationKt — the breeze the boost amplifies
    // The wind direction is the detector's own suppression guard: with a real
    // flow from outside the SW arc (N/NW), the islands and Monte da Vela block
    // it from reaching the Cesantes shore, so the thermal canalization is not
    // establishing and the prediction must be dropped. Omitting it meant the
    // map suppressed the boost on a NW day and Telegram still sent it — while
    // the comment above this function claimed the gates matched exactly.
    localWindDir,
    solarRadInterior,
    localGustKt,
    veto,
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
 * The stations that count for a spot (mirror of frontend selectStationsForSpot):
 * within radiusKm, or curated as preferred at any distance, minus the excluded ones.
 * Rows without coordinates are skipped. Distance is kept with each row.
 *
 * Exported so analyzer.ts asks the database for the rain of exactly these stations.
 */
export function selectNearbyStations(spot: SpotDef, readings: StationReading[]): { r: StationReading; distKm: number }[] {
  const excludeSet = new Set(spot.excludeStations ?? []);
  const preferredSet = new Set(spot.preferredStations ?? []);
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
  return nearby;
}

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
export function scoreSpot(spot: SpotDef, readings: StationReading[], buoyWinds: BuoyWind[], ctx?: ScoreContext): SpotResult {
  // ── Per-spot curation (mirror of frontend selectStationsForSpot) ──
  //
  // Exclusion is applied at the source so nothing downstream (wind mean, gust,
  // direction) sees the station. Detector helpers (Cesantes/Bocana boosts)
  // still read the unfiltered `readings` array on purpose: they consume
  // REGIONAL signals (interior sun, solar gating), not this spot's consensus.
  // The Cesantes rain veto is the exception: it asks THESE stations.
  //
  // Preferred stations bypass the radius gate — the curated reference can sit
  // beyond a deliberately short radius (Limens: Cabo Udra ~9km vs 6km radius).
  const preferredSet = new Set(spot.preferredStations ?? []);
  const preferredBuoySet = new Set(spot.preferredBuoys ?? []);
  const nearby = selectNearbyStations(spot, readings);

  // Buoys carry the x1.5 over-water boost, so they need the map's staleness
  // gate too: the query feeding this serves readings up to 6h old, and without
  // the gate one stale buoy would hold a verdict it stopped measuring hours
  // ago. A buoy with no timestamp at all is treated as fresh — production
  // always supplies one, fixtures usually do not.
  const nearbyBuoys: { b: BuoyWind; distKm: number }[] = [];
  let staleBuoysDropped = 0;
  for (const b of buoyWinds) {
    if (b.lat === 0 || b.lon === 0 || b.wind_speed <= 0) continue;
    // Same rule as the map: a copy of a land station's anemometer is not over water.
    if (isLandStationCopy(b.station_id)) continue;
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
    // Per-source staleness gate, the same one the map uses. The SQL window is
    // deliberately wider than any gate so that this decision lives in one
    // place: an hourly network is not stale for being hourly, and a five-minute
    // one that has gone quiet for an hour is.
    if (r.time != null) {
      const ageMin = (now - new Date(r.time).getTime()) / 60_000;
      if (Number.isFinite(ageMin) && ageMin > staleGateMinFor(r.station_id)) continue;
    }
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

  // The gust SHOWN and SENT (maxGustKt), the map's reportedGustKt: the highest gust among the
  // sources whose gust agrees with their OWN mean (gustIsPlausible), instead of the highest raw
  // gust dropped whole when it exceeded 3x the spot's mean. gustMax above stays what it was,
  // because it is the Cesantes detector's input and that detector was validated with it.
  const reportedGusts: number[] = [];
  for (const { r, distKm } of nearby) {
    if (r.wind_gust == null || distKm > GUST_MAX_DIST_KM || isWindBlacklisted(r.station_id)) continue;
    const g = msToKnots(r.wind_gust);
    if (gustIsPlausible(r.wind_speed == null ? null : msToKnots(r.wind_speed), g)) reportedGusts.push(g);
  }
  for (const { b, distKm } of nearbyBuoys) {
    if (b.wind_gust == null || distKm > 12) continue;
    const g = msToKnots(b.wind_gust);
    if (gustIsPlausible(msToKnots(b.wind_speed), g)) reportedGusts.push(g);
  }
  const reportedGust = peakPlausibleGustKt(reportedGusts);

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
  let rainVetoReason: string | null | undefined;
  let regimeVetoReason: string | null | undefined;

  if (spot.id === 'cesantes') {
    // Rain at the spot's own stations, each read with its network's meaning. Without
    // rain data (tests, a failed query) there is no veto, as before it existed.
    const rainVeto = ctx?.precip
      ? assessRainVeto({
        stationIds: nearby.map((n) => n.r.station_id),
        precip: ctx.precip,
        nowMs: ctx.nowMs ?? Date.now(),
      })
      : null;
    if (rainVeto) rainVetoReason = rainVeto.vetoed ? rainVeto.reason : null;
    // A front aloft: the SW at the surface is the front itself, no breeze to amplify.
    // Cesantes is in the Rías; no upper-air data = no veto, as before.
    const regime = assessSynopticRegime(ctx?.upperWind?.rias);
    if (regime) regimeVetoReason = regime.vetoed ? regime.reason : null;
    const veto = rainVeto?.vetoed ? rainVeto : regime;
    const boost = applyCesantesBoost(rawWindKt, readings, buoyWinds, avgDir, gustMax > 0 ? gustMax : null, veto);
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
    maxGustKt: reportedGust == null ? 0 : Math.round(reportedGust),
    avgDir,
    verdict,
    stationCount: count,
    inferredDir,
    rawWindKt,
    boostedBy,
    boostConfidence,
    staleBuoysDropped,
    ...(rainVetoReason !== undefined ? { rainVeto: rainVetoReason } : {}),
    ...(regimeVetoReason !== undefined ? { regimeVeto: regimeVetoReason } : {}),
  };
}
