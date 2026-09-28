/**
 * Nightly cycle that measures each land station against the free stream.
 *
 * The statistics and the judgement live in `calibrationLogic.ts`, which is pure
 * and tested. This file does the parts that need a database: check the
 * reference sites are measuring, pick the stations within their reach, pull the
 * paired hours, and store the result.
 *
 * ── The reference (v2.160.0)
 *
 * Until v2.159 each station was paired with its nearest live buoy. On 27-sep
 * that turned out to be measuring against the wrong hour: PORTUS rows are
 * stored two hours early, and the Xunta buoys' wind before 22-sep came from
 * the wrong series. The reference is now the median of four exposed
 * MeteoGalicia sites (Ons, Sálvora, Cabo Udra, A Lanzada), each dropped for the
 * sector it is sheltered from — see COMBINED_REFERENCE_SITES. Rows record it as
 * buoy_id = COMBINED_REFERENCE_ID (0).
 *
 * The sites are still held to the standard the buoys were: a reference that has
 * stopped measuring still produces answers, and they look like answers. So each
 * one has to report enough, read enough and vary, and the cycle names any that
 * fail.
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
 * Stations beyond reach of the sites (the reservoir, the far south of the Ría
 * de Vigo) get no rows at all rather than a fabricated ratio. Estimating those
 * needs a different reference and is a separate problem.
 *
 * ── Load
 *
 * The database host has 2 GB. The run happens in the small hours (see
 * shouldRunCalibration), station hours come from the readings_hourly aggregate
 * instead of the raw table, only the four sites read raw rows (they need the
 * direction), and the window is read thirty days at a time.
 */

import { getPool } from './db.js';
import { log } from './logger.js';
import {
  calibrateStations,
  summariseCalibration,
  summariseReference,
  pairWithCombinedReference,
  shouldRunCalibration,
  confirmDeadByPeers,
  distanceKm,
  isUsableReference,
  altitudeAllowsReference,
  MAX_REFERENCE_ALTITUDE_M,
  MIN_REFERENCE_SITES,
  COMBINED_REFERENCE_SITES,
  COMBINED_REFERENCE_ID,
  type ReferenceSite,
  type SiteHour,
  type StationHour,
  type StationCalibration,
} from './calibrationLogic.js';

/** How far a station can sit from the nearest reference site and still be
 *  measuring the same weather. Beyond this the pair stops being a shelter
 *  measurement and starts being a map of the regional gradient. */
const MAX_REFERENCE_DIST_KM = 35;

/** Window of history each run looks back over. Long enough to fill direction
 *  sectors, short enough that a station moved or repaired shows through. */
const WINDOW_DAYS = 90;

/** The window is read in slices of this many days, so no single query has to
 *  hold three months of readings at once. */
const SLICE_DAYS = 30;

/** How often the timer asks whether it is time. The run itself happens once a
 *  night (shouldRunCalibration); asking is one indexed max(). */
export const CALIBRATION_CHECK_INTERVAL_MS = 60 * 60 * 1000;

interface StationRow { station_id: string; latitude: number; longitude: number; altitude: number | null }

/** [from, to) slices covering the last `days`, oldest first. */
function windowSlices(nowMs: number, days: number, sliceDays: number): Array<[Date, Date]> {
  const out: Array<[Date, Date]> = [];
  const day = 86_400_000;
  for (let from = nowMs - days * day; from < nowMs; from += sliceDays * day) {
    out.push([new Date(from), new Date(Math.min(from + sliceDays * day, nowMs))]);
  }
  return out;
}

function madridHour(nowMs: number): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23' })
    .format(new Date(nowMs)));
}

/** Last run against the combined reference. Runs against the buoys (before
 *  v2.160.0) do not count, so the first combined table is written at the first
 *  check after the deploy instead of waiting for the next night. */
async function lastCalibrationAt(): Promise<number | null> {
  const res = await getPool().query<{ last: Date | null }>(
    'SELECT max(computed_at) AS last FROM station_calibration WHERE buoy_id = $1',
    [COMBINED_REFERENCE_ID],
  );
  const last = res.rows[0]?.last;
  return last ? new Date(last).getTime() : null;
}

