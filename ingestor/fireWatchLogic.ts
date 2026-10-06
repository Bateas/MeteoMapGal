/**
 * Fire watch logic — pure, testable (no DB, no network).
 *
 * August fire season: cloud-to-ground strikes WITHOUT rain ("dry lightning")
 * are the measured precursor of wildfires that surface 7-18h later. The
 * lightning-to-fire attribution validated 106/106 hotspots of the June
 * outbreak inside that window — the humus smolders long before the satellite
 * sees the fire. FIRMS tells us when a fire EXISTS; this module warns BEFORE.
 *
 * Rigor rule (>= 2 independent variables + physical discriminator):
 *  (a) the strike hit LAND — crude geographic filter, conservatively biased
 *      so coastal-fringe strikes are dropped rather than ever watching the
 *      open sea (see isLikelyLand), and
 *  (b) NO relevant rain around the strike: the rain the gauges <= 15 km
 *      measured from RAIN_BEFORE_MIN before the strike to RAIN_AFTER_MIN
 *      after it, read with the meaning of each network (precipSemantics.ts).
 *      Until 30-sep every gauge was read as a day counter (after - before),
 *      which is right for Wunderground and Meteoclimatic but not for
 *      MeteoGalicia, AEMET or IPMA, whose value is the rain of the last
 *      interval: steady rain gave a difference of zero and the strike went
 *      down as dry.
 *
 * Who may call a strike dry: an official gauge (rain per interval, kept by
 * MeteoGalicia/AEMET/IPMA) on its own; a home gauge only with a second one
 * agreeing, because a home station without a gauge reports 0 forever. Any
 * gauge that measured rain makes the strike wet. And only once its readings
 * cover the whole window: a strike is "pending" until then. If no gauge
 * <= 15 km can say, it is NOT counted as dry (never watch a zone blindly).
 */

import { haversineDistance } from '../src/services/geoUtils.js';
import { precipKindFor, rainInWindowMm, type PrecipSample } from '../src/services/precipSemantics.js';
import { RAIN_GAUGE_BLACKLIST } from '../src/services/rainNowService.js';

// ── Mute gauges ──────────────────────────────────────

/** One station's rain on one local day: the sum of its hourly totals (readings_hourly). For a day
 *  counter (wu_, mc_) the sum is not the rain, but it is 0 only when the counter never left 0. */
export interface DailyRain { stationId: string; day: string; mm: number }

/** A day counts as «it rained here» when an official gauge this close measured at least WET_DAY_MM. */
const MUTE_NEAR_KM = 15;
const MUTE_FAR_KM = 30;
const WET_DAY_MM = 3;

/**
 * Gauges that read nothing when it rains around them: no gauge at all (a station without one
 * reports 0 forever) or a clogged one. Judged against OFFICIAL gauges only, day by day, so a long
 * dry spell in summer (when the fire watch matters most) flags nobody:
 *  - near: on >= 2 days an official gauge <= 15 km measured >= 3 mm, and it read 0 on >= 80 % of them;
 *  - far: no official within 15 km, but on >= 3 such days of one <= 30 km it read 0 every time.
 * On 6-oct, 14 gauges read 0.0 under 45-55 dBZ with their neighbours soaked; Moncao and Valenca,
 * the two nearest to the strikes of that day's «dry lightning» fire watch, had never recorded rain
 * in 45 days.
 */
export function findMuteGauges(daily: DailyRain[], coords: Map<string, { lat: number; lon: number }>): Set<string> {
  const byStation = new Map<string, Map<string, number>>();
  for (const r of daily) {
    if (!Number.isFinite(r.mm)) continue;
    const m = byStation.get(r.stationId) ?? new Map<string, number>();
    m.set(r.day, (m.get(r.day) ?? 0) + r.mm);
    byStation.set(r.stationId, m);
  }
  const witnesses = [...byStation.keys()].filter((id) => precipKindFor(id) === 'interval' && !RAIN_GAUGE_BLACKLIST.has(id) && coords.has(id));
  const mute = new Set<string>();
  for (const [id, days] of byStation) {
    const at = coords.get(id);
    if (!at) continue;
    const near: string[] = [], far: string[] = [];
    for (const w of witnesses) {
      if (w === id) continue;
      const c = coords.get(w)!;
      const km = haversineDistance(at.lat, at.lon, c.lat, c.lon);
      if (km <= MUTE_NEAR_KM) near.push(w);
      else if (km <= MUTE_FAR_KM) far.push(w);
    }
    const judge = (ws: string[]) => {
      let wet = 0, zero = 0;
      for (const [day, mm] of days) {
        if (!ws.some((w) => (byStation.get(w)!.get(day) ?? 0) >= WET_DAY_MM)) continue;
        wet++;
        if (mm <= 0) zero++;
      }
      return { wet, zero };
    };
    if (near.length) {
      const j = judge(near);
      if (j.wet >= 2 && j.zero >= 0.8 * j.wet) mute.add(id);
    } else if (far.length) {
      const j = judge(far);
      if (j.wet >= 3 && j.zero === j.wet) mute.add(id);
    }
  }
  return mute;
}

