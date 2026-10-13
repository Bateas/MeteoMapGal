/**
 * Cesantes Canalization Predictor — Ría de Vigo interior wind boost.
 *
 * Pattern (observed by user): on a sunny afternoon the land heats, a thermal low
 * forms inland and a SW marine breeze is drawn up the ría. Cesantes, at the end of
 * the ensenada de San Simón, gets that breeze harder than the sheltered stations
 * around it read it. No weather station sits in Cesantes valley, so the figure is
 * predicted from the nearby stations, the air-water ΔT and the interior sun.
 *
 * The amplification exists only WITH the thermal low: with sun, Cesantes blows
 * 1.4-1.6x what Porto de Vigo reads; without sun, 0.3-0.6x.
 *
 * Why there is no synoptic mode any more. A Mode 1 used to multiply the SW wind of
 * the mouth buoys (A Guarda, Silleiro, Cíes) by 1.4-2.5. Replayed against every
 * field-truth instant we have, it never decided one correctly: on 4-ago it gave 17kt
 * with 2kt on the water, and Silleiro fed 30kt phantoms into Telegram. A buoy outside
 * the ría says what the Atlantic is doing, not what gets into San Simón. Only the
 * thermal breeze below remains, and two things veto it: rain at the nearby stations
 * (rainVeto.ts) and a front coming in aloft (synopticRegime.ts) — with 15+ kt S-SW-W
 * at 850 hPa the SW at the surface is the front itself and there is no breeze to
 * amplify (28-sep: app 17-18 kt, water <= 10).
 *
 * Returns prediction for SAILORS to plan sessions: "Cesantes likely 14kt SW now"
 */

import type { NormalizedStation, NormalizedReading } from '../types/station';

/** Why the thermal breeze cannot be there: rain (RainVeto) or a front (RegimeVeto). */
export interface ThermalVeto {
  vetoed: boolean;
  reason: string | null;
}

// ── Types ────────────────────────────────────────────────────

export interface CesantesPrediction {
  /** Active prediction or none */
  active: boolean;
  /** Confidence 0-100% */
  confidence: number;
  /** Predicted wind speed in Cesantes (kt) */
  predictedKt: number | null;
  /** Predicted wind direction (degrees) */
  predictedDir: number | null;
  /** Predicted wind over the base the boost was built on */
  boostFactor: number;
  /** The prediction with the WHOLE sun share: what the breeze is worth at full strength. The
   *  callers' «at least 4 kt over the measured wind» test reads this one, and they apply
   *  predictedKt. Testing the dimmed figure dropped the dusk ramp (9 kt over 6 measured = 3 < 4,
   *  shown 6) and left a 4 kt step near 270 W/m². */
  predictedKtFullSun: number | null;
  /** Human-readable signals contributing */
  signals: string[];
  /** Severity for alert */
  severity: 'info' | 'moderate' | 'high';
}

// ── Constants ────────────────────────────────────────────────

/** Lower edge of the SW arc (S-SSE, 160°). */
const SW_DIR_MIN = 160;
/** Upper edge of the arc for the LOCAL flow (stations near Cesantes). The ria funnels and
 *  turns the flow: on 25-sep the WNW (Porto de Vigo 277-294, O Viso 293-315) fed a SW-WSW
 *  breeze at Cesantes coming in through Rande, 14kt with wings out, while a 280 edge kept
 *  the detector off until O Viso veered at 16:47. What stays blocked is the true northerly
 *  (N-NNW, past 315) that the islands and Monte da Vela stop. */
const LOCAL_ARC_MAX = 315;

/** Thermal breeze (afternoon SW pattern) thresholds */
const THERMAL_HOUR_MIN = 12;
const THERMAL_HOUR_MAX = 20;
const THERMAL_MIN_AIR_TEMP = 16; // °C — sun heats land
const THERMAL_MIN_DELTA_T = 2;   // °C land-sea differential
/** Nearby stations must already show at least this much wind (kt) for the thermal
 *  breeze to count as ESTABLISHED. Canalization amplifies an existing breeze; a
 *  large air-water ΔT alone is only the setup, not actual wind. Below this the
 *  prediction is suppressed (user ground-truth: glassy-calm webcam + 3kt stations
 *  must NOT yield an 11kt prediction). The documented pattern has nearby stations
 *  at 5-12kt during real canalization. */
