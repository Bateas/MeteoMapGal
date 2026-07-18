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
 *  (b) NO relevant rain around the strike, measured as the DELTA of the
 *      day-accumulated precipitation counter of the nearest station
 *      (<= 15 km). The delta sidesteps the classic trap: `readings.precip`
 *      is usually the running total since midnight, so a flat 8.0 mm all
 *      afternoon means it rained at dawn, NOT that it is raining now.
 *
 * If no station <= 15 km can classify the strike, it is NOT counted as dry
 * (conservative: never put a zone under watch blindly).
 */

import { haversineDistance } from '../src/services/geoUtils.js';

// ── Tunables ─────────────────────────────────────────

/** Max distance strike -> rain station for the dryness check. */
export const MAX_STATION_KM = 15;
/** Accumulated-delta above this (mm) around the strike = relevant rain. */
export const RAIN_DELTA_MM = 0.5;
/** How far AFTER the strike we look for rain (the storm's own rain). */
export const AFTER_WINDOW_MS = 2 * 60 * 60_000;
/** How far BEFORE the strike the baseline reading may be. */
export const BEFORE_WINDOW_MS = 3 * 60 * 60_000;
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
  /** Station precipitation reading (mm) — usually the DAY-ACCUMULATED counter. */
  precip: number;
}

/** Per-station precipitation series, readings sorted ascending by time. */
export interface RainStationSeries {
  stationId: string;
  lat: number;
  lon: number;
  readings: { time: number; precip: number }[];
}

export type DryVerdict = 'dry' | 'wet' | 'unknown';

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

/**
 * Classify one land strike as dry / wet / unknown.
 *
 * Uses the NEAREST station (<= MAX_STATION_KM) that can actually classify:
 * it needs a baseline reading within BEFORE_WINDOW_MS before the strike AND
 * at least one reading within AFTER_WINDOW_MS after it. The verdict comes
 * from the accumulated-counter DELTA between those two, never from the raw
 * value (day-accumulated gotcha, see module header). A negative delta means
 * the counter reset (midnight) or a non-monotonic sensor — that station
 * cannot be trusted for this window, so we fall through to the next one.
 */
export function classifyStrikeDryness(
  strike: FireWatchStrike,
  series: RainStationSeries[],
): DryVerdict {
  const t = strike.time.getTime();

  const candidates = series
    .map((s) => ({ s, km: haversineDistance(strike.lat, strike.lon, s.lat, s.lon) }))
    .filter((c) => c.km <= MAX_STATION_KM)
    .sort((a, b) => a.km - b.km);

  for (const { s } of candidates) {
    let before: number | null = null;
    let after: number | null = null;
    for (const r of s.readings) {
      if (r.time > t + AFTER_WINDOW_MS) break; // sorted — nothing more to see
      if (r.time <= t) {
        if (r.time >= t - BEFORE_WINDOW_MS) before = r.precip; // latest wins
      } else {
        after = after == null ? r.precip : Math.max(after, r.precip);
      }
    }
    if (before == null || after == null) continue; // this station can't classify

    const delta = after - before;
    if (delta < -0.01) continue; // counter reset mid-window — untrustworthy
    return delta > RAIN_DELTA_MM ? 'wet' : 'dry';
  }
  return 'unknown';
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

/**
 * Stable zone key for cooldown maps: centroid snapped to a 0.1 degree grid
 * (~11 x 8 km — same order as CLUSTER_RADIUS_KM), so the key survives small
 * centroid drift as new strikes join the episode.
 */
export function zoneKey(zone: Pick<FireWatchZone, 'lat' | 'lon'>): string {
  return `${zone.lat.toFixed(1)},${zone.lon.toFixed(1)}`;
}

// ── Orchestration ────────────────────────────────────

/** Full pure pipeline: land filter → dryness per strike → zone clustering. */
export function computeFireWatch(
  strikes: FireWatchStrike[],
  rainReadings: RainReading[],
): FireWatchResult {
  const land = strikes.filter((s) => isLikelyLand(s.lat, s.lon));
  const series = groupRainReadings(rainReadings);

  const dry: FireWatchStrike[] = [];
  let wet = 0;
  let unknown = 0;
  for (const s of land) {
    const verdict = classifyStrikeDryness(s, series);
    if (verdict === 'dry') dry.push(s);
    else if (verdict === 'wet') wet++;
    else unknown++;
  }

  const zones = clusterDryStrikes(dry);
  return {
    totalStrikes: strikes.length,
    landStrikes: land.length,
    dryStrikes: dry.length,
    wetStrikes: wet,
    unknownStrikes: unknown,
    zones,
    watchZones: zones.filter((z) => z.inWatch),
  };
}
