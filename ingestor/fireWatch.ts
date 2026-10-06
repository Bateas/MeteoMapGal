/**
 * Fire watch cycle — dry-lightning post-storm vigilance.
 *
 * Every 30 min (wired in index.ts, fire-and-forget) this queries the last
 * 12h of cloud-to-ground strikes plus the precipitation context around them,
 * runs the pure classifier (fireWatchLogic.ts), and sends ONE message with the
 * zones under watch that no recent message covered. The point is to warn
 * 7-18h BEFORE FIRMS confirms a hotspot — otherwise we only learn about a
 * fire when the satellite sees it.
 *
 * No new tables: which zones went out lives in the dispatcher, restored after
 * a restart from the stored sends; the 12h strike window re-derives the
 * zones on the next cycle.
 */

import { getPool } from './db.js';
import { log } from './logger.js';
import { haversineDistance } from '../src/services/geoUtils.js';
import { dispatchFireWatchDigest, fireWatchAlertedZones } from './alertDispatcher.js';
import {
  computeFireWatch,
  findMuteGauges,
  freshZones,
  placeName,
  type FireWatchStrike,
  type FireWatchZone,
  type RainReading,
} from './fireWatchLogic.js';

// ── Config ──────────────────────────────────────────

/** Strike lookback. Matches the ignition physics: a zone stays interesting
 *  for hours after the storm passed, but beyond ~12h FIRMS takes over. */
const STRIKE_WINDOW_HOURS = 12;
/** Rain lookback = strike window + the 30 min the rain window starts before
 *  the strike + the reading a day counter measures from, with margin. */
const RAIN_WINDOW_HOURS = 15;
/** Max distance zone centroid → named station for the "cerca de X" label. */
const NEAREST_NAME_KM = 25;
/** How far back the mute-gauge check looks, and how often it is recomputed. */
const MUTE_LOOKBACK_DAYS = 40;
const MUTE_REFRESH_MS = 12 * 60 * 60_000;
let muteCache: { at: number; ids: Set<string> } | null = null;

/**
 * Gauges that read 0 when it rains around them (findMuteGauges), from the daily totals of the
 * hourly aggregate: one light query every 12 h. On failure the last set is kept (or none: then
 * every gauge votes, as before).
 */
async function muteGauges(): Promise<Set<string>> {
  if (muteCache && Date.now() - muteCache.at < MUTE_REFRESH_MS) return muteCache.ids;
  try {
    const db = getPool();
    const [daily, st] = await Promise.all([
      db.query(
        `SELECT station_id, ((bucket AT TIME ZONE 'Europe/Madrid')::date)::text AS day, SUM(total_precip) AS mm
         FROM readings_hourly
         WHERE bucket > NOW() - make_interval(days => $1) AND total_precip IS NOT NULL
         GROUP BY 1, 2`,
        [MUTE_LOOKBACK_DAYS],
      ),
      db.query(`SELECT station_id, latitude, longitude FROM stations`),
    ]);
    const coords = new Map<string, { lat: number; lon: number }>();
    for (const r of st.rows) coords.set(String(r.station_id), { lat: Number(r.latitude), lon: Number(r.longitude) });
    const ids = findMuteGauges(daily.rows.map((r) => ({ stationId: String(r.station_id), day: String(r.day), mm: Number(r.mm) })), coords);
    muteCache = { at: Date.now(), ids };
    log.info(`Fire watch: ${ids.size} pluviometros mudos fuera del voto${ids.size ? ` (${[...ids].slice(0, 12).join(', ')}${ids.size > 12 ? ', ...' : ''})` : ''}`);
    return ids;
  } catch (err) {
    log.warn(`Fire watch: mute-gauge check failed: ${(err as Error).message}`);
    return muteCache?.ids ?? new Set();
  }
}

// ── Queries (parameterized — never interpolate) ─────

async function queryRecentGroundStrikes(): Promise<FireWatchStrike[]> {
  const db = getPool();
  const result = await db.query(
    `SELECT time, lat, lon, peak_current
     FROM lightning_strikes
     WHERE time > NOW() - make_interval(hours => $1)
       AND cloud_to_cloud = FALSE
       AND is_galicia = TRUE
     ORDER BY time ASC
     LIMIT 5000`,
    [STRIKE_WINDOW_HOURS],
  );
  return result.rows.map((r) => ({
    time: new Date(r.time),
    lat: Number(r.lat),
    lon: Number(r.lon),
    peakCurrent: r.peak_current == null ? null : Number(r.peak_current),
  }));
}

