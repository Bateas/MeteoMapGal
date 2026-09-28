/**
 * The transfer function of a land station, measured against water.
 *
 * A station on land almost never reads the wind that is on the water. The usual
 * remedy is a correction by local experience; this measures it instead. Pair a
 * station hour by hour with the free stream, and the ratio of their mean speeds
 * is how much of it that site actually sees. Across the Rías the median came out
 * at 0.40 — the typical land station shows less than half (measured against the
 * buoys; see the combined reference at the end of this file for why that figure
 * is being measured again).
 *
 * Two decisions carry the whole thing, and both are easy to get wrong:
 *
 *  - **Ratio of means, never the mean of ratios.** Averaging quotients lets the
 *    calm hours, where the denominator is tiny, dominate the answer. Summing
 *    both sides and dividing once is the robust statistic.
 *
 *  - **Bin by the BUOY's direction, not the station's.** A sheltered station's
 *    own vane is distorted by the same terrain that is eating its speed, so
 *    binning by what it reports would sort the hours by the error rather than
 *    by the weather. The buoy sits in the free stream and is the only side of
 *    the pair entitled to say where the wind came from.
 *
 * ── Broken is not the same as sheltered, and the ratio cannot tell them apart
 *
 * A dead anemometer and a walled courtyard both read close to zero. Separating
 * them is mandatory: painting them alike hides an instrument failure inside a
 * real physical phenomenon, and the failure is the one that poisons a verdict.
 *
 * The discriminator has to be independent of magnitude, and it is response. A
 * sheltered station still tracks the weather — 0.4 m/s on a still day, 1.5 in a
 * gale. A frozen one reads the same number whatever the sea is doing. So the
 * test is variance and correlation against the reference, not how small the
 * number is. That is the same rule the alert detectors follow: two independent
 * signals plus a physical discriminator, never one number crossing a line.
 *
 * ── What this deliberately does NOT cover
 *
 * Inland sectors. The reservoir has no buoy, so there is no free-stream
 * reference within reach and no honest ratio to compute. Those stations are
 * absent from the output rather than given a fabricated one.
 */

/** One hour where both the station and its reference reported.
 *
 *  The fields keep their buoy names because the table does (buoy_id,
 *  buoy_mean_ms). Against the combined reference, buoyId is
 *  COMBINED_REFERENCE_ID and buoyMs / buoyDirDeg are that reference. */
export interface PairedHour {
  stationId: string;
  /** Calendar day (YYYY-MM-DD) of the pair. The response test runs on daily
   *  means, so the day has to travel with the hour. */
  day: string;
  /** Buoy used as the free-stream reference for this station. */
  buoyId: number;
  /** Mean station speed over the hour (m/s). */
  stationMs: number;
  /** Mean buoy speed over the hour (m/s). */
  buoyMs: number;
  /** Direction the wind came FROM at the buoy (degrees). Null drops the hour
   *  from the per-sector breakdown but keeps it in the global figure. */
  buoyDirDeg: number | null;
}

export type CalibrationStatus =
  /** Reads the free stream almost in full: usable as a reference itself. */
  | 'exposed'
  /** Reads a stable, correctable fraction. */
  | 'sheltered'
  /** Correctable in principle, but so little signal that the correction
   *  amplifies its noise as much as its wind. */
  | 'very_sheltered'
  /** Reads plenty of wind but nothing that tracks the reference. NOT broken:
   *  the site simply has no comparable free stream within reach — a mountain
   *  top, an ocean island — so we cannot calibrate it from the sea. Its
   *  readings stay perfectly usable; what is missing is the correction factor,
   *  and saying so is different from calling the instrument faulty. */
  | 'unreferenced'
  /** Does not respond to the weather AND barely reads any. An instrument
   *  problem, not a site. */
  | 'dead'
  /** Not enough paired hours yet to say anything. */
  | 'insufficient';

export interface SectorCalibration {
  /** 0 = N, 1 = NE, 2 = E … 7 = NW. Sector the wind came FROM at the buoy. */
  sector: number;
  ratio: number;
  hours: number;
}

