/**
 * Fire watch cycle — dry-lightning post-storm vigilance.
 *
 * Every 30 min (wired in index.ts, fire-and-forget) this queries the last
 * 12h of cloud-to-ground strikes plus the precipitation context around them,
 * runs the pure classifier (fireWatchLogic.ts), and dispatches one alert per
 * NEW zone under watch. The point is to warn 7-18h BEFORE FIRMS confirms a
 * hotspot — today we only learn about a fire when the satellite sees it.
 *
 * No new tables: state is in-memory (zoneKey → last-seen ts). A restart just
 * means the dispatcher cooldown re-arms; the 12h strike window re-derives
 * the zones on the next cycle, so nothing is lost beyond a possible repeat
 * alert (bounded by the webhook side anyway).
 */

import { getPool } from './db.js';
import { log } from './logger.js';
import { haversineDistance } from '../src/services/geoUtils.js';
import { dispatchFireWatchAlert } from './alertDispatcher.js';
import {
  computeFireWatch,
  zoneKey,
  type FireWatchStrike,
  type FireWatchZone,
  type RainReading,
} from './fireWatchLogic.js';

// ── Config ──────────────────────────────────────────

/** Strike lookback. Matches the ignition physics: a zone stays interesting
 *  for hours after the storm passed, but beyond ~12h FIRMS takes over. */
const STRIKE_WINDOW_HOURS = 12;
/** Rain lookback = strike window + the 3h "before" baseline the classifier
 *  needs for the oldest strike in the window. */
const RAIN_WINDOW_HOURS = 15;
/** Forget zones not seen in watch for this long (bounds the state Map). */
const ZONE_STATE_TTL_MS = 24 * 60 * 60_000;
/** Max distance zone centroid → named station for the "cerca de X" label. */
const NEAREST_NAME_KM = 25;

// ── State (in-memory — no DB schema access in prod) ─

const zoneWatchState = new Map<string, number>(); // zoneKey → last seen in watch

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

/** Nearest named station to the zone centroid (approximate town label). */
function nearestStationName(
  zone: FireWatchZone,
  stationMeta: Map<string, StationMeta>,
): string | undefined {
  let bestName: string | undefined;
  let bestKm = NEAREST_NAME_KM;
  for (const meta of stationMeta.values()) {
    if (!meta.name) continue;
    const km = haversineDistance(zone.lat, zone.lon, meta.lat, meta.lon);
    if (km < bestKm) {
      bestKm = km;
      bestName = meta.name;
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
    const result = computeFireWatch(strikes, rain);

    // Prune stale zone state so the Map stays bounded.
    const now = Date.now();
    for (const [key, ts] of zoneWatchState) {
      if (now - ts > ZONE_STATE_TTL_MS) zoneWatchState.delete(key);
    }

    let newZones = 0;
    for (const zone of result.watchZones) {
      const key = zoneKey(zone);
      if (!zoneWatchState.has(key)) newZones++;
      zoneWatchState.set(key, now);

      // Dispatch every cycle for every zone in watch: the dispatcher owns the
      // 12h cooldown AND the night silence, and only arms the cooldown after
      // a successful send — so a zone detected at 3 AM alerts at 7 AM without
      // any extra bookkeeping here.
      await dispatchFireWatchAlert(
        key,
        zone.lat,
        zone.lon,
        zone.strikeCount,
        zone.maxAbsKa,
        nearestStationName(zone, stationMeta),
      );
    }

    // Heartbeat — one line per cycle with activity, so "silence = no strikes"
    // is unambiguous in the log.
    log.info(
      `[FireWatch] fire watch: ${result.totalStrikes} strikes (${result.landStrikes} tierra), ` +
        `${result.dryStrikes} secos (${result.wetStrikes} lluvia, ${result.unknownStrikes} sin dato), ` +
        `${result.watchZones.length}/${result.zones.length} zonas en vigilancia` +
        (newZones > 0 ? ` (${newZones} nuevas)` : ''),
    );
  } catch (err) {
    log.warn(`[FireWatch] cycle failed: ${(err as Error).message}`);
  }
}