interface StationMeta {
  lat: number;
  lon: number;
  name: string | null;
}

interface RainContext {
  rain: RainReading[];
  stationMeta: Map<string, StationMeta>;
}

/**
 * Precipitation readings around the strike window. `readings` has no coords
 * (schema gotcha) — JOIN stations for latitude/longitude, and grab the name
 * while we are there so alerts can say "cerca de Ribadavia" instead of raw
 * coordinates. Column is `precip` (NOT `precipitation`).
 */
async function queryRainContext(): Promise<RainContext> {
  const db = getPool();
  const result = await db.query(
    `SELECT r.time, r.station_id, r.precip, s.latitude, s.longitude, s.name
     FROM readings r
     JOIN stations s ON s.station_id = r.station_id
     WHERE r.time > NOW() - make_interval(hours => $1)
       AND r.precip IS NOT NULL
     ORDER BY r.time ASC
     LIMIT 60000`,
    [RAIN_WINDOW_HOURS],
  );

  const rain: RainReading[] = [];
  const stationMeta = new Map<string, StationMeta>();
  for (const row of result.rows) {
    const lat = Number(row.latitude);
    const lon = Number(row.longitude);
    rain.push({
      stationId: String(row.station_id),
      lat,
      lon,
      time: new Date(row.time),
      precip: Number(row.precip),
    });
    if (!stationMeta.has(row.station_id)) {
      stationMeta.set(String(row.station_id), { lat, lon, name: row.name ?? null });
    }
  }
  return { rain, stationMeta };
}

// ── Helpers ─────────────────────────────────────────

/**
 * Nearest official station to the zone centroid, as a place name ("cerca de X").
 * Official only: MeteoGalicia, AEMET and IPMA name their stations after the
 * place; home stations carry an id or their owner's label.
 */
function nearestStationName(
  zone: FireWatchZone,
  stationMeta: Map<string, StationMeta>,
): string | undefined {
  let bestName: string | undefined;
  let bestKm = NEAREST_NAME_KM;
  for (const [id, meta] of stationMeta) {
    if (!meta.name || !/^(mg|aemet|ipma)_/.test(id)) continue;
    const km = haversineDistance(zone.lat, zone.lon, meta.lat, meta.lon);
    if (km < bestKm) {
      bestKm = km;
      bestName = placeName(meta.name);
    }
  }
  return bestName;
}

// ── Public entry ────────────────────────────────────

/**
 * One fire-watch cycle. Fail-soft: any error is a log.warn, never throws —
 * this must not be able to take the ingestor down.
 */
export async function runFireWatchCycle(): Promise<void> {
  try {
    const strikes = await queryRecentGroundStrikes();
    if (strikes.length === 0) {
      // Total silence on zero activity — calm days must not add log noise.
      return;
    }

    const { rain, stationMeta } = await queryRainContext();
    const mute = await muteGauges();
    const now = Date.now();
    const result = computeFireWatch(strikes, mute.size ? rain.filter((r) => !mute.has(r.stationId)) : rain, now);

    // The zones no recent message covered go out together. The dispatcher owns
    // the night silence and the gap between messages, and marks them announced
    // only after a successful send: the ones held back are offered again next
    // cycle (a zone found at 3 AM goes out at 7 AM).
    const fresh = freshZones(result.watchZones, fireWatchAlertedZones(now), now);
    const sent = fresh.length > 0 && await dispatchFireWatchDigest(
      fresh.map((z) => ({
        lat: z.lat,
        lon: z.lon,
        strikeCount: z.strikeCount,
        maxAbsKa: z.maxAbsKa,
        near: nearestStationName(z, stationMeta),
      })),
      now,
    );

    // Heartbeat — one line per cycle with activity, so "silence = no strikes"
    // is unambiguous in the log.
    log.info(
      `[FireWatch] fire watch: ${result.totalStrikes} strikes (${result.landStrikes} tierra), ` +
        `${result.dryStrikes} secos (${result.wetStrikes} lluvia, ${result.unknownStrikes} sin dato, ` +
        `${result.pendingStrikes} pendientes), ` +
        `${result.watchZones.length}/${result.zones.length} zonas en vigilancia` +
        (fresh.length > 0 ? (sent ? ` (${fresh.length} avisadas ahora)` : ` (${fresh.length} por avisar)`) : ''),
    );
  } catch (err) {
    log.warn(`[FireWatch] cycle failed: ${(err as Error).message}`);
  }
}