export interface StationCalibration {
  stationId: string;
  buoyId: number;
  status: CalibrationStatus;
  /** Station mean over buoy mean, all directions. Null when insufficient. */
  ratio: number | null;
  hours: number;
  /** Pearson correlation against the reference, on DAILY means. */
  correlation: number | null;
  /** Days contributing to that correlation. */
  days: number;
  stationMeanMs: number;
  buoyMeanMs: number;
  /** Per-sector ratios that cleared their own sample floor. May be empty even
   *  for a healthy station: one season rarely fills all eight. */
  sectors: SectorCalibration[];
}

/** Paired hours below this and the station gets no verdict at all. Chosen to
 *  match the audit that produced the original 119-station table. */
export const MIN_HOURS_GLOBAL = 150;

/** A single sector needs far fewer hours than the whole record, or no sector
 *  would ever qualify — but enough that one squally afternoon cannot set it. */
export const MIN_HOURS_SECTOR = 30;

/** Below this correlation the station is not following the free stream. Set
 *  low on purpose: real shelter degrades correlation a lot before it kills it,
 *  and the claim being made here — the instrument is broken — has to clear a
 *  bar that mere shelter cannot.
 *
 *  Measured on DAILY means, never hourly. The first version tested hour by
 *  hour and had to be thrown away: Illas Cíes against the Vigo buoy, 707
 *  paired hours, ten kilometres apart in the same ría, scored 0.068 — and
 *  PostgreSQL agreed, so it was the test that was wrong, not the code. In the
 *  afternoon each site answers to its own local circulation and they peak at
 *  different times; hourly, they genuinely decouple. Averaged over a day that
 *  timing noise cancels and what is left is the synoptic sequence both of them
 *  really do share. */
export const MIN_CORRELATION = 0.25;

/** Days needed before the response test means anything. Ninety days of window
 *  gives at most ninety points, and a correlation on a handful of them says
 *  nothing either way. */
export const MIN_DAYS = 20;

/** Standard deviation (m/s) below which the station is not varying at all.
 *  Catches the frozen sensor that correlation cannot even score, because a
 *  constant series has no correlation to compute. */
export const MIN_STDEV_MS = 0.05;

/** At or above this the station is reading essentially the free stream. */
export const EXPOSED_RATIO = 0.9;

/** Below this, correcting the reading multiplies its noise as much as its
 *  signal, so it is flagged even though it is alive. */
export const VERY_SHELTERED_RATIO = 0.35;

/**
 * Is this buoy fit to be anyone's free stream?
 *
 * The first run measured 143 stations against whatever live buoy was nearest,
 * and six of them came out "broken" with ratios of 3 to 5. They were fine: the
 * REFERENCE was a harbour buoy averaging 0.53 m/s with a maximum of 3.0 over
 * ninety days — a sensor every bit as sheltered as the stations it was being
 * asked to judge. Dividing by it manufactured nonsense.
 *
 * Which is the same mistake this whole module exists to catch, made one level
 * up: alive was checked, measuring was not.
 */
export interface ReferenceQuality { meanMs: number; stdevMs: number; hours: number }

/** A reference averaging less than this is not sampling the free stream. The
 *  live Galician buoys sit at 2.9 to 4.6 m/s; the one that had to go was at
 *  0.53, so the gap is wide and the threshold is not delicate. */
export const MIN_REFERENCE_MEAN_MS = 2.0;

/** And it has to vary, for the same reason a station does. */
export const MIN_REFERENCE_STDEV_MS = 0.8;

/** Enough hours that the two figures above mean something. One buoy in the
 *  network had exactly two. */
export const MIN_REFERENCE_HOURS = 500;

