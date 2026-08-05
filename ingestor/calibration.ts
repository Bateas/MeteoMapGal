/**
 * Nightly cycle that measures each land station against the water.
 *
 * The statistics and the judgement live in `calibrationLogic.ts`, which is pure
 * and tested. This file does the parts that need a database: choose a live
 * reference buoy for each station, pull the paired hours, and store the result.
 *
 * ── Why the reference is chosen per station and recorded per row
 *
 * The original audit hard-coded buoy 3221 in Vigo. That buoy then went dead for
 * weeks and nobody noticed, which is precisely the failure the whole project
 * keeps running into: an answer computed against a reference that stopped
 * existing still looks like an answer. So the buoy is picked at run time from
 * the ones actually reporting, and every row records which one it leaned on —
 * without that, a buoy failing later would silently invalidate rows we could no
 * longer identify.
 *
 * ── Why afternoons
 *
 * The window is 12:00-20:00 on purpose. This is the transfer function during
 * the hours people are on the water, when the thermal regime dominates, and it
 * is not claimed to hold at four in the morning. A single number covering every
 * regime would be a worse answer wearing a more confident face.
 *
 * ── What it cannot do, and does not fake
 *
 * Inland sectors have no buoy within reach, so the reservoir gets no rows at
 * all rather than a fabricated ratio. Estimating land-only sites needs a
 * different reference and is a separate problem.
 */

import { getPool } from './db.js';
import { log } from './logger.js';
import { RIAS_BUOY_STATIONS } from '../src/api/buoyClient.js';
import {
  calibrateStations,
  summariseCalibration,
  isUsableReference,
  altitudeAllowsReference,
  MAX_REFERENCE_ALTITUDE_M,
  type PairedHour,
  type StationCalibration,
} from './calibrationLogic.js';

/** How far a station can sit from its reference and still be measuring the
 *  same weather. Beyond this the pair stops being a shelter measurement and
 *  starts being a map of the regional gradient. */
const MAX_REFERENCE_DIST_KM = 35;

/** Window of history each run looks back over. Long enough to fill direction
 *  sectors, short enough that a station moved or repaired shows through. */
const WINDOW_DAYS = 90;

/** Once a day. The window is ninety days: nothing it says changes hourly, and
 *  the query is heavy enough that running it on the five-minute loop would be
 *  pure waste. */
export const CALIBRATION_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface StationRow { station_id: string; latitude: number; longitude: number; altitude: number | null }

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371, r = Math.PI / 180;
  const dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Buoys fit to serve as somebody's free stream.
 *
 * Alive is not enough, and the first run proved it. Every station within reach
 * of buoy 4271 came out "broken" with ratios between 3 and 5 — but 4271 is a
 * harbour mooring averaging 0.53 m/s with a maximum of 3.0 over ninety days.
 * The stations were fine; the reference was as sheltered as they were, and
 * dividing by it manufactured nonsense. Another buoy in the config had exactly
 * two hours of wind in the window.
 *
 * So the reference is held to the same standard as the thing it measures: it
 * has to report enough, read enough, and vary. See isUsableReference.
 */
async function liveReferenceBuoys(): Promise<Set<number>> {
  const db = getPool();
  const res = await db.query(
    `SELECT station_id,
            count(*)          AS hours,
            avg(wind_speed)   AS mean_ms,
            stddev(wind_speed) AS stdev_ms
       FROM buoy_readings
      WHERE wind_speed IS NOT NULL AND wind_speed > 0
        AND time > NOW() - ($1 || ' days')::INTERVAL
      GROUP BY station_id`,
    [String(WINDOW_DAYS)],
  );

  const usable = new Set<number>();
  const rejected: string[] = [];
  for (const r of res.rows) {
    const q = {
      hours: Number(r.hours),
      meanMs: Number(r.mean_ms),
      stdevMs: r.stdev_ms == null ? 0 : Number(r.stdev_ms),
    };
    if (isUsableReference(q)) usable.add(Number(r.station_id));
    else rejected.push(`${r.station_id} (${q.hours}h, media ${q.meanMs.toFixed(2)} m/s)`);
  }

  // Named, because a buoy dropping out of the reference set silently would
  // change every ratio that leaned on it without anyone noticing.
  if (rejected.length > 0) {
    log.info(`Calibration: buoys not usable as a reference — ${rejected.join(', ')}`);
  }
  return usable;
}

/** Assign every station its nearest live buoy, dropping those with none in
 *  range. Returns buoy id → station ids, so the heavy query runs once per
 *  reference rather than once per station. */
async function groupStationsByReference(live: Set<number>): Promise<Map<number, string[]>> {
  const db = getPool();
  const res = await db.query<StationRow>(
    `SELECT station_id, latitude, longitude, altitude
       FROM stations
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL`,
  );

  const buoys = RIAS_BUOY_STATIONS.filter((b) => live.has(b.id));
  const groups = new Map<number, string[]>();
  let tooHigh = 0;

  for (const s of res.rows) {
    // A summit is not in the layer the buoy samples. Filtering it here, on
    // physics, beats discovering it afterwards through a correlation that
    // cannot say whether the instrument or the pairing was at fault.
    if (!altitudeAllowsReference(s.altitude == null ? null : Number(s.altitude))) {
      tooHigh++;
      continue;
    }
    let best: { id: number; d: number } | null = null;
    for (const b of buoys) {
      const d = distanceKm(Number(s.latitude), Number(s.longitude), b.lat, b.lon);
      if (d <= MAX_REFERENCE_DIST_KM && (!best || d < best.d)) best = { id: b.id, d };
    }
    if (!best) continue;
    const list = groups.get(best.id) ?? [];
    list.push(s.station_id);
    groups.set(best.id, list);
  }

  if (tooHigh > 0) {
    log.info(`Calibration: ${tooHigh} stations above ${MAX_REFERENCE_ALTITUDE_M}m skipped — a sea-level buoy cannot speak for a summit`);
  }
  return groups;
}