/** Reference sites that are actually measuring. Alive is not enough: the first
 *  buoy run was wrecked by a harbour buoy averaging 0.53 m/s, and a site with
 *  a stuck or sheltered anemometer would do the same to every ratio. */
async function usableReferenceSites(): Promise<ReferenceSite[]> {
  const res = await getPool().query(
    `SELECT station_id, count(*) AS hours, avg(avg_wind) AS mean_ms, stddev(avg_wind) AS stdev_ms
       FROM readings_hourly
      WHERE station_id = ANY($1)
        AND bucket > NOW() - ($2 || ' days')::INTERVAL
        AND avg_wind IS NOT NULL AND avg_wind > 0
      GROUP BY station_id`,
    [COMBINED_REFERENCE_SITES.map((s) => s.id), String(WINDOW_DAYS)],
  );
  const quality = new Map(res.rows.map((r) => [r.station_id as string, {
    hours: Number(r.hours),
    meanMs: Number(r.mean_ms),
    stdevMs: r.stdev_ms == null ? 0 : Number(r.stdev_ms),
  }]));

  const usable: ReferenceSite[] = [];
  const rejected: string[] = [];
  for (const site of COMBINED_REFERENCE_SITES) {
    const q = quality.get(site.id);
    if (q && isUsableReference(q)) usable.push(site);
    else rejected.push(q ? `${site.name} (${q.hours} h, media ${q.meanMs.toFixed(2)} m/s)` : `${site.name} (sin datos)`);
  }
  // Named: a site leaving the median silently would move every ratio with it.
  if (rejected.length > 0) log.warn(`Calibration: reference sites not usable — ${rejected.join(', ')}`);
  return usable;
}

/** Stations within reach of at least one usable site, below the altitude a
 *  coastal site can speak for, with their positions (the peer check needs them). */
async function stationsInReach(sites: ReferenceSite[]): Promise<Map<string, { lat: number; lon: number }>> {
  const res = await getPool().query<StationRow>(
    `SELECT station_id, latitude, longitude, altitude
       FROM stations
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL`,
  );
  const pos = new Map(res.rows.map((s) => [s.station_id, s]));
  const anchors = sites.map((s) => pos.get(s.id)).filter((p): p is StationRow => p != null);
  const inReach = new Map<string, { lat: number; lon: number }>();
  if (anchors.length === 0) return inReach;

  let tooHigh = 0;
  for (const s of res.rows) {
    // A summit is not in the layer the sites sample. Filtering it here, on
    // physics, beats discovering it afterwards through a correlation that
    // cannot say whether the instrument or the pairing was at fault.
    if (!altitudeAllowsReference(s.altitude == null ? null : Number(s.altitude))) {
      tooHigh++;
      continue;
    }
    const near = anchors.some((a) => distanceKm(Number(s.latitude), Number(s.longitude),
      Number(a.latitude), Number(a.longitude)) <= MAX_REFERENCE_DIST_KM);
    if (near) inReach.set(s.station_id, { lat: Number(s.latitude), lon: Number(s.longitude) });
  }
  if (tooHigh > 0) {
    log.info(`Calibration: ${tooHigh} stations above ${MAX_REFERENCE_ALTITUDE_M}m skipped — a coastal site cannot speak for a summit`);
  }
  return inReach;
}

/**
 * Afternoon hourly means of the stations, from the hourly aggregate. The
 * aggregate is the same AVG(wind_speed) the raw query computed (checked
 * against the raw table on 28-sep), at a fraction of the cost. Hours and days
 * are Madrid ones, spelled out rather than left to the session time zone.
 *
 * `avg_wind IS NOT NULL` also does quality control for free: the readings QC
 * nulls what it rejects, so a gust artefact never reaches this.
 */