/**
 * Can a buoy at sea level speak for a station at this height?
 *
 * Measured, not assumed: San Nomedio sits at 681 m and read 83% of the Vigo
 * buoy with a daily correlation of 0.17. It is not broken and it is not
 * sheltered — it is in a different part of the atmosphere. Above the shallow
 * layer the sea breeze and the ría circulation occupy, a summit answers to the
 * synoptic flow instead, and the two only agree by coincidence.
 *
 * The cut is deliberately generous. Coastal stations sit at 5 to 300 m and
 * genuinely do share the buoy's layer; the ones this removes are summits.
 */
export const MAX_REFERENCE_ALTITUDE_M = 400;

export function altitudeAllowsReference(stationAltitudeM: number | null): boolean {
  // Unknown altitude is not evidence of a problem — most amateur stations
  // never report one, and excluding them would gut the sample.
  if (stationAltitudeM == null) return true;
  return stationAltitudeM <= MAX_REFERENCE_ALTITUDE_M;
}

export function isUsableReference(q: ReferenceQuality): boolean {
  return q.hours >= MIN_REFERENCE_HOURS
    && q.meanMs >= MIN_REFERENCE_MEAN_MS
    && q.stdevMs >= MIN_REFERENCE_STDEV_MS;
}

/** Which of the eight compass sectors a bearing falls in, N centred on 0. */
export function directionSector(deg: number): number {
  const norm = ((deg % 360) + 360) % 360;
  return Math.round(norm / 45) % 8;
}

export const SECTOR_NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'] as const;

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx2 += a * a; dy2 += b * b;
  }
  // A series with no variance has no correlation — that is a real answer, not
  // a zero, and the caller distinguishes it via the standard deviation.
  if (dx2 === 0 || dy2 === 0) return null;
  return num / Math.sqrt(dx2 * dy2);
}

function stdev(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (n - 1));
}

function classify(
  hours: number,
  days: number,
  ratio: number,
  correlation: number | null,
  stationStdev: number,
): CalibrationStatus {
  if (hours < MIN_HOURS_GLOBAL || days < MIN_DAYS) return 'insufficient';

  // A series pinned to one value is broken whatever that value looks like.
  // This one is unambiguous and comes first.
  if (stationStdev < MIN_STDEV_MS) return 'dead';

  const responds = correlation !== null && correlation >= MIN_CORRELATION;

  // Only now the response test — and crucially, NOT on its own. The first
  // version called anything with a poor correlation broken, and the live run
  // showed what that costs: Illas Cíes reading 78% of the free stream and San
  // Nomedio, on a 681m summit, reading 83%, both branded "not measuring". An
  // instrument that returns 3.7 m/s of real, varying wind is not faulty. What
  // it lacks is a COMPARABLE reference: an ocean island and a mountain summit
  // do not follow a tide gauge inside Vigo harbour, and no amount of averaging
  // will make them.
  //
  // So low correlation on its own means unreferenced — we cannot calibrate it
  // from here — and only low correlation TOGETHER with a reading that is
  // nearly nothing means the instrument itself has stopped.
  if (!responds) {
    return ratio < VERY_SHELTERED_RATIO ? 'dead' : 'unreferenced';
  }

  if (ratio >= EXPOSED_RATIO) return 'exposed';
  if (ratio >= VERY_SHELTERED_RATIO) return 'sheltered';
  return 'very_sheltered';
}

/**
 * Turn paired hours into one calibration per station.
 *
 * Hours are expected pre-aggregated by the query; this does the statistics and
 * the judgement, and nothing else, so it can be tested without a database.
 */
