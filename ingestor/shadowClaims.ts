/**
 * Shadow record of what the map says: the server runs the SAME pure functions the browser runs
 * and stores their answer in alert_log when it changes (logic: shadowClaimsLogic.ts). Stored
 * only; sent to nobody, shown nowhere.
 *
 * Recorded (alert_type): shadow-fog-physics, shadow-cross-sea, shadow-pressure, shadow-frost,
 * shadow-rain-now (per spot), shadow-beach-day (per beach spot), shadow-sea-breeze.
 *
 * Where the server cannot see what the browser sees, it is said in the row instead of guessed:
 *  - fog: the physics path only (buoys + stations). The alert on the map also weighs cameras,
 *    the solar signature and airport visibility; those are not in this process.
 *  - rain now: stations + forecast, without the radar layer (`radar: false`).
 *  - beach day: `foggy` is unknown here (it comes from the fog alert with cameras).
 *  - frost and sea breeze read the clock in local time: the row carries `tzOffsetMin`.
 *
 * Never throws and is never awaited by the poll. Needs
 *   GRANT SELECT, INSERT ON alert_log TO meteomap_app;   (already in schema.sql)
 */
import { getPool, stationAltitudeSql, sourceLabel } from './db.js';
import { log } from './logger.js';
import { getForecast } from './forecastFetcher.js';
import { buoyWindToBuoyReading, type BuoyWind } from './analyzerLogic.js';
import { SECTORS, type Sector } from '../src/config/sectors.js';
import { getSpotsForSector, isBeachSpot } from '../src/config/spots.js';
import { RIAS_BUOY_STATIONS, type BuoyReading } from '../src/api/buoyClient.js';
import { assessMaritimeFogRisk, activeRainVeto } from '../src/services/maritimeFogService.js';
import { assessCrossSeaRisk } from '../src/services/crossSeaService.js';
import { computePressureTrends, buildPressureTrendAlerts } from '../src/services/pressureTrendService.js';
import { checkFrost } from '../src/services/fieldAlertEngine.js';
import { assessRainNowcast } from '../src/services/rainNowcastService.js';
import { assessBeachDay } from '../src/services/beachDayService.js';
import { assessSeaBreezeRias } from '../src/services/seaBreezeService.js';
import { isBuoyFresh } from '../src/services/buoyUtils.js';
import { fastDistanceKm } from '../src/services/idwInterpolation.js';
import type { SpotScore } from '../src/services/spotScoringEngine.js';
import type { NormalizedReading, NormalizedStation, StationSource } from '../src/types/station.js';
import type { HourlyForecast } from '../src/types/forecast.js';
import {
  decideWrites, describeCycle, markWritten, seenFromRows,
  type SeenState, type ShadowClaim,
} from './shadowClaimsLogic.js';

/** The map recomputes more often; ten minutes is enough to date a change. */
export const SHADOW_MIN_GAP_MS = 9 * 60_000;
/** Engine scores older than this are not used for the beach day. */
const ENGINE_MAX_AGE_MS = 15 * 60_000;
/** Same reach as the discovery: 15 km around each extra coverage point. */
const EXTRA_COVERAGE_KM = 15;
const PG_UNDEFINED_TABLE = '42P01';
const PG_NO_PRIVILEGE = '42501';
const SOURCES = new Set<StationSource>(['aemet', 'meteogalicia', 'meteoclimatic', 'wunderground', 'netatmo', 'skyx', 'ipma']);

let storeOff = false;
let lastRunMs = 0;
let running = false;
let seen: Map<string, SeenState> | null = null;
let engine: { scores: Map<string, SpotScore>; at: number } | null = null;

/** The analyzer hands over the scores of the map's engine each cycle (for the beach day). */
export function noteEngineScores(scores: Map<string, SpotScore> | null, nowMs: number = Date.now()): void {
  engine = scores ? { scores, at: nowMs } : null;
}

/** Testing only. */
export function __resetShadowClaimsForTests(): void {
  storeOff = false; lastRunMs = 0; running = false; seen = null; engine = null;
}

interface StationRow {
  station_id: string; time: Date;
  wind_speed: number | null; wind_gust: number | null; wind_dir: number | null;
  temperature: number | null; humidity: number | null; precip: number | null;
  dew_point: number | null; solar_rad: number | null; pressure: number | null;
  latitude: number | null; longitude: number | null;
  name: string | null; source: string | null; altitude: number | null;
}