// ── Tunables ─────────────────────────────────────────

/** Max distance strike -> rain station for the dryness check. */
export const MAX_STATION_KM = 15;
/** Rain in the window at or above this (mm) = the strike fell with rain. */
export const WET_RAIN_MM = 0.5;
/** The window starts this long before the strike (rain just before wets the fuel too)... */
export const RAIN_BEFORE_MIN = 30;
/**
 * ...and ends this long after it (the storm's own rain). Replayed on 5-sep, a
 * second hour changed the verdict of 1 % of the strikes and delayed every
 * message by an hour: the fire of 6-sep at Ibias would have gone into the night
 * silence and out at 07:00, after the satellite saw it at 03:45; with one hour
 * it goes at 22:00 the evening before.
 */
export const RAIN_AFTER_MIN = 60;
/**
 * How far apart a gauge's readings may be, in minutes, for it to vouch for a
 * window: its reporting interval plus some slack. Measured 28-sep: MeteoGalicia
 * every 10 min, Wunderground 5, Meteoclimatic 15, Netatmo 30 (with the rain of
 * the last hour), AEMET and IPMA every hour (with the rain of that hour). It
 * bounds the gaps inside the window (except for day counters, which keep what
 * fell during a gap) and how late the reading that closes the window may come.
 * Null for a network we do not know: that gauge can only ever say wet.
 */
export function maxGapMinFor(stationId: string): number | null {
  if (stationId.startsWith('mg_')) return 30;
  if (stationId.startsWith('wu_')) return 30;
  if (stationId.startsWith('mc_')) return 45;
  if (stationId.startsWith('nt_')) return 60;
  if (stationId.startsWith('aemet_') || stationId.startsWith('ipma_')) return 90;
  return null;
}
/** A strike stays "pending" (not unknown) this long past its window: an hourly
 *  gauge closes it up to 90 min late and AEMET delivers ~35 min after that. */
export const PENDING_MARGIN_MIN = 150;
/** Greedy cluster radius for grouping dry strikes into zones. */
export const CLUSTER_RADIUS_KM = 10;
/** A zone enters watch with this many dry strikes... */
export const MIN_STRIKES_FOR_WATCH = 2;
/** ...or a single one at |peak_current| >= this (incendiary strikes run high). */
export const HIGH_CURRENT_KA = 30;

// ── Types ────────────────────────────────────────────

export interface FireWatchStrike {
  time: Date;
  lat: number;
  lon: number;
  /** kA, signed. Null when the provider omitted it. */
  peakCurrent: number | null;
}

export interface RainReading {
  stationId: string;
  lat: number;
  lon: number;
  time: Date;
  /** Station precipitation reading (mm), with its network's meaning (precipSemantics.ts). */
  precip: number;
}

/** Per-station precipitation series, readings sorted ascending by time. */
export interface RainStationSeries {
  stationId: string;
  lat: number;
  lon: number;
  readings: { time: number; precip: number }[];
}

/** `pending`: the window around the strike is not over (plus the time the
 *  readings take to arrive), so a gauge may still report its rain. */
export type DryVerdict = 'dry' | 'wet' | 'unknown' | 'pending';

export interface FireWatchZone {
  /** Centroid of the grouped dry strikes. */
  lat: number;
  lon: number;
  strikeCount: number;
  /** Max |peak_current| among the grouped strikes (0 when all null). */
  maxAbsKa: number;
  /** Meets the watch threshold (>= 2 strikes, or 1 at >= 30 kA). */
  inWatch: boolean;
}

export interface FireWatchResult {
  totalStrikes: number;
  landStrikes: number;
  dryStrikes: number;
  wetStrikes: number;
  /** Land strikes with no usable station <= 15 km — NOT watched (conservative). */
  unknownStrikes: number;
  /** Land strikes whose window is not over yet — judged on a later cycle. */
  pendingStrikes: number;
  zones: FireWatchZone[];
  watchZones: FireWatchZone[];
}

// ── Land filter ──────────────────────────────────────