export function calibrateStations(pairs: PairedHour[]): StationCalibration[] {
  interface Acc {
    buoyId: number;
    st: number[];
    bu: number[];
    /** Daily sums, for the response test. Hourly pairs answer to local timing
     *  and decouple; a day of them does not. */
    daily: Map<string, { st: number; bu: number; n: number }>;
    sectors: Map<number, { st: number; bu: number; n: number }>;
  }
  const byStation = new Map<string, Acc>();

  for (const p of pairs) {
    // A zero or negative reading on either side is not a measurement of the
    // relationship: it is calm, or a sensor at rest, and it drags the ratio
    // without carrying information about how much wind the site sees.
    if (!(p.stationMs >= 0) || !(p.buoyMs > 0)) continue;

    let acc = byStation.get(p.stationId);
    if (!acc) {
      acc = { buoyId: p.buoyId, st: [], bu: [], daily: new Map(), sectors: new Map() };
      byStation.set(p.stationId, acc);
    }
    acc.st.push(p.stationMs);
    acc.bu.push(p.buoyMs);

    const d = acc.daily.get(p.day) ?? { st: 0, bu: 0, n: 0 };
    d.st += p.stationMs; d.bu += p.buoyMs; d.n += 1;
    acc.daily.set(p.day, d);

    if (p.buoyDirDeg != null && Number.isFinite(p.buoyDirDeg)) {
      const s = directionSector(p.buoyDirDeg);
      const cur = acc.sectors.get(s) ?? { st: 0, bu: 0, n: 0 };
      cur.st += p.stationMs;
      cur.bu += p.buoyMs;
      cur.n += 1;
      acc.sectors.set(s, cur);
    }
  }

  const out: StationCalibration[] = [];

  for (const [stationId, acc] of byStation) {
    const hours = acc.st.length;
    const stationSum = acc.st.reduce((a, b) => a + b, 0);
    const buoySum = acc.bu.reduce((a, b) => a + b, 0);
    const stationMeanMs = stationSum / hours;
    const buoyMeanMs = buoySum / hours;
    // Ratio of means. Equal counts on both sides make the sums sufficient.
    const ratio = buoySum > 0 ? stationSum / buoySum : 0;

    // Response is judged day by day. See MIN_CORRELATION for the measurement
    // that forced this: hourly, a station and a buoy in the same ría scored
    // 0.068 over 707 hours, and the test was the thing at fault.
    const days = [...acc.daily.values()];
    const correlation = pearson(days.map((d) => d.st / d.n), days.map((d) => d.bu / d.n));
    const status = classify(hours, days.length, ratio, correlation, stdev(acc.st));

    const sectors: SectorCalibration[] = [...acc.sectors.entries()]
      .filter(([, v]) => v.n >= MIN_HOURS_SECTOR && v.bu > 0)
      .map(([sector, v]) => ({ sector, ratio: v.st / v.bu, hours: v.n }))
      .sort((a, b) => a.sector - b.sector);

    out.push({
      stationId,
      buoyId: acc.buoyId,
      status,
      ratio: status === 'insufficient' ? null : ratio,
      hours,
      correlation,
      days: acc.daily.size,
      stationMeanMs,
      buoyMeanMs,
      // A station that is not measuring has no transfer function to publish;
      // shipping its per-sector numbers would invite someone to use them.
      // No sector table for an instrument that stopped, nor for a site whose
      // reference cannot speak for it: in both cases the numbers would look
      // like a transfer function and be nothing of the sort.
      sectors: status === 'dead' || status === 'unreferenced' || status === 'insufficient' ? [] : sectors,
    });
  }

  return out.sort((a, b) => a.stationId.localeCompare(b.stationId));
}

/** One line per run for the log, so a silent cycle is still legible. */
export function summariseCalibration(rows: StationCalibration[]): string {
  const n = (s: CalibrationStatus) => rows.filter((r) => r.status === s).length;
  const rated = rows.filter((r) => r.ratio != null).map((r) => r.ratio as number).sort((a, b) => a - b);
  const median = rated.length ? rated[Math.floor(rated.length / 2)] : null;
  return [
    `${rows.length} stations`,
    `${n('exposed')} exposed`,
    `${n('sheltered')} sheltered`,
    `${n('very_sheltered')} very sheltered`,
    `${n('unreferenced')} without a comparable reference`,
    `${n('dead')} not measuring`,
    `${n('insufficient')} too few hours`,
    median != null ? `median ratio ${median.toFixed(3)}` : 'no median yet',
  ].join(', ');
}

// ── The combined reference (v2.160.0) ─────────────────────────────────────

