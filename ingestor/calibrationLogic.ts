/**
 * The transfer function of a land station, measured against water.
 *
 * A station on land almost never reads the wind that is on the water. The usual
 * remedy is a correction by local experience; this measures it instead. Pair a
 * station hour by hour with a live buoy, and the ratio of their mean speeds is
 * how much of the free stream that site actually sees. Across the Rías the
 * median came out at 0.40 — the typical land station shows less than half.
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

/** One hour where both the station and its reference buoy reported. */
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