async function loadStations(): Promise<{ stations: NormalizedStation[]; readings: Map<string, NormalizedReading> }> {
  const altitude = await stationAltitudeSql();
  const { rows } = await getPool().query<StationRow>(`
    SELECT DISTINCT ON (r.station_id)
      r.station_id, r.time, r.wind_speed, r.wind_gust, r.wind_dir,
      r.temperature, r.humidity, r.precip, r.dew_point, r.solar_rad, r.pressure,
      s.latitude, s.longitude, s.name, s.source, ${altitude} AS altitude
    FROM readings r
    JOIN stations s ON s.station_id = r.station_id
    WHERE r.time > NOW() - INTERVAL '4 hours'
    ORDER BY r.station_id, r.time DESC
  `);
  const stations: NormalizedStation[] = [];
  const readings = new Map<string, NormalizedReading>();
  for (const r of rows) {
    if (r.latitude == null || r.longitude == null || (!r.latitude && !r.longitude)) continue;
    const label = r.source ?? sourceLabel(r.station_id);
    const source = (SOURCES.has(label as StationSource) ? label : 'wunderground') as StationSource;
    stations.push({
      id: r.station_id, source, name: r.name ?? r.station_id,
      lat: Number(r.latitude), lon: Number(r.longitude), altitude: r.altitude ?? 0,
    });
    readings.set(r.station_id, {
      stationId: r.station_id, timestamp: new Date(r.time),
      windSpeed: r.wind_speed, windGust: r.wind_gust, windDirection: r.wind_dir,
      temperature: r.temperature, humidity: r.humidity, precipitation: r.precip,
      solarRadiation: r.solar_rad, pressure: r.pressure, dewPoint: r.dew_point,
    });
  }
  return { stations, readings };
}

/** The oldest pressure of the last three hours per station: with the current one, the trend. */
async function loadOldestPressure(): Promise<Map<string, { time: Date; pressure: number }>> {
  const { rows } = await getPool().query<{ station_id: string; time: Date; pressure: number }>(`
    SELECT DISTINCT ON (station_id) station_id, time, pressure
    FROM readings
    WHERE time > NOW() - INTERVAL '3 hours' AND pressure IS NOT NULL
    ORDER BY station_id, time ASC
  `);
  return new Map(rows.map((r) => [r.station_id, { time: new Date(r.time), pressure: Number(r.pressure) }]));
}

async function loadBuoys(): Promise<BuoyReading[]> {
  const { rows } = await getPool().query<{
    station_id: number; time: Date; wind_speed: number | null; wind_dir: number | null; wind_gust: number | null;
    water_temp: number | null; air_temp: number | null; humidity: number | null;
    wave_height: number | null; wave_period: number | null; wave_dir: number | null;
  }>(`
    SELECT DISTINCT ON (station_id)
      station_id, time, wind_speed, wind_dir, wind_gust,
      water_temp, air_temp, humidity, wave_height, wave_period, wave_dir
    FROM buoy_readings
    WHERE time > NOW() - INTERVAL '6 hours'
    ORDER BY station_id, time DESC
  `);
  return rows.map((r) => {
    const meta = RIAS_BUOY_STATIONS.find((s) => s.id === r.station_id);
    const wind: BuoyWind = {
      station_id: r.station_id, time: r.time,
      wind_speed: r.wind_speed ?? 0, wind_dir: r.wind_dir, wind_gust: r.wind_gust,
      lat: meta?.lat ?? 0, lon: meta?.lon ?? 0, station_name: meta?.name ?? `Boya ${r.station_id}`,
      water_temp: r.water_temp, air_temp: r.air_temp, humidity: r.humidity,
      wave_height: r.wave_height, wave_period: r.wave_period, wave_dir: r.wave_dir,
    };
    return { ...buoyWindToBuoyReading(wind), timestamp: new Date(r.time).toISOString() };
  });
}

function inSector(sector: Sector, lat: number, lon: number): boolean {
  if (fastDistanceKm(sector.center[1], sector.center[0], lat, lon) <= sector.radiusKm) return true;
  return (sector.extraCoveragePoints ?? []).some((p) => fastDistanceKm(p.lat, p.lon, lat, lon) <= EXTRA_COVERAGE_KM);
}

async function loadSeen(): Promise<Map<string, SeenState>> {
  const { rows } = await getPool().query<{ alert_type: string; sector: string; level: string; subject: string | null; time: Date }>(`
    SELECT DISTINCT ON (alert_type, sector, params->>'subject')
      alert_type, sector, level, params->>'subject' AS subject, time
    FROM alert_log
    WHERE time > NOW() - INTERVAL '6 hours' AND alert_type LIKE $1
    ORDER BY alert_type, sector, params->>'subject', time DESC
  `, ['shadow-%']);
  return seenFromRows(rows);
}