/**
 * An exposed site that stands in for the free stream, and the directions it
 * cannot see from where it is.
 *
 * Why not the buoys any more. On 27-sep the PORTUS buoys turned out to be
 * stored two hours early (their UTC time read as Madrid time), and the Xunta
 * buoys' wind before 22-sep came from the wrong series of the payload. Over a
 * ninety-day window every buoy was comparing the afternoon at a station with a
 * different hour, or with a different number. And the one most stations leaned
 * on, 3221, is a harbour anemometer that reads the free stream only from the
 * W, SW and NW.
 *
 * So the reference is the median of four MeteoGalicia sites on islands and
 * capes, each dropped for the sector it is sheltered from (audit of 27-sep).
 * Their clocks are right, they report every ten minutes, and no single one of
 * them can set the answer. When the buoys are clean again (the PORTUS history
 * corrected, sixty days of good Xunta wind) they can join this median; they are
 * not coming back as the only reference.
 */
export interface ReferenceSite {
  id: string;
  name: string;
  /** Arcs, in degrees the wind comes FROM, where the site reads sheltered. */
  blind: ReadonlyArray<readonly [number, number]>;
}

export const COMBINED_REFERENCE_SITES: readonly ReferenceSite[] = [
  { id: 'mg_10126', name: 'Ons', blind: [[292.5, 337.5]] },
  { id: 'mg_10134', name: 'Sálvora', blind: [] },
  { id: 'mg_10905', name: 'Cabo Udra', blind: [[247.5, 292.5], [22.5, 67.5]] },
  { id: 'mg_19069', name: 'A Lanzada', blind: [] },
];

/** What station_calibration.buoy_id holds for a row measured against the
 *  combined reference. No buoy has id 0. */
export const COMBINED_REFERENCE_ID = 0;

/** Sites that have to report, clear of their blind sector, before an hour
 *  counts. One site alone is a station like any other, not a reference. */
export const MIN_REFERENCE_SITES = 2;

/** One reference site over one hour. */
export interface SiteHour {
  siteId: string;
  /** Start of the hour, epoch seconds. */
  t: number;
  ms: number;
  /** Circular mean direction the wind came FROM; null when it did not report one. */
  dirDeg: number | null;
}

/** One station over one hour, to be measured against the reference. */
export interface StationHour {
  stationId: string;
  /** Start of the hour, epoch seconds: the same key as SiteHour.t. */
  t: number;
  /** Calendar day (YYYY-MM-DD) of the hour, for the daily response test. */
  day: string;
  ms: number;
}

export interface ReferenceValue {
  ms: number;
  dirDeg: number;
  /** Sites behind the value. */
  sites: number;
}

function circularMeanDeg(degs: number[]): number {
  let s = 0, c = 0;
  for (const d of degs) { s += Math.sin(d * Math.PI / 180); c += Math.cos(d * Math.PI / 180); }
  return ((Math.atan2(s, c) * 180 / Math.PI) + 360) % 360;
}

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function isBlindTo(site: ReferenceSite, dirDeg: number): boolean {
  const d = ((dirDeg % 360) + 360) % 360;
  return site.blind.some(([from, to]) => d >= from && d <= to);
}

/**
 * The free stream over one hour, from the sites that reported it.
 *
 * Two passes. The direction everyone agrees on comes first, and only then is
 * each site dropped if it is blind to THAT direction. Using a site's own vane
 * to decide whether it is sheltered would ask the terrain that bends the vane
 * to judge itself.
 *
 * `excludeSiteId` leaves one site out: a reference site measured against a
 * median that contains itself would drift towards a ratio of 1 by construction.
 */