const THERMAL_MIN_BASE_KT = 5;

/** W/m² of INTERIOR sun below which the afternoon thermal breeze is over.
 *
 *  The breeze opens on the hour (12-20, and hour 20 counts until 20:59) and on the
 *  air-water ΔT, and after sunset the air cools slowly, so ΔT stays at 4-5°C. Without
 *  a look at the sun a 4kt residual flow was then handed the full +8kt. 25-sep
 *  20:23-20:45: interior 0 W/m², shown BUENO 13kt, 5.5kt on the water (webcam), the
 *  field report at 20:33 said "less". That one was the map only: the alert channel
 *  stored calm 3-4kt. The alert channel did the same on 22-sep 20:18-20:58 (good 12
 *  over a 4kt mean): its interior value there was 109.5 W/m², the inland maximum set by
 *  an amateur radiometer that reads 109.5 day and night (13-27 Sep); the official
 *  stations were 0-12.
 *
 *  Only a MEASURED low value switches it off. Unknown keeps the old behaviour, so a
 *  radiometer that stops reporting cannot kill the breeze at 15h. 150 sits below the
 *  sun of every boosted afternoon cycle of 12-25 Sep before 19:20 and above the dusk
 *  values of both paths. Do NOT lower it to 110 or less: the alert channel would never
 *  veto (at 100 it removes 0 of the 256 boosted rows of 13-27 Sep; at 150, 11). */
const MIN_SOLAR_FOR_THERMAL_BREEZE = 150;

/** W/m² of interior sun at which the thermal boost is whole. Between the off value and this one
 *  the boost grows in a straight line: the thermal low weakens with the sun, it does not switch
 *  off. 12-oct: whole boost up to 18:59 with the interior peak falling 384 -> 144 W/m², then off
 *  in one cycle (13-14 -> 5 kt) while the water went 13-14 at 17:44 to 6-8 at 19:12; and since
 *  the sun sat near 150, the map and the server crossed the line at different cycles. */
const FULL_SOLAR_FOR_THERMAL_BREEZE = 400;

/** Interior solar readings older than this do not count (AEMET arrives ~90 min late and the map
 *  keeps a station's last reading): an old afternoon value kept the map at the whole boost while
 *  the server, with fresh readings, had already measured dusk. */
export const INTERIOR_SOLAR_MAX_AGE_MS = 45 * 60_000;

/** Inland of the ría, where the thermal low forms. East of Cesantes and up the
 *  Miño valley — deliberately NOT the spot's own neighbourhood. */
const INTERIOR_ZONE = { lonMin: -8.60, lonMax: -7.80, latMin: 42.10, latMax: 42.60 };
/** And no farther than this from Cesantes: the map only holds its sector (Rías, 30 km around
 *  -8.68 42.30), the server the whole of Galicia. Without the limit the server could see sun at
 *  Ourense the map never sees. 12-oct: 6 MeteoGalicia stations inside; the stuck amateur
 *  radiometer reading 109.5 W/m² day and night (wu_ICARBA26, 37 km) stays out. */
export const INTERIOR_MAX_KM_FROM_CESANTES = 22;

/** Porto de Vigo: the throat the afternoon breeze has to come through on its way to San Simón. */
export const PORT_VIGO_STATION_ID = 'mg_14001';
/** Its reading counts for the rebound test only while this fresh (MeteoGalicia reports every 10 min). */
export const PORT_WIND_MAX_AGE_MS = 30 * 60_000;
/** The «rebound»: the stations around Cesantes read WNW-NW (past this, up to LOCAL_ARC_MAX)... */
const REBOUND_LOCAL_DIR_MIN = 290;
/** ...while Porto de Vigo reads the flow turned to SW-S or further round (below this)... */
const REBOUND_PORT_DIR_MAX = 225;
/** ...with real wind at the port: a direction under 3 kt says nothing. */
const REBOUND_PORT_MIN_KT = 3;

export const CESANTES_LAT = 42.307;
export const CESANTES_LON = -8.619;

