/**
 * Runs the map's scoring engine (src/services/spotScoringEngine) on the server's own rows and
 * compares it, spot by spot, with the alert pipeline's port of it (analyzerLogic.scoreSpot).
 *
 * The two are meant to answer the same question with the same arithmetic, but they are two
 * implementations and they drift: on 25-sep the map said 10kt at Lourido while the pipeline
 * (the one behind Telegram) said 5-6, and at Cesantes they applied different confidence gates.
 * Step one measured where and by how much they disagree (engine_verdict / engine_wind_kt in
 * spot_scores since 27-sep). Step two (1-oct) builds the alerts from the engine (alertResult);
 * ANALYZER_WIND=pipeline in the ingestor's environment goes back to the port without a deploy.
 *
 * Differences that exist ON PURPOSE and will show up here: the engine receives no thermal
 * context, reading history or NAO/AO (the server does not build them yet), and it sees each
 * buoy with its real timestamp, while the pipeline's adapter stamps every buoy "now".
 */
import { scoreAllSpots, type SpotScore } from '../src/services/spotScoringEngine.js';
import { displayVerdict, displayWindKt } from '../src/config/verdictStyles.js';
import { getSpotsForSector } from '../src/config/spots.js';
import type { NormalizedReading, NormalizedStation, StationSource } from '../src/types/station.js';
import type { BuoyReading } from '../src/api/buoyClient.js';
import type { PrecipSample } from '../src/services/precipSemantics.js';
import { buoyWindToBuoyReading, isWorthAlerting, type BuoyWind, type SpotResult, type StationReading, type UpperWindBySector, type Verdict } from './analyzerLogic.js';
import { sourceLabel } from './db.js';

const SOURCES = new Set<StationSource>(['aemet', 'meteogalicia', 'meteoclimatic', 'wunderground', 'netatmo', 'skyx', 'ipma']);

/** Database rows → the shapes the map's engine is fed in the browser. */
export function toEngineInputs(readings: StationReading[], buoys: BuoyWind[]): {
  stations: NormalizedStation[];
  readingMap: Map<string, NormalizedReading>;
  buoyReadings: BuoyReading[];
} {
  const stations: NormalizedStation[] = [];
  const readingMap = new Map<string, NormalizedReading>();
  for (const r of readings) {
    if (!r.latitude && !r.longitude) continue;                     // no coordinates yet
    const label = r.source ?? sourceLabel(r.station_id);
    const source = (SOURCES.has(label as StationSource) ? label : 'wunderground') as StationSource;
    stations.push({
      id: r.station_id, source, name: r.name ?? r.station_id,
      lat: r.latitude, lon: r.longitude, altitude: r.altitude ?? 0,
    });
    readingMap.set(r.station_id, {
      stationId: r.station_id,
      timestamp: r.time ? new Date(r.time) : new Date(),
      windSpeed: r.wind_speed, windGust: r.wind_gust, windDirection: r.wind_dir,
      temperature: r.temperature, humidity: r.humidity, precipitation: null,
      solarRadiation: r.solar_rad ?? null, pressure: r.pressure ?? null, dewPoint: r.dew_point ?? null,
    });
  }
  const buoyReadings = buoys.map((b) => ({
    ...buoyWindToBuoyReading(b),
    // The real age, as the browser sees it; the pipeline's adapter says "now".
    timestamp: b.time ? new Date(b.time).toISOString() : new Date().toISOString(),
  }));
  return { stations, readingMap, buoyReadings };
}

/** The engine's scores for every non-surf spot of both sectors. `precipHistory` is the rain
 *  the pipeline read for the Cesantes veto, so both answer with the same rain. */