/** What each solution answers for one sector, from data the server already holds. */
export function buildSectorClaims(input: {
  sector: Sector;
  stations: NormalizedStation[];
  readings: Map<string, NormalizedReading>;
  history: Map<string, NormalizedReading[]>;
  buoys: BuoyReading[];
  forecast: HourlyForecast[];
  engineScores: Map<string, SpotScore> | null;
  now: Date;
}): { claims: ShadowClaim[]; solutions: Set<string>; skipped: string[] } {
  const { sector, stations, readings, history, buoys, forecast, engineScores, now } = input;
  const nowMs = now.getTime();
  const claims: ShadowClaim[] = [];
  const solutions = new Set<string>();
  const skipped: string[] = [];
  const tzOffsetMin = -now.getTimezoneOffset();
  const add = (c: ShadowClaim) => { claims.push(c); solutions.add(c.type); };
  const attempt = (name: string, fn: () => void) => {
    try { fn(); } catch (err) { skipped.push(`${name} ${sector.id}: ${(err as Error).message}`); }
  };

  if (sector.coastal) {
    attempt('niebla', () => {
      const risk = assessMaritimeFogRisk(buoys, readings, stations);
      add({
        type: 'shadow-fog-physics', sector: sector.id, state: risk.level, score: risk.confidence,
        params: {
          airWaterDelta: risk.airWaterDelta, humidity: risk.humidity, windSpeed: risk.windSpeed, windDir: risk.windDir,
          isOnshore: risk.isOnshore, waterTemp: risk.waterTemp, airTemp: risk.airTemp, sourceBuoy: risk.sourceBuoy,
          rainVeto: activeRainVeto(readings, undefined, nowMs),
          freshBuoys: buoys.filter((b) => isBuoyFresh(b, undefined, nowMs)).length,
          cameras: false,
        },
        hypothesis: risk.hypothesis,
      });
    });
    attempt('mar cruzada', () => {
      const risk = assessCrossSeaRisk(buoys);
      add({
        type: 'shadow-cross-sea', sector: sector.id, state: risk.level, score: null,
        params: {
          angleDelta: risk.angleDelta, waveDir: risk.waveDir, windDir: risk.windDir, waveHeight: risk.waveHeight,
          windSpeed: risk.windSpeed, wavePeriod: risk.wavePeriod, sourceBuoy: risk.sourceBuoy,
        },
        hypothesis: risk.hypothesis,
      });
    });
    attempt('brisa', () => {
      const b = assessSeaBreezeRias(readings, stations, now);
      add({
        type: 'shadow-sea-breeze', sector: sector.id, state: b.phase, score: b.confidence,
        params: {
          active: b.active, deltaT: b.deltaT, strength: b.strength, coastTemp: b.coastTemp, inlandTemp: b.inlandTemp,
          onshoreAtCoast: b.onshoreAtCoast, tzOffsetMin,
        },
        hypothesis: b.hypothesis,
      });
    });
  }

  attempt('presion', () => {
    const trend = computePressureTrends(readings, history);
    const alert = buildPressureTrendAlerts(readings, history)[0];
    add({
      type: 'shadow-pressure', sector: sector.id, state: alert?.severity ?? 'none', score: alert?.score ?? null,
      params: { medianDelta: trend.medianDelta, droppingCount: trend.droppingCount, totalAnalyzed: trend.totalAnalyzed },
      hypothesis: alert ? `${alert.title}: ${alert.detail}` : null,
    });
  });

  if (forecast.length === 0) {
    skipped.push(`prevision ${sector.id}`);
  } else {
    attempt('helada', () => {
      const f = checkFrost(forecast, sector.center);
      add({
        type: 'shadow-frost', sector: sector.id, state: f.level, score: null,
        params: {
          minTemp: f.minTemp, cloudCover: f.cloudCover, windSpeed: f.windSpeed,
          from: f.timeWindow?.from ?? null, to: f.timeWindow?.to ?? null, tzOffsetMin,
        },
        hypothesis: null,
      });
    });
  }

  const spots = getSpotsForSector(sector.id);
  attempt('lluvia ahora', () => {
    for (const spot of spots) {
      const r = assessRainNowcast({ spotCenter: spot.center, radiusKm: spot.radiusKm, stations, readings, forecast, now, measured: null });
      add({
        type: 'shadow-rain-now', sector: sector.id, subject: spot.id, state: r.status, score: null,
        params: {
          rainingNow: r.rainingNow, intensityMm: r.intensityMm, nextRainHours: r.nextRainHours,
          nextRainProb: r.nextRainProb, stationName: r.stationName, radar: false,
        },
        hypothesis: r.summary,
      });
    }
  });

  if (sector.coastal) {
    if (!engineScores) {
      skipped.push(`dia de playa ${sector.id} (sin motor)`);
    } else {
      attempt('dia de playa', () => {
        // Sky and rain of the sector forecast, as the ticker reads them.
        let cloudCoverPct: number | null = null;
        let rainingNow = false;
        let rainSoon = false;
        if (forecast.length > 0) {
          const cur = forecast.reduce((best, h) =>
            (Math.abs(h.time.getTime() - nowMs) < Math.abs(best.time.getTime() - nowMs) ? h : best), forecast[0]);
          cloudCoverPct = cur.cloudCover ?? null;
          rainingNow = (cur.precipitation ?? 0) > 0.1;
          let prob = 0;
          let mm = 0;
          for (const h of forecast) {
            const dt = h.time.getTime() - nowMs;
            if (dt >= 0 && dt < 4 * 3600_000) {
              prob = Math.max(prob, h.precipProbability ?? 0);
              mm = Math.max(mm, h.precipitation ?? 0);
            }
          }
          rainSoon = mm > 0.2 || prob >= 60;
        }
        for (const spot of spots) {
          if (!isBeachSpot(spot.id)) continue;
          const sc = engineScores.get(spot.id);
          if (!sc) continue;
          const inputs = {
            cloudCoverPct,
            windKt: sc.effectiveWindKt ?? sc.wind?.avgSpeedKt ?? null,
            gustKt: sc.gustKt ?? null,
            airTempC: sc.airTemp ?? null,
            waterTempC: sc.waterTemp ?? null,
            rainingNow, rainSoon,
          };
          const res = assessBeachDay(inputs);
          add({
            type: 'shadow-beach-day', sector: sector.id, subject: spot.id, state: res.verdict, score: res.score,
            params: { ...inputs, foggy: null, reasons: res.reasons.join(' | ') },
            hypothesis: res.summary,
          });
        }
      });
    }
  }

  return { claims, solutions, skipped };
}