function kmFromCesantes(lat: number, lon: number): number {
  const p = Math.PI / 180;
  const a = Math.sin((lat - CESANTES_LAT) * p / 2) ** 2
    + Math.cos(CESANTES_LAT * p) * Math.cos(lat * p) * Math.sin((lon - CESANTES_LON) * p / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

/** Porto de Vigo's wind for the rebound test, the same on map and server: null when there is no
 *  reading, no clock on it or it is older than PORT_WIND_MAX_AGE_MS. */
export function freshPortWind(
  reading: { kt: number | null; dirDeg: number | null; atMs: number } | null | undefined,
  nowMs: number,
): { kt: number | null; dirDeg: number | null } | null {
  if (!reading || !Number.isFinite(reading.atMs) || nowMs - reading.atMs > PORT_WIND_MAX_AGE_MS) return null;
  return { kt: reading.kt, dirDeg: reading.dirDeg };
}

/** Whether a station is in the interior that drives the thermal low (box + distance). */
export function inInteriorZone(lat: number, lon: number): boolean {
  return lon >= INTERIOR_ZONE.lonMin && lon <= INTERIOR_ZONE.lonMax
    && lat >= INTERIOR_ZONE.latMin && lat <= INTERIOR_ZONE.latMax
    && kmFromCesantes(lat, lon) <= INTERIOR_MAX_KM_FROM_CESANTES;
}

// ── Detector ─────────────────────────────────────────────────

/**
 * Predict Cesantes canalization conditions (afternoon thermal breeze).
 */
export function predictCesantesCanalization(
  /** Air temperature near Cesantes (°C) — for thermal breeze detection */
  airTempLocal: number | null = null,
  /** Water temperature (sea surface) — for ΔT thermal calculation */
  waterTemp: number | null = null,
  /** Consensus wind of the nearby stations (kt) — the breeze that gets amplified */
  localStationKt: number | null = null,
  /** Measured local/consensus wind direction (deg). When the real wind is a
   *  meaningful flow from OUTSIDE the SW arc (e.g. N/NW), the SW thermal breeze
   *  is NOT establishing — the islands + Monte da Vela block N/NW from reaching
   *  the Cesantes shore — so the thermal canalization prediction is suppressed. */
  localWindDir: number | null = null,
  /** Peak solar radiation INLAND (W/m²) — see computeInteriorSolar. The spot can be
   *  under mist and still blow; what has to be sunny is the interior that forms the
   *  low. Only a MEASURED value below MIN_SOLAR_FOR_THERMAL_BREEZE switches the
   *  breeze off; unknown does not. */
  solarRadInterior: number | null = null,
  /** Peak local station wind gust (kt) — distinguishes sheltered thermal lulls from dead calm */
  localGustKt: number | null = null,
  /** Rain at the nearby stations (assessRainVeto) or a front aloft
   *  (assessSynopticRegime). Vetoed = no thermal low pulling, whatever the ΔT
   *  and the clock say. */
  veto: ThermalVeto | null = null,
  /** Wind at Porto de Vigo (PORT_VIGO_STATION_ID), only when fresh (PORT_WIND_MAX_AGE_MS).
   *  Unknown = no rebound test, as before it existed. */
  portWind: { kt: number | null; dirDeg: number | null } | null = null,
): CesantesPrediction {
  const inactive: CesantesPrediction = {
    active: false,
    confidence: 0,
    predictedKt: null,
    predictedDir: null,
    boostFactor: 1,
    predictedKtFullSun: null,
    signals: [],
    severity: 'info',
  };
  if (veto?.vetoed) return { ...inactive, signals: veto.reason ? [veto.reason] : [] };

  // ── Thermal breeze (afternoon SW pattern) ──
  // Classic Cesantes pattern Apr-Oct: sun heats land → low pressure inland → SW marine breeze.
  const hour = new Date().getHours();
  const isThermalHour = hour >= THERMAL_HOUR_MIN && hour <= THERMAL_HOUR_MAX;
  const isWarmAir = airTempLocal !== null && airTempLocal >= THERMAL_MIN_AIR_TEMP;
  const deltaT = (airTempLocal !== null && waterTemp !== null) ? airTempLocal - waterTemp : null;
  const isThermalDelta = deltaT !== null && deltaT >= THERMAL_MIN_DELTA_T;

  if (!isThermalHour || !isWarmAir || !isThermalDelta) {
    return inactive;
  }
  // The interior has gone dark: no thermal low left to pull the breeze in, whatever
  // the ΔT and the clock say. See MIN_SOLAR_FOR_THERMAL_BREEZE.
  if (solarRadInterior != null && solarRadInterior < MIN_SOLAR_FOR_THERMAL_BREEZE) {
    return inactive;
  }
  // A meaningful measured wind (>=5kt) from OUTSIDE the SW arc (160-315°) means
  // the SW thermal breeze isn't establishing today (e.g. N/NW synoptic). The
  // islands + Monte da Vela block N/NW from channeling into Cesantes, so do NOT
  // predict an SW canalization boost on those days (user ground-truth: NW is
  // tapado, no sigue el patrón de entrada por la boca de la ría).
  if (localWindDir != null && (localStationKt ?? 0) >= 5
      && (localWindDir < SW_DIR_MIN || localWindDir > LOCAL_ARC_MAX)) {
    return inactive;
  }
  // The rebound. With a NW-NNW flow outside, the stations around Cesantes read it WNW-NW
  // (Cangas and O Viso take it over the Morrazo) while Porto de Vigo, at the throat a breeze
  // has to come through, reads it turned to S-SSW by the harbour. That is the outside flow
  // deflected, not a SW breeze being funnelled up to San Simón, and there is nothing to
  // amplify. 13-oct 15:43-16:33: BUENO 11-13 shown, with an alert, consensus 291-296°, the
  // port at 209° and 2-5 kt on the water at 15:31, 16:01 and 16:45. On the field truths at
  // Cesantes (46): mean error 1.65 -> 1.48 kt, none broken; 25-sep (14 kt, wings out) had the
  // port WNW as well and stays. Narrow on purpose: a 275° consensus with the port at 209°
  // (13-oct 16:23) still passes.
  if (localWindDir != null && localWindDir > REBOUND_LOCAL_DIR_MIN && localWindDir <= LOCAL_ARC_MAX
      && portWind?.dirDeg != null && portWind.dirDeg < REBOUND_PORT_DIR_MAX
      && (portWind.kt ?? 0) >= REBOUND_PORT_MIN_KT) {
    return inactive;
  }
  // Reality check: canalization AMPLIFIES an existing breeze, it does not create
  // wind from a temperature gradient. If the nearby stations are essentially calm
  // the thermal breeze has not filled in — a big ΔT is only the setup. Without
  // this, a glassy-calm evening (warm air over cool water = huge ΔT) maxed the
  // +8kt boost on top of 3kt measured → a phantom 11kt while the webcam showed a
  // mirror-flat ría (user-reported). Require a real measured breeze first.
  //
  // Distinguish real breeze in sheltered stations:
  // 1) Station mean >= 5kt
  // 2) Station mean >= 4kt with strong thermal setup (ΔT >= 4°C)
  // 3) Gust >= 10kt with ΔT >= 5°C (thermal momentum penetrating friction)
  //
  // Branches 2 and 3 accept a mean below the 5kt at which the out-of-arc
  // guard above starts to apply, so they carry their own: a KNOWN direction
  // inside the SW arc. With a low mean the direction is what separates a
  // breeze filling in from a stray puff, and unknown cannot confirm SW.
  // Without it a 3kt north wind with an 11kt gust came back as a 13kt SW
  // canalization (21-sep). Both also need a measured mean: they exist to
  // rescue a LOW one, and with no mean there is nothing to rescue.
  const measuredKt = localStationKt;
  const dirInSwArc = localWindDir != null
    && localWindDir >= SW_DIR_MIN && localWindDir <= LOCAL_ARC_MAX;
  const lowMeanUsable = measuredKt != null && dirInSwArc;
  const meanConfirms = (measuredKt ?? 0) >= THERMAL_MIN_BASE_KT;
  const deltaTConfirms = lowMeanUsable && measuredKt >= 4.0 && deltaT >= 4.0;
  const gustConfirms = lowMeanUsable && (localGustKt ?? 0) >= 10.0 && deltaT >= 5.0;
  const hasEstablishedBreeze = meanConfirms || deltaTConfirms || gustConfirms;

  if (!hasEstablishedBreeze || measuredKt == null) return inactive;

  // Use local station wind (or effective base of 5kt if confirmed via gust/strong ΔT)
  const baseKt = Math.max(localStationKt ?? 5, ((localGustKt ?? 0) >= 10 ? 5 : (localStationKt ?? 5)));
  // +2kt per °C of land-sea ΔT, max +8kt — scaled by how far the breeze has come in.
  // The ΔT stays high all afternoon, so on its own it handed out the full +8kt while the
  // breeze was only starting (25-sep 14:11: 12kt shown, 7.5 on the water) and again while it
  // was dying (18:10: 15kt shown, 12.5 on the water). The nearby gust is what shows the
  // breeze arriving at a sheltered station before its mean moves: 8kt gust = half the boost,
  // 10kt or more = all of it. Unknown gust: three quarters, never the full amount on no evidence.
  const established = localGustKt == null ? 0.75 : Math.min(1, Math.max(0.4, (localGustKt - 6) / 4));
  // And by the interior sun: whole from FULL_SOLAR_FOR_THERMAL_BREEZE, none at the off value (unknown = whole).
  const sunShare = solarRadInterior == null ? 1 : Math.min(1, Math.max(0,
    (solarRadInterior - MIN_SOLAR_FOR_THERMAL_BREEZE) / (FULL_SOLAR_FOR_THERMAL_BREEZE - MIN_SOLAR_FOR_THERMAL_BREEZE)));
  const fullBoostKt = Math.min(8, deltaT * 2) * established;
  const thermalBoostKt = fullBoostKt * sunShare;
  // Sanity cap: pure thermal breeze capped at 17kt max so it NEVER over-boosts on normal days
  const predictedKt = Math.min(17, Math.round(baseKt + thermalBoostKt));
  const predictedKtFullSun = Math.min(17, Math.round(baseKt + fullBoostKt));
  // 8, not 10: a graded boost reports the early breeze (8kt) instead of hiding it as calm.
  if (predictedKt < 8) return inactive;

  // Report what the stations MEASURED, not the 5kt floor the boost is built
  // on. Below the floor keep the decimal: rounding 4.8 up to "5" would print
  // the very number the reading failed to reach.
  const meanText = meanConfirms ? measuredKt.toFixed(0) : measuredKt.toFixed(1);
  const stationsLine = meanConfirms
    ? `Estaciones cercanas leen ${meanText}kt de media — Cesantes acelerada por canalización local`
    : gustConfirms
      ? `Estaciones cercanas leen ${meanText}kt de media, racha de ${localGustKt!.toFixed(0)}kt — la racha confirma la brisa; Cesantes acelerada por canalización local`
      : `Estaciones cercanas leen ${meanText}kt de media — brisa floja pero con ΔT fuerte; Cesantes acelerada por canalización local`;
  return {
    active: true,
    confidence: 70,
    predictedKt,
    predictedDir: 230, // Typical SW thermal breeze
    boostFactor: predictedKt / Math.max(baseKt, 1),
    predictedKtFullSun,
    signals: [
      `Brisa térmica vespertina (${hour}h, aire ${airTempLocal!.toFixed(0)}°C, ΔT +${deltaT.toFixed(1)}°C)`,
      stationsLine,
    ],
    severity: predictedKt >= 15 ? 'high' : 'moderate',
  };
}

/** Peak solar radiation inland — the proof that the thermal low has an engine.
 *
 *  Takes the MAXIMUM rather than the nearest or the average on purpose: one
 *  station clearly in the sun is enough to prove the interior is heating,
 *  whereas an average is dragged down by whichever stations happen to sit
 *  under a passing cloud. The failure this guards against is the whole
 *  interior being covered, and that shows up as every station reading low. */
export function computeInteriorSolar(
  stations: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
  nowMs: number = Date.now(),
): number | null {
  let peak: number | null = null;
  for (const st of stations) {
    if (!inInteriorZone(st.lat, st.lon)) continue;
    const r = readings.get(st.id);
    if (r?.solarRadiation == null) continue;
    const at = r.timestamp instanceof Date ? r.timestamp.getTime() : new Date(r.timestamp as unknown as string).getTime();
    if (!Number.isFinite(at) || nowMs - at > INTERIOR_SOLAR_MAX_AGE_MS) continue;
    if (peak === null || r.solarRadiation > peak) peak = r.solarRadiation;
  }
  return peak;
}