export function combinedReferenceAt(
  rows: SiteHour[],
  sites: readonly ReferenceSite[] = COMBINED_REFERENCE_SITES,
  excludeSiteId?: string,
): ReferenceValue | null {
  const byId = new Map(sites.map((s) => [s.id, s]));
  const reported = rows.filter((r) => r.siteId !== excludeSiteId && byId.has(r.siteId)
    && r.ms > 0 && r.dirDeg != null && Number.isFinite(r.dirDeg));
  if (reported.length < MIN_REFERENCE_SITES) return null;

  const consensus = circularMeanDeg(reported.map((r) => r.dirDeg as number));
  const clear = reported.filter((r) => !isBlindTo(byId.get(r.siteId) as ReferenceSite, consensus));
  if (clear.length < MIN_REFERENCE_SITES) return null;

  return {
    ms: medianOf(clear.map((r) => r.ms)),
    dirDeg: circularMeanDeg(clear.map((r) => r.dirDeg as number)),
    sites: clear.length,
  };
}

/**
 * Pair every station hour with the combined reference of that hour, ready for
 * calibrateStations. Hours without a reference are dropped, not guessed.
 */
export function pairWithCombinedReference(
  stationHours: StationHour[],
  siteHours: SiteHour[],
  sites: readonly ReferenceSite[] = COMBINED_REFERENCE_SITES,
): PairedHour[] {
  const byHour = new Map<number, SiteHour[]>();
  for (const r of siteHours) {
    const list = byHour.get(r.t);
    if (list) list.push(r); else byHour.set(r.t, [r]);
  }
  const siteIds = new Set(sites.map((s) => s.id));
  // The reference of an hour is the same for every station but the sites
  // themselves: compute it once per hour and per left-out site.
  const cache = new Map<string, ReferenceValue | null>();
  const out: PairedHour[] = [];

  for (const h of stationHours) {
    const exclude = siteIds.has(h.stationId) ? h.stationId : undefined;
    const key = `${h.t}|${exclude ?? ''}`;
    let ref = cache.get(key);
    if (ref === undefined) {
      ref = combinedReferenceAt(byHour.get(h.t) ?? [], sites, exclude);
      cache.set(key, ref);
    }
    if (!ref) continue;
    out.push({
      stationId: h.stationId,
      day: h.day,
      buoyId: COMBINED_REFERENCE_ID,
      stationMs: h.ms,
      buoyMs: ref.ms,
      buoyDirDeg: ref.dirDeg,
    });
  }
  return out;
}

/** For the log: how many hours had a reference, and how often each site was
 *  in it. A site that keeps dropping out is worth a look before its absence
 *  quietly reshapes every ratio. */
export function summariseReference(
  siteHours: SiteHour[],
  sites: readonly ReferenceSite[] = COMBINED_REFERENCE_SITES,
): string {
  const byHour = new Map<number, SiteHour[]>();
  for (const r of siteHours) {
    const list = byHour.get(r.t);
    if (list) list.push(r); else byHour.set(r.t, [r]);
  }
  const used = new Map(sites.map((s) => [s.id, 0]));
  let hours = 0;
  for (const rows of byHour.values()) {
    const ref = combinedReferenceAt(rows, sites);
    if (!ref) continue;
    hours++;
    for (const r of rows) {
      const site = sites.find((s) => s.id === r.siteId);
      if (site && r.ms > 0 && r.dirDeg != null && !isBlindTo(site, ref.dirDeg)) {
        used.set(site.id, (used.get(site.id) ?? 0) + 1);
      }
    }
  }
  const parts = sites.map((s) => `${s.name} ${used.get(s.id) ?? 0}`);
  return `${hours} reference hours of ${byHour.size} (${parts.join(', ')})`;
}

// ── A second witness before calling an instrument dead ────────────────────

/**
 * The response test asks whether a station follows the reference. With the
 * reference on the islands and capes, a station at the head of a ría can fail
 * it while working perfectly: its afternoons belong to the local breeze, not
 * to the open coast. The dry run of 28-sep called both Redondela stations
 * dead — and each followed the AEMET station in Redondela day by day (0.77 and
 * 0.67). Two instruments in one town failing together indicts the reference,
 * not the instruments.
 *
 * So a station the reference would call dead is asked a second, independent
 * question: does it move with a neighbour that itself responds to the
 * reference? If it does, the anemometer is working and the site simply has no
 * comparable free stream — unreferenced, which keeps its ratio and publishes no
 * sector table. If it follows nobody, it stays dead. A frozen series has no
 * correlation with anything, so this cannot rescue a stuck sensor.
 */
