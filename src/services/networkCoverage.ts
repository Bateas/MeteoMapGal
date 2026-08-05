/**
 * The station network, counted by province and by source.
 *
 * This exists because "we have 457 stations" is not something anyone could
 * check. The count lived in a constant in the guide and in a line of the
 * ingestor log, and when the network doubled in a night the only honest
 * answer to "can we see the new ones?" was no.
 *
 * Two things it deliberately does NOT do:
 *
 *  - It does not go on the sector map. The map answers "here and now", and a
 *    station in Lugo changes no decision in Vigo. Painting the new ones next
 *    to the curated ones would also make them look equal, and they are not:
 *    none of them is calibrated yet.
 *  - It does not report a single number. `/api/v1/stations` is built from
 *    `readings`, so it lists every station that ever reported and never drops
 *    a dead one — a total on its own would keep counting stations that went
 *    silent months ago. Active-in-the-last-window is the figure that means
 *    something; the difference between the two is the maintenance signal.
 */

export interface CoverageStation {
  station_id: string;
  source: string;
  /** ISO timestamp of the most recent reading, or null if never. */
  last_reading: string | null;
  province: string | null;
}

export interface SourceCoverage {
  source: string;
  total: number;
  active: number;
}

export interface ProvinceCoverage {
  province: string;
  total: number;
  active: number;
  bySource: SourceCoverage[];
}

export interface NetworkCoverage {
  provinces: ProvinceCoverage[];
  total: number;
  active: number;
  /** Sources ranked by how many active stations they contribute overall. */
  bySource: SourceCoverage[];
}

/** A station is counted as alive if it reported within this window. Two hours
 *  rather than one because the slowest sources here publish hourly, and an
 *  AEMET station that reported 55 minutes ago is not a problem. */
export const ACTIVE_WINDOW_MS = 2 * 60 * 60 * 1000;

/** Stations whose province could not be resolved still have to be visible —
 *  hiding them would make the provinces add up to less than the network and
 *  nobody would know why. */
export const UNPLACED_LABEL = 'Sin provincia';
const NO_PROVINCE = UNPLACED_LABEL;

const SOURCE_LABEL: Record<string, string> = {
  aemet: 'AEMET',
  meteogalicia: 'MeteoGalicia',
  meteoclimatic: 'Meteoclimatic',
  wunderground: 'Wunderground',
  netatmo: 'Netatmo',
  skyx: 'SkyX',
};

export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}

function isActive(lastReading: string | null, nowMs: number): boolean {
  if (!lastReading) return false;
  const t = new Date(lastReading).getTime();
  // An unparseable date is not evidence of life.
  if (!Number.isFinite(t)) return false;
  return nowMs - t <= ACTIVE_WINDOW_MS;
}

export function summariseCoverage(
  stations: CoverageStation[],
  nowMs: number = Date.now(),
): NetworkCoverage {
  const byProvince = new Map<string, Map<string, SourceCoverage>>();
  const overall = new Map<string, SourceCoverage>();
  let total = 0;
  let active = 0;

  for (const s of stations) {
    const province = s.province?.trim() || NO_PROVINCE;
    const alive = isActive(s.last_reading, nowMs);

    total++;
    if (alive) active++;

    let sources = byProvince.get(province);
    if (!sources) {
      sources = new Map();
      byProvince.set(province, sources);
    }
    for (const bucket of [sources, overall]) {
      const entry = bucket.get(s.source) ?? { source: s.source, total: 0, active: 0 };
      entry.total++;
      if (alive) entry.active++;
      bucket.set(s.source, entry);
    }
  }

  const rankSources = (m: Map<string, SourceCoverage>): SourceCoverage[] =>
    [...m.values()].sort((a, b) => b.active - a.active || b.total - a.total || a.source.localeCompare(b.source));

  const provinces: ProvinceCoverage[] = [...byProvince.entries()]
    .map(([province, sources]) => {
      const list = rankSources(sources);
      return {
        province,
        total: list.reduce((n, s) => n + s.total, 0),
        active: list.reduce((n, s) => n + s.active, 0),
        bySource: list,
      };
    })
    // Busiest province first, and "Sin provincia" last whatever its size: it is
    // a gap in our own data, not a place.
    .sort((a, b) => {
      if (a.province === NO_PROVINCE) return 1;
      if (b.province === NO_PROVINCE) return -1;
      return b.active - a.active || b.total - a.total || a.province.localeCompare(b.province);
    });

  return { provinces, total, active, bySource: rankSources(overall) };
}