/**
 * CRUDE land mask for Galicia. This is a handful of straight lines, not a
 * coastline polygon: the real coast meanders between lon -9.30 (Fisterra)
 * and -8.60 (inner rias), and the north coast runs E-W at lat ~43.55-43.79.
 * Every boundary is biased INLAND on purpose — better to lose a genuine
 * coastal strike than to put a patch of open sea under fire watch. Known
 * accepted losses: Cies/Cabo Home fringe, outer Costa da Morte, the whole
 * Mariña Lucense strip north of 43.55, A Guarda/Baiona shoreline. Known
 * accepted noise: inner ria waters (Arousa/Vigo) can still pass as "land" —
 * fixing that needs real polygons, not worth it for a vigilance heads-up.
 */
export function isLikelyLand(lat: number, lon: number): boolean {
  // Outside Galicia's N-S span (open sea north of Estaca / Portugal south).
  if (lat < 41.8 || lat > 43.75) return false;
  // East of Galicia (Leon/Zamora/Asturias interior) — land, but out of scope.
  if (lon > -6.5) return false;

  // West boundary (Atlantic), piecewise by latitude, biased EAST of the
  // real coast so the fringe falls out.
  const westLimit =
    lat < 42.15 ? -8.75   // A Guarda..Vigo (real coast ~ -8.90)
    : lat < 42.55 ? -8.70 // Rias Baixas (Cabo Home ~ -8.90; Cies excluded)
    : lat < 43.20 ? -9.05 // Muros..Costa da Morte (Fisterra ~ -9.30), keeps Barbanza
    : -8.25;              // Golfo Artabro..Ortegal (coast wraps north)
  if (lon < westLimit) return false;

  // North boundary (Cantabrico): flat conservative cap — drops the
  // Burela/San Cibrao/Estaca coastal strip along with the sea.
  if (lat > 43.55) return false;
  // NW corner (Ortegal/Cedeira) where the sea wraps around: tighten further.
  if (lat > 43.45 && lon < -7.95) return false;

  return true;
}

// ── Dryness classification ───────────────────────────