export function scoreWithEngine(
  readings: StationReading[],
  buoys: BuoyWind[],
  precipHistory?: Map<string, PrecipSample[]>,
  /** 850 hPa per sector: the same front veto the map applies (synopticRegime.ts) */
  upperWind?: UpperWindBySector,
): Map<string, SpotScore> {
  const { stations, readingMap, buoyReadings } = toEngineInputs(readings, buoys);
  const out = new Map<string, SpotScore>();
  for (const sector of ['embalse', 'rias'] as const) {
    const spots = getSpotsForSector(sector).filter((s) => s.category !== 'surf');
    for (const [id, score] of scoreAllSpots(spots, stations, readingMap, buoyReadings, undefined, undefined, undefined, precipHistory, upperWind?.[sector] ?? null)) out.set(id, score);
  }
  return out;
}

export interface EngineView { verdict: string; windKt: number | null }

/** What the popup would show for a score: 'unknown' and no figure while provisional. */
export function engineView(score: SpotScore | undefined): EngineView | null {
  if (!score) return null;
  const kt = displayWindKt(score);
  return { verdict: displayVerdict(score), windKt: kt == null ? null : Math.round(kt * 10) / 10 };
}

/**
 * The result the alerts are built from: the engine's verdict, wind, direction and station count
 * whenever it has a firm score, so Telegram says what the map says. The port in scoreSpot lacks
 * the engine's spatial corroboration and only sees the buoys inside the spot's radius: on 1-oct,
 * with north wind, it called Limens calm 4kt (the WU next door at 2-4kt set its median and the
 * outlier rule halved the two MeteoGalicia stations at 14-16kt) while the map said 9-10. Against
 * the field truths since August the engine is as good or better, and closer on windy days.
 * Kept from the pipeline: the gust (the same spotGustKt), the rain veto and the stale-buoy count.
 * A provisional or missing engine score falls back to the pipeline, never to silence.
 */
export function alertResult(pipeline: SpotResult, score: SpotScore | undefined): SpotResult {
  const e = engineView(score);
  if (!score || !e || e.verdict === 'unknown' || e.windKt == null) return pipeline;
  const channeling = score.channeling?.active ? score.channeling : null;
  return {
    ...pipeline,
    verdict: e.verdict as Verdict,
    avgWindKt: Math.round(e.windKt), // the map shows whole knots, and the alert prints this figure
    avgDir: score.wind?.dirDeg ?? pipeline.avgDir,
    stationCount: score.wind?.stationCount ?? pipeline.stationCount,
    rawWindKt: score.wind ? Math.round(score.wind.avgSpeedKt * 10) / 10 : undefined,
    boostedBy: channeling ? 'cesantes-canalization' : null,
    boostConfidence: channeling ? channeling.confidence : undefined,
  };
}

export interface Divergence { spotId: string; pipeline: { verdict: string; windKt: number }; engine: EngineView }

/** Spots where the two differ by 2kt or more, or where one would announce the spot and the
 *  other would not. A calm-vs-light split 1kt apart is left out: it changes no alert, and on a
 *  replay of 25-sep it was half of every cycle's list. Every score is stored either way. */
export function findDivergences(results: SpotResult[], engine: Map<string, SpotScore>): Divergence[] {
  const out: Divergence[] = [];
  for (const r of results) {
    const e = engineView(engine.get(r.spot.id));
    if (!e || e.verdict === 'unknown' || r.verdict === 'unknown') continue;
    const ktGap = e.windKt == null ? 0 : Math.abs(e.windKt - r.avgWindKt);
    if (ktGap >= 2 || isWorthAlerting(e.verdict, e.windKt) !== isWorthAlerting(r.verdict, r.avgWindKt)) {
      out.push({ spotId: r.spot.id, pipeline: { verdict: r.verdict, windKt: r.avgWindKt }, engine: e });
    }
  }
  return out;
}

/** One log line per cycle, silent when they agree. */
export function describeDivergences(divs: Divergence[], compared: number): string | null {
  if (divs.length === 0) return null;
  const parts = divs.map((d) => `${d.spotId} ${d.pipeline.verdict} ${d.pipeline.windKt}kt vs ${d.engine.verdict} ${d.engine.windKt ?? '?'}kt`);
  return `Engine vs pipeline: ${divs.length}/${compared} spots differ — ${parts.join(', ')}`;
}