export async function runShadowClaims(nowMs: number = Date.now()): Promise<void> {
  if (storeOff || running || nowMs - lastRunMs < SHADOW_MIN_GAP_MS) return;
  running = true;
  lastRunMs = nowMs;
  try {
    const db = getPool();
    if (!seen) {
      try {
        seen = await loadSeen();
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === PG_NO_PRIVILEGE || code === PG_UNDEFINED_TABLE) {
          storeOff = true;
          log.warn('[Sombra] no se puede leer alert_log (falta la tabla o GRANT SELECT, INSERT ON alert_log TO meteomap_app): parado hasta reiniciar');
          return;
        }
        throw err;
      }
    }
    const [{ stations, readings }, oldest, buoys] = await Promise.all([loadStations(), loadOldestPressure(), loadBuoys()]);
    const now = new Date(nowMs);
    const engineScores = engine && nowMs - engine.at <= ENGINE_MAX_AGE_MS ? engine.scores : null;

    const claims: ShadowClaim[] = [];
    const solutions = new Set<string>();
    const skipped: string[] = [];
    for (const sector of SECTORS) {
      const secStations = stations.filter((s) => inSector(sector, s.lat, s.lon));
      const secReadings = new Map<string, NormalizedReading>();
      const history = new Map<string, NormalizedReading[]>();
      for (const s of secStations) {
        const r = readings.get(s.id);
        if (!r) continue;
        secReadings.set(s.id, r);
        const old = oldest.get(s.id);
        if (old && r.pressure != null) {
          history.set(s.id, [{ ...r, timestamp: old.time, pressure: old.pressure }, r]);
        }
      }
      let forecast: HourlyForecast[] = [];
      try {
        forecast = await getForecast(sector.id as 'embalse' | 'rias');
      } catch { /* said below as «prevision» */ }
      const out = buildSectorClaims({
        sector, stations: secStations, readings: secReadings, history,
        buoys: sector.coastal ? buoys : [], forecast, engineScores, now,
      });
      claims.push(...out.claims);
      out.solutions.forEach((s) => solutions.add(s));
      skipped.push(...out.skipped);
    }

    const { rows, changes } = decideWrites(claims, seen, nowMs);
    let written = 0;
    for (const { key, row } of rows) {
      try {
        await db.query(
          `INSERT INTO alert_log (time, alert_type, sector, level, score, params, hypothesis)
           VALUES (date_trunc('minute', NOW()), $1, $2, $3, $4, $5::jsonb, $6)`,
          [row.alertType, row.sector, row.level, row.score, JSON.stringify(row.params), row.hypothesis],
        );
        markWritten(seen, key, row.level, nowMs);
        written++;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === PG_NO_PRIVILEGE || code === PG_UNDEFINED_TABLE) {
          storeOff = true;
          log.warn('[Sombra] no se puede escribir en alert_log (falta GRANT SELECT, INSERT ON alert_log TO meteomap_app): parado hasta reiniciar');
          break;
        }
        log.warn(`[Sombra] no se pudo guardar ${key}: ${(err as Error).message}`);
      }
    }
    log.info(describeCycle(solutions.size, claims.length, changes, written, skipped));
  } catch (err) {
    log.warn(`[Sombra] ${(err as Error).message}`);
  } finally {
    running = false;
  }
}