export const PEER_MIN_CORRELATION = 0.5;

/** Neighbours further than this answer to a different local wind. */
export const PEER_RADIUS_KM = 6;

export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371, r = Math.PI / 180;
  const dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface PeerRescue { stationId: string; peerId: string; correlation: number; km: number }

/**
 * Re-examine every station called dead against its responding neighbours.
 * Returns the rows (rescued ones turned unreferenced) and who vouched for whom,
 * for the log.
 */
export function confirmDeadByPeers(
  rows: StationCalibration[],
  stationHours: StationHour[],
  positions: Map<string, { lat: number; lon: number }>,
): { rows: StationCalibration[]; rescued: PeerRescue[] } {
  const dead = rows.filter((r) => r.status === 'dead');
  if (dead.length === 0) return { rows, rescued: [] };

  const responders = rows.filter((r) => r.status === 'exposed' || r.status === 'sheltered' || r.status === 'very_sheltered');
  const wanted = new Set([...dead, ...responders].map((r) => r.stationId));
  const daily = new Map<string, Map<string, { s: number; n: number }>>();
  for (const h of stationHours) {
    if (!wanted.has(h.stationId)) continue;
    let m = daily.get(h.stationId);
    if (!m) { m = new Map(); daily.set(h.stationId, m); }
    const d = m.get(h.day) ?? { s: 0, n: 0 };
    d.s += h.ms; d.n += 1;
    m.set(h.day, d);
  }
  const dayCorrelation = (a: string, b: string): number | null => {
    const da = daily.get(a), db = daily.get(b);
    if (!da || !db) return null;
    const xs: number[] = [], ys: number[] = [];
    for (const [day, v] of da) {
      const w = db.get(day);
      if (w) { xs.push(v.s / v.n); ys.push(w.s / w.n); }
    }
    return xs.length >= MIN_DAYS ? pearson(xs, ys) : null;
  };

  const rescued: PeerRescue[] = [];
  const out = rows.map((row) => {
    if (row.status !== 'dead') return row;
    const at = positions.get(row.stationId);
    if (!at) return row;
    let best: PeerRescue | null = null;
    for (const peer of responders) {
      const p = positions.get(peer.stationId);
      if (!p) continue;
      const km = distanceKm(at.lat, at.lon, p.lat, p.lon);
      if (km > PEER_RADIUS_KM) continue;
      const r = dayCorrelation(row.stationId, peer.stationId);
      if (r != null && r >= PEER_MIN_CORRELATION && (!best || r > best.correlation)) {
        best = { stationId: row.stationId, peerId: peer.stationId, correlation: r, km };
      }
    }
    if (!best) return row;
    rescued.push(best);
    return { ...row, status: 'unreferenced' as const, sectors: [] };
  });
  return { rows: out, rescued };
}

// ── When to run ────────────────────────────────────────────────────────────

/** The run reads ninety days from the database host, which has 2 GB of RAM:
 *  it belongs in the small hours, not wherever the last restart left the
 *  timer. [start, end) in local time. */
export const CALIBRATION_SLOT: readonly [number, number] = [3, 6];

/** A run inside the slot waits for this much since the previous one. */
export const CALIBRATION_MIN_GAP_H = 20;

/** Past this, the run goes whatever the hour: two missed nights (the host was
 *  down at three in the morning) must not become a week without a table. */
export const CALIBRATION_OVERDUE_H = 44;

export function shouldRunCalibration(lastRunMs: number | null, nowMs: number, localHour: number): boolean {
  if (lastRunMs == null) return true;
  const ageH = (nowMs - lastRunMs) / 3_600_000;
  if (ageH >= CALIBRATION_OVERDUE_H) return true;
  return ageH >= CALIBRATION_MIN_GAP_H && localHour >= CALIBRATION_SLOT[0] && localHour < CALIBRATION_SLOT[1];
}
