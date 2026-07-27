/**
 * Pure helpers for active-fire processing.
 *
 * - Parse FIRMS CSV → ActiveFire[]
 * - Filter low-confidence + industrial false-positives
 * - Classify aggregate severity for sector
 *
 * No I/O — fetched separately by firmsClient + ingestor proxy.
 */

import type { ActiveFire, FireConfidence } from '../types/fire';
import { isFireActive, type FireCluster } from './fireClustering';

/**
 * VIIRS NRT products we poll, both at 375m.
 *
 * S-NPP alone gives ~2 overpasses a day; adding NOAA-20 roughly doubles that,
 * which is time shaved off "the hill is burning" → "we can see it". The two
 * satellites report the same fire separately and we keep both observations:
 * active_fires keys on satellite + acquisition time, and the frontend fire id
 * already includes the timestamp.
 */
export const FIRMS_PRODUCTS = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT'] as const;

/**
 * Merge several FIRMS CSV responses into one.
 *
 * Keeps the first non-empty header and appends every data row. Empty or
 * header-only responses contribute nothing — a satellite with no hotspots in
 * the window is the normal case, not a failure. Returns '' when nothing usable
 * came back, so callers can tell "no fires" from "no data".
 */
export function mergeFirmsCsv(csvs: (string | null)[]): string {
  let header = '';
  const rows: string[] = [];

  for (const csv of csvs) {
    if (!csv) continue;
    const lines = csv.trim().split(/\r?\n/);
    if (lines.length === 0 || !lines[0].startsWith('latitude')) continue;
    if (!header) header = lines[0];
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim()) rows.push(lines[i]);
    }
  }

  if (!header) return '';
  return rows.length ? `${header}\n${rows.join('\n')}` : header;
}

/**
 * FIRMS confidence → enum, in every format NASA ships it.
 *
 * The Area-API returns letters (h/n/l); the bulk regional CSVs return whole
 * words (high/nominal/low); MODIS products return a 0-100 percentage. Reading
 * only letters meant that if NASA ever aligned the formats, every row would
 * fall through to 'low' and the whole layer would switch off in silence.
 *
 * An unrecognised value is therefore treated as 'nominal', not 'low': an
 * unknown format is our problem, and it must not be reported to the user as
 * "no fires". 'low' has to be stated by the feed to be believed.
 */
export function parseConfidence(raw: string): FireConfidence {
  const c = raw?.trim().toLowerCase();
  if (!c) return 'nominal';
  if (c === 'h' || c === 'high') return 'high';
  if (c === 'n' || c === 'nominal') return 'nominal';
  if (c === 'l' || c === 'low') return 'low';
  // MODIS-style percentage
  const pct = Number.parseFloat(c);
  if (Number.isFinite(pct)) {
    if (pct >= 80) return 'high';
    if (pct >= 30) return 'nominal';
    return 'low';
  }
  return 'nominal';
}

/**
 * Parse FIRMS Area-API CSV response into ActiveFire[].
 * Column order documented in https://firms.modaps.eosdis.nasa.gov/api/area/
 *
 * latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,
 * instrument,confidence,version,bright_ti5,frp,daynight
 */
export function parseFirmsCsv(csv: string): ActiveFire[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const out: ActiveFire[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 14) continue;

    const lat = Number.parseFloat(cols[0]);
    const lon = Number.parseFloat(cols[1]);
    const brightness = Number.parseFloat(cols[2]);
    const acqDate = cols[5];
    const acqTime = cols[6]; // HHMM string, e.g. "1242" or "258" (no leading zero)
    const satellite = cols[7];
    const confidence = parseConfidence(cols[9]);
    const frp = Number.parseFloat(cols[12]);
    const daynight = cols[13]?.trim() === 'D' ? 'D' : 'N';

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    // FIRMS time is HHMM UTC, stripped of leading zeros (e.g. "258" → 02:58)
    const tStr = acqTime.padStart(4, '0');
    const hour = Number(tStr.slice(0, 2));
    const min = Number(tStr.slice(2, 4));
    const acquiredAt = new Date(`${acqDate}T${tStr.slice(0, 2)}:${tStr.slice(2, 4)}:00Z`);
    if (Number.isNaN(acquiredAt.getTime())) continue;
    if (!Number.isFinite(hour) || !Number.isFinite(min)) continue;

    out.push({
      id: `${lat.toFixed(5)}_${lon.toFixed(5)}_${acqDate}_${tStr}`,
      lat,
      lon,
      brightness: Number.isFinite(brightness) ? brightness : 0,
      frp: Number.isFinite(frp) ? frp : 0,
      acquiredAt,
      satellite,
      confidence,
      daynight,
    });
  }
  return out;
}