/** Group flat rain readings into per-station sorted series. */
export function groupRainReadings(readings: RainReading[]): RainStationSeries[] {
  const map = new Map<string, RainStationSeries>();
  for (const r of readings) {
    if (!Number.isFinite(r.precip) || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;
    let s = map.get(r.stationId);
    if (!s) {
      s = { stationId: r.stationId, lat: r.lat, lon: r.lon, readings: [] };
      map.set(r.stationId, s);
    }
    s.readings.push({ time: r.time.getTime(), precip: r.precip });
  }
  for (const s of map.values()) s.readings.sort((a, b) => a.time - b.time);
  return Array.from(map.values());
}

const MIN_MS = 60_000;

/** What one gauge says about the window of a strike. */
export interface GaugeVote {
  /** Rain measured in the window so far (mm). */
  mm: number;
  /** Its readings cover the whole window, so a small `mm` really means dry. */
  canSayDry: boolean;
  /** A gauge of MeteoGalicia, AEMET or IPMA (rain per interval). */
  official: boolean;
}

/**
 * What one gauge says about the window of a strike at `t`, with the readings
 * delivered by `nowMs`. The window runs from RAIN_BEFORE_MIN before the strike
 * to the first reading at or after RAIN_AFTER_MIN after it (an hourly gauge
 * closes it up to an hour late; its rain is part of the answer). Null when the
 * gauge cannot say: unknown network, no reading in the window, or a day counter
 * without two readings to measure.
 */
export function gaugeVote(s: RainStationSeries, t: number, nowMs: number): GaugeVote | null {
  const kind = precipKindFor(s.stationId);
  if (kind === null) return null;
  const start = t - RAIN_BEFORE_MIN * MIN_MS;
  const nominalEnd = t + RAIN_AFTER_MIN * MIN_MS;
  const gapMin = maxGapMinFor(s.stationId);
  const horizon = Math.min(nowMs, nominalEnd + (gapMin ?? 0) * MIN_MS);
  const samples: PrecipSample[] = [];
  for (const r of s.readings) if (r.time <= horizon) samples.push({ t: r.time, mm: r.precip });
  const closing = samples.find((x) => x.t >= nominalEnd);
  const end = closing ? closing.t : Math.min(horizon, nominalEnd);
  if (end <= start) return null;
  const mm = rainInWindowMm(s.stationId, samples, end, (end - start) / MIN_MS);
  if (mm == null) return null;

  let canSayDry = gapMin != null && closing != null;
  // A day counter keeps what fell during a gap; a gauge per interval or per last
  // hour loses it, so it cannot vouch for a window with a hole in it.
  if (canSayDry && kind !== 'dayTotal') {
    let prev = start;
    for (const x of samples) {
      if (x.t <= start) continue;
      if (x.t > end) break;
      if (x.t - prev > gapMin! * MIN_MS) {
        canSayDry = false;
        break;
      }
      prev = x.t;
    }
  }
  return { mm, canSayDry, official: kind === 'interval' };
}

/**
 * Classify one land strike as dry / wet / pending / unknown, walking the
 * gauges <= MAX_STATION_KM from the nearest out:
 *  - a gauge that measured WET_RAIN_MM or more in the window: wet;
 *  - an official gauge that covers the window and measured less: dry;
 *  - a home gauge that covers the window and measured less counts half:
 *    dry needs a second one (a station without a gauge reports 0 forever).
 * Without a verdict: pending while the window (plus PENDING_MARGIN_MIN for
 * the readings to arrive) is not over, unknown after — never dry by default.
 */
export function classifyStrikeDryness(
  strike: FireWatchStrike,
  series: RainStationSeries[],
  nowMs: number,
): DryVerdict {
  const t = strike.time.getTime();

  const candidates = series
    .map((s) => ({ s, km: haversineDistance(strike.lat, strike.lon, s.lat, s.lon) }))
    .filter((c) => c.km <= MAX_STATION_KM)
    .sort((a, b) => a.km - b.km);

  let homeDry = 0;
  for (const { s } of candidates) {
    const vote = gaugeVote(s, t, nowMs);
    if (!vote) continue;
    if (vote.mm >= WET_RAIN_MM) return 'wet';
    if (!vote.canSayDry) continue;
    if (vote.official) return 'dry';
    if (++homeDry >= 2) return 'dry';
  }
  return nowMs < t + (RAIN_AFTER_MIN + PENDING_MARGIN_MIN) * MIN_MS ? 'pending' : 'unknown';
}

// ── Zone clustering ──────────────────────────────────

/**
 * Greedy single-pass clustering of dry strikes into zones (same pattern as
 * spotClustering.ts): first unclaimed strike seeds a zone, absorbs every
 * strike within radiusKm of the SEED, repeat. Stable and predictable for
 * the low N we expect (a dry-storm episode is tens of strikes, not thousands).
 */
export function clusterDryStrikes(
  dryStrikes: FireWatchStrike[],
  radiusKm: number = CLUSTER_RADIUS_KM,
): FireWatchZone[] {
  const remaining = dryStrikes.slice();
  const zones: FireWatchZone[] = [];

  while (remaining.length > 0) {
    const seed = remaining.shift()!;
    const group: FireWatchStrike[] = [seed];
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (haversineDistance(seed.lat, seed.lon, remaining[i].lat, remaining[i].lon) <= radiusKm) {
        group.push(remaining[i]);
        remaining.splice(i, 1);
      }
    }

    const lat = group.reduce((acc, g) => acc + g.lat, 0) / group.length;
    const lon = group.reduce((acc, g) => acc + g.lon, 0) / group.length;
    const maxAbsKa = group.reduce((acc, g) => Math.max(acc, Math.abs(g.peakCurrent ?? 0)), 0);

    zones.push({
      lat,
      lon,
      strikeCount: group.length,
      maxAbsKa,
      inWatch: group.length >= MIN_STRIKES_FOR_WATCH || maxAbsKa >= HIGH_CURRENT_KA,
    });
  }

  return zones;
}

// ── One message per storm, not one per zone ──────────

/**
 * Until 30-sep every zone was its own message, keyed by a 0.1 degree cell: a
 * storm crossing Ourense and Lugo on 5-sep sent 61 in the evening and 38 the
 * next morning (20 at once at 07:24, the queue of the night silence). Now a
 * zone within ALERT_DEDUPE_KM of one announced in the last ALERT_COOLDOWN_MS
 * is the same episode, the new ones go out together, and at most one message
 * every DIGEST_MIN_GAP_MS. Replayed on 5-sep: 7 messages instead of 97.
 */
export const ALERT_DEDUPE_KM = 15;
export const ALERT_COOLDOWN_MS = 12 * 60 * 60_000;
export const DIGEST_MIN_GAP_MS = 60 * 60_000;
/** Zones named in one message; the rest are counted. */
export const DIGEST_MAX_LISTED = 5;

/** A zone already announced, and when. */
export interface AlertedZone {
  lat: number;
  lon: number;
  atMs: number;
}

/** The zones in watch that no recent message has covered. */
export function freshZones(watch: FireWatchZone[], alerted: AlertedZone[], nowMs: number): FireWatchZone[] {
  return watch.filter((z) => !alerted.some((a) =>
    nowMs - a.atMs < ALERT_COOLDOWN_MS && haversineDistance(a.lat, a.lon, z.lat, z.lon) <= ALERT_DEDUPE_KM));
}