/**
 * Paired hours for one reference buoy and the stations assigned to it.
 *
 * Both sides are collapsed to hourly means before pairing, so a station
 * reporting every five minutes does not outvote one reporting hourly.
 *
 * The direction is a CIRCULAR mean. Averaging degrees arithmetically puts the
 * mean of 350 and 10 at 180 — the exact opposite of the truth — which would
 * scatter every northerly into the southern sectors.
 *
 * `wind_speed IS NOT NULL` also does quality control for free: the readings QC
 * nulls what it rejects, so a gust artefact or an anemometer it has already
 * caught sitting at zero never reaches this. The near-zero-but-not-zero cases
 * QC cannot judge are exactly what the dead-station test here is for.
 */
async function fetchPairedHours(buoyId: number, stationIds: string[]): Promise<PairedHour[]> {
  const db = getPool();
  const res = await db.query(
    `WITH b AS (
       SELECT date_trunc('hour', time) AS h,
              avg(wind_speed) AS ms,
              degrees(atan2(avg(sin(radians(wind_dir))), avg(cos(radians(wind_dir))))) AS dir
         FROM buoy_readings
        WHERE station_id = $1
          AND wind_speed IS NOT NULL AND wind_speed > 0
          AND time > NOW() - ($2 || ' days')::INTERVAL
        GROUP BY 1
     ),
     s AS (
       SELECT station_id, date_trunc('hour', time) AS h, avg(wind_speed) AS ms
         FROM readings
        WHERE wind_speed IS NOT NULL
          AND time > NOW() - ($2 || ' days')::INTERVAL
          AND extract(hour from time) BETWEEN 12 AND 20
          AND station_id = ANY($3)
        GROUP BY 1, 2
     )
     SELECT s.station_id,
            to_char(s.h, 'YYYY-MM-DD') AS day,
            s.ms AS station_ms, b.ms AS buoy_ms, b.dir AS buoy_dir
       FROM s JOIN b ON b.h = s.h`,
    [buoyId, String(WINDOW_DAYS), stationIds],
  );

  return res.rows.map((r) => ({
    stationId: r.station_id as string,
    day: r.day as string,
    buoyId,
    stationMs: Number(r.station_ms),
    buoyMs: Number(r.buoy_ms),
    buoyDirDeg: r.buoy_dir == null ? null : Number(r.buoy_dir),
  }));
}

async function persist(rows: StationCalibration[], computedAt: Date): Promise<number> {
  if (rows.length === 0) return 0;
  const db = getPool();
  const COLS = 12;
  const values: unknown[] = [];
  const placeholders: string[] = [];

  rows.forEach((r, i) => {
    const o = i * COLS;
    placeholders.push(
      `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7}, $${o + 8}, $${o + 9}, $${o + 10}, $${o + 11}, $${o + 12})`,
    );
    values.push(
      computedAt, r.stationId, r.buoyId, r.status, r.ratio, r.hours, r.days,
      r.correlation, r.stationMeanMs, r.buoyMeanMs, WINDOW_DAYS,
      JSON.stringify(r.sectors),
    );
  });

  const res = await db.query(
    `INSERT INTO station_calibration
       (computed_at, station_id, buoy_id, status, ratio, hours, days,
        correlation, station_mean_ms, buoy_mean_ms, window_days, sectors)
     VALUES ${placeholders.join(', ')}
     ON CONFLICT (computed_at, station_id) DO NOTHING`,
    values,
  );
  return res.rowCount ?? 0;
}

export async function runCalibrationCycle(): Promise<void> {
  try {
    const live = await liveReferenceBuoys();
    if (live.size === 0) {
      // Not an error we can fix by trying harder, and not something to hide:
      // with no live buoy there is no free stream to measure against, and
      // every ratio this cycle would have produced would be against nothing.
      log.warn('Calibration: no buoy is fit to serve as a reference — skipping, nothing to measure against');
      return;
    }

    const groups = await groupStationsByReference(live);
    if (groups.size === 0) {
      log.warn(`Calibration: ${live.size} live buoys but no station within ${MAX_REFERENCE_DIST_KM}km of any`);
      return;
    }

    const pairs: PairedHour[] = [];
    for (const [buoyId, stationIds] of groups) {
      pairs.push(...await fetchPairedHours(buoyId, stationIds));
    }

    const rows = calibrateStations(pairs);
    const computedAt = new Date();
    const written = await persist(rows, computedAt);

    // Heartbeat: this cycle is usually uneventful, and silence would read as
    // "the code is not running" rather than "nothing changed".
    log.ok(`Calibration: ${summariseCalibration(rows)} (${written} rows, ${live.size} reference buoys)`);

    const dead = rows.filter((r) => r.status === 'dead');
    if (dead.length > 0) {
      // Named, because "6 not measuring" is a statistic and the point is to go
      // and look at them.
      log.warn(`Calibration: not measuring — ${dead.map((d) => d.stationId).join(', ')}`);
    }
  } catch (err) {
    // Never fatal. Calibration is a refinement computed from history; the
    // polling loop that gathers that history matters more than this does.
    log.error('Calibration cycle failed:', (err as Error).message);
  }
}