async function fetchStationHours(stationIds: string[], nowMs: number): Promise<StationHour[]> {
  const out: StationHour[] = [];
  for (const [from, to] of windowSlices(nowMs, WINDOW_DAYS, SLICE_DAYS)) {
    const res = await getPool().query(
      `SELECT station_id,
              extract(epoch FROM bucket)::bigint AS t,
              to_char(bucket AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS day,
              avg_wind AS ms
         FROM readings_hourly
        WHERE station_id = ANY($1)
          AND bucket >= $2 AND bucket < $3
          AND avg_wind IS NOT NULL
          AND extract(hour FROM bucket AT TIME ZONE 'Europe/Madrid') BETWEEN 12 AND 20`,
      [stationIds, from, to],
    );
    for (const r of res.rows) {
      out.push({ stationId: r.station_id, t: Number(r.t), day: r.day, ms: Number(r.ms) });
    }
  }
  return out;
}

/**
 * Afternoon hourly means of the reference sites, with direction, from the raw
 * table (the aggregate has no direction). Four stations: cheap.
 *
 * The direction is a CIRCULAR mean. Averaging degrees arithmetically puts the
 * mean of 350 and 10 at 180 — the exact opposite of the truth.
 */
async function fetchSiteHours(sites: ReferenceSite[], nowMs: number): Promise<SiteHour[]> {
  const out: SiteHour[] = [];
  for (const [from, to] of windowSlices(nowMs, WINDOW_DAYS, SLICE_DAYS)) {
    const res = await getPool().query(
      `SELECT station_id,
              extract(epoch FROM date_trunc('hour', time))::bigint AS t,
              avg(wind_speed) AS ms,
              degrees(atan2(avg(sin(radians(wind_dir))), avg(cos(radians(wind_dir))))) AS dir
         FROM readings
        WHERE station_id = ANY($1)
          AND time >= $2 AND time < $3
          AND wind_speed IS NOT NULL
          AND extract(hour FROM time AT TIME ZONE 'Europe/Madrid') BETWEEN 12 AND 20
        GROUP BY 1, 2`,
      [sites.map((s) => s.id), from, to],
    );
    for (const r of res.rows) {
      const dir = r.dir == null ? null : ((Number(r.dir) % 360) + 360) % 360;
      out.push({ siteId: r.station_id, t: Number(r.t), ms: Number(r.ms), dirDeg: dir });
    }
  }
  return out;
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

/**
 * Run the calibration if it is due (once a night, in the small hours; any hour
 * once it is overdue). `force` skips the timing check.
 */
export async function runCalibrationCycle(opts: { force?: boolean } = {}): Promise<void> {
  try {
    const nowMs = Date.now();
    if (!opts.force && !shouldRunCalibration(await lastCalibrationAt(), nowMs, madridHour(nowMs))) return;

    const sites = await usableReferenceSites();
    if (sites.length < MIN_REFERENCE_SITES) {
      // Not something to fix by trying harder, and not something to hide: one
      // site is a station, not a reference, and every ratio this cycle would
      // produce would be against it alone.
      log.warn(`Calibration: only ${sites.length} reference sites measuring — skipping, nothing to measure against`);
      return;
    }

    const positions = await stationsInReach(sites);
    if (positions.size === 0) {
      log.warn(`Calibration: no station within ${MAX_REFERENCE_DIST_KM}km of the reference sites`);
      return;
    }

    const siteHours = await fetchSiteHours(sites, nowMs);
    const stationHours = await fetchStationHours([...positions.keys()], nowMs);
    const pairs = pairWithCombinedReference(stationHours, siteHours, sites);

    // A station the reference calls dead gets a second witness: its responding
    // neighbours. See confirmDeadByPeers.
    const { rows, rescued } = confirmDeadByPeers(calibrateStations(pairs), stationHours, positions);
    const written = await persist(rows, new Date(nowMs));

    // Heartbeat: this cycle is usually uneventful, and silence would read as
    // "the code is not running" rather than "nothing changed".
    log.ok(`Calibration: ${summariseCalibration(rows)} (${written} rows; combined reference: ${summariseReference(siteHours, sites)})`);

    if (rescued.length > 0) {
      log.info(`Calibration: not dead, they follow a working neighbour — ${rescued
        .map((r) => `${r.stationId} (${r.peerId} ${r.km.toFixed(1)}km r=${r.correlation.toFixed(2)})`).join(', ')}`);
    }

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