/** Key of an announced zone: its centroid to 0.01 degree, readable back after a restart. */
export function alertedZoneKey(zone: Pick<FireWatchZone, 'lat' | 'lon'>): string {
  return `${zone.lat.toFixed(2)},${zone.lon.toFixed(2)}`;
}

/** The centroid of a key (also the 0.1 degree keys stored before 30-sep); null if it is not one. */
export function parseAlertedZoneKey(key: string): { lat: number; lon: number } | null {
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(key.trim());
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

/** A zone as it goes into a message. */
export interface DigestZone {
  lat: number;
  lon: number;
  strikeCount: number;
  maxAbsKa: number;
  /** Nearest named station, for "cerca de X". */
  near?: string;
}

const SMALL_WORDS = new Set(['de', 'do', 'da', 'dos', 'das', 'del', 'la', 'las', 'los', 'el', 'e', 'y']);

/** A station name as a place: single spaces, and AEMET's capitals in title case
 *  ("IBIAS  SAN ANTOLIN" -> "Ibias San Antolin", "FOLGOSO DO COUREL" -> "Folgoso do Courel"). */
export function placeName(raw: string): string {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (s !== s.toUpperCase() || !/\p{Lu}/u.test(s)) return s;
  return s.toLowerCase().split(' ')
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.replace(/(^|-)(\p{L})/gu, (_m, p: string, c: string) => p + c.toUpperCase())))
    .join(' ');
}

/**
 * The text of one message. Zones next to the same place are one place (a storm
 * leaves several clusters around the same village); the places with most dry
 * strikes go first, at most DIGEST_MAX_LISTED by name.
 */
export function fireWatchDigestText(zones: DigestZone[]): string {
  const byPlace = new Map<string, DigestZone>();
  const unnamed: DigestZone[] = [];
  for (const z of zones) {
    if (!z.near) { unnamed.push(z); continue; }
    const same = byPlace.get(z.near);
    if (same) {
      same.strikeCount += z.strikeCount;
      same.maxAbsKa = Math.max(same.maxAbsKa, z.maxAbsKa);
    } else {
      byPlace.set(z.near, { ...z });
    }
  }
  const sorted = [...byPlace.values(), ...unnamed].sort((a, b) => b.strikeCount - a.strikeCount || b.maxAbsKa - a.maxAbsKa);
  const listed = sorted.slice(0, DIGEST_MAX_LISTED).map((z) => {
    const where = z.near ? `cerca de ${z.near}` : `zona ${z.lat.toFixed(2)},${z.lon.toFixed(2)}`;
    const rayos = z.strikeCount === 1 ? '1 rayo' : `${z.strikeCount} rayos`;
    const ka = z.maxAbsKa >= HIGH_CURRENT_KA ? `, hasta ${Math.round(z.maxAbsKa)} kA` : '';
    return `${where} (${rayos}${ka})`;
  });
  const rest = sorted.length - listed.length;
  const what = sorted.length === 1
    ? `Rayos a tierra sin lluvia ${listed[0]}`
    : `Rayos a tierra sin lluvia en ${sorted.length} zonas: ${listed.join('; ')}${rest > 0 ? `; y ${rest} más` : ''}`;
  return `Vigilancia de incendio. ${what}. Los incendios por rayo suelen aparecer entre 7 y 18 horas después.`;
}

// ── Orchestration ────────────────────────────────────

/** Full pure pipeline: land filter → dryness per strike → zone clustering. */
export function computeFireWatch(
  strikes: FireWatchStrike[],
  rainReadings: RainReading[],
  nowMs: number,
): FireWatchResult {
  const land = strikes.filter((s) => isLikelyLand(s.lat, s.lon));
  const series = groupRainReadings(rainReadings);

  const dry: FireWatchStrike[] = [];
  let wet = 0;
  let unknown = 0;
  let pending = 0;
  for (const s of land) {
    const verdict = classifyStrikeDryness(s, series, nowMs);
    if (verdict === 'dry') dry.push(s);
    else if (verdict === 'wet') wet++;
    else if (verdict === 'pending') pending++;
    else unknown++;
  }

  const zones = clusterDryStrikes(dry);
  return {
    totalStrikes: strikes.length,
    landStrikes: land.length,
    dryStrikes: dry.length,
    wetStrikes: wet,
    unknownStrikes: unknown,
    pendingStrikes: pending,
    zones,
    watchZones: zones.filter((z) => z.inWatch),
  };
}