/**
 * Brightness floor by day. VIIRS I-4 reads a fire against a sunlit background,
 * so a genuine wildfire sits well above this: in the live European 24h feed the
 * 5th percentile of daytime detections is 331K.
 */
export const FIRE_BRIGHTNESS_MIN_DAY = 320;

/**
 * Brightness floor by night — VIIRS's own nocturnal threshold.
 *
 * Against a cold night background the same fire reads ~30K cooler, so the
 * daytime floor is a blindfold after dark: measured on the live European feed,
 * 320K discards 61.8% of all night detections (median 313K, p10 300K) while
 * discarding 0.4% by day. That is how a real hotspot inside Galicia was thrown
 * away at 303.78K.
 *
 * 295K is not a number we invented: it is the nocturnal candidate threshold of
 * the VIIRS 375m algorithm itself, and the feed proves it — of 2718 night rows,
 * the coldest is exactly 295.00K. So after dark we defer to the instrument,
 * which discriminates BETTER at night (cold background) and where, verified on
 * the same feed, it never once returns a 'low' confidence row.
 */
export const FIRE_BRIGHTNESS_MIN_NIGHT = 295;

/**
 * Drop detections we should not show as fires.
 *
 * `confidence='low'` does NOT mean "too cool to be a fire" — the earlier
 * comment here had the physics wrong. Per the FIRMS documentation, low marks
 * sun glint and thermal anomalies below the ~15K contextual margin; in the live
 * feed all 180 low rows are daytime (glint needs sun) and 63 of them carry an
 * FRP of 20MW or more. They are dropped for being unreliable, not for being cold.
 *
 * Measured impact of the day/night split on the live European 24h feed: of 4078
 * rows, 2218 survived before and 3898 now. All 1680 recovered rows are
 * nocturnal — the daytime count is unchanged at 1180, because by day the
 * brightness floor removed nothing the confidence gate had not already removed.
 */
export function filterRealFires(fires: ActiveFire[]): ActiveFire[] {
  return fires.filter(
    (f) =>
      f.confidence !== 'low' &&
      f.brightness >=
        (f.daynight === 'D' ? FIRE_BRIGHTNESS_MIN_DAY : FIRE_BRIGHTNESS_MIN_NIGHT),
  );
}

export type FireSeverity = 'none' | 'aviso' | 'alerta';

/** Close enough that it bears on being here right now. */
export const FIRE_NEAR_KM = 30;

/**
 * Beyond this we say nothing at all.
 *
 * A fire 178km away in Zamora is not news for someone deciding whether to sail
 * in the Rías, and announcing it as if it were local is what turned this layer
 * into noise. Between the two bands a fire is mentioned only WITH its distance
 * and direction, never as a bare count.
 */
export const FIRE_MENTION_KM = 100;

/** Where a fire is, relative to the sector the user is looking at. */
export interface FireProximity {
  cluster: FireCluster;
  distanceKm: number;
  /** Full Spanish compass word, e.g. "suroeste" — ready for UI copy */
  bearing: string;
}

export interface FireAggregate {
  severity: FireSeverity;
  /** Distinct FIRES worth mentioning. Never a hotspot-pixel count. */
  fireCount: number;
  /** Detections behind those fires — transparency, not a headline number */
  hotspotCount: number;
  /** Strongest single fire front in range (MW) */
  maxFrpMw: number;
  nearest: FireProximity | null;
  /** Within FIRE_MENTION_KM, nearest first */
  relevant: FireProximity[];
}

const COMPASS_ES = [
  'norte', 'noreste', 'este', 'sureste',
  'sur', 'suroeste', 'oeste', 'noroeste',
];

/** 8-point compass word for a bearing in degrees. */
function compassEs(bearingDeg: number): string {
  const idx = Math.round(((bearingDeg % 360) + 360) % 360 / 45) % 8;
  return COMPASS_ES[idx];
}

/**
 * Where one fire sits relative to a sector — distance and compass word.
 * Shared by the aggregate and by the map popup so a fire can never be 54km
 * "south" in one place and something else in the other.
 */
export function fireProximity(
  cluster: FireCluster,
  sectorCenter: [number, number], // [lon, lat]
): FireProximity {
  const [cLon, cLat] = sectorCenter;
  // Equirectangular approximation — ~1° lat = 111km
  const dLat = (cluster.lat - cLat) * 111;
  const dLon = (cluster.lon - cLon) * 111 * Math.cos((cLat * Math.PI) / 180);
  return {
    cluster,
    distanceKm: Math.hypot(dLat, dLon),
    // Bearing from the sector toward the fire, 0 = north, clockwise
    bearing: compassEs((Math.atan2(dLon, dLat) * 180) / Math.PI),
  };
}

/**
 * Aggregate ACTIVE fires around a sector.
 *
 * Takes clusters, never raw hotspots: the whole point is that the user hears
 * about fires, not about satellite pixels. Stale clusters are excluded here —
 * a detection from 20h ago cannot support the claim that something is burning
 * now (the map still shows it, dimmed and dated).
 *
 * We deliberately do NOT name the place. Naming a municipality or a country
 * needs an admin-boundary lookup we do not have client-side, and the border
 * with Portugal runs right through the area we watch: distance and direction
 * are always true, an invented place name is not.
 *
 * Distance uses the equirectangular approximation — fine under ~500km.
 */
export function aggregateFiresForSector(
  clusters: FireCluster[],
  sectorCenter: [number, number], // [lon, lat]
  nearKm = FIRE_NEAR_KM,
  mentionKm = FIRE_MENTION_KM,
  now = Date.now(),
): FireAggregate {
  const empty: FireAggregate = {
    severity: 'none',
    fireCount: 0,
    hotspotCount: 0,
    maxFrpMw: 0,
    nearest: null,
    relevant: [],
  };
  if (clusters.length === 0) return empty;

  const relevant: FireProximity[] = [];

  for (const cluster of clusters) {
    if (!isFireActive(cluster, now)) continue;
    const near = fireProximity(cluster, sectorCenter);
    if (near.distanceKm > mentionKm) continue;
    relevant.push(near);
  }

  if (relevant.length === 0) return empty;

  relevant.sort((a, b) => a.distanceKm - b.distanceKm);
  const nearest = relevant[0];

  return {
    severity: nearest.distanceKm <= nearKm ? 'alerta' : 'aviso',
    fireCount: relevant.length,
    hotspotCount: relevant.reduce((s, r) => s + r.cluster.hotspotCount, 0),
    maxFrpMw: relevant.reduce((m, r) => Math.max(m, r.cluster.frpMw), 0),
    nearest,
    relevant,
  };
}

/**
 * How long ago the satellite last saw it, in plain Spanish.
 * Freshness is always on screen: a red dot with no time behind it is the same
 * silent claim that let 24h-old hotspots pass for active fires.
 */
export function formatFireAge(latestAt: Date, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - latestAt.getTime()) / 60_000));
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  if (h < 6 && rest >= 10) return `hace ${h} h ${rest} min`;
  return `hace ${h} h`;
}
