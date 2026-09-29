/**
 * A discovery that fails must not empty a network for an hour.
 *
 * Each source's discovery catches its own error and returns no stations, and the hourly
 * rediscovery used to take the new list as it came. So a network blip at the minute of the
 * rediscovery dropped that source until the next one, an hour later: at 04:04 on 29-sep every
 * request failed for a few seconds, and MeteoGalicia, Wunderground, AEMET and IPMA read zero
 * stations from 04:09 to 05:04. The logs hold at least eleven such hours, each starting five
 * minutes after a failed MeteoGalicia discovery.
 *
 * Now a source that comes back with nothing keeps the stations it had, for up to
 * DISCOVERY_CARRY_MAX_MS after its last good discovery; past that, an empty source is taken as
 * really empty. A source that does answer is taken as it comes, so a station it stops listing is
 * dropped as before. Only whole sources are carried: a partial answer (a few Wunderground areas
 * failing) is not detected here.
 */
import type { NormalizedStation } from '../src/types/station.js';

export const DISCOVERY_CARRY_MAX_MS = 24 * 60 * 60_000;

export interface DiscoveryMerge {
  /** The stations to poll: the new discovery, plus the sources that came back empty. */
  stations: Map<string, NormalizedStation>;
  /** Sources kept from the previous list, with how many stations each. */
  carried: { source: string; count: number }[];
  /** Last good discovery per source, to pass to the next call. */
  lastGoodAt: Map<string, number>;
}

export function carryOverEmptySources(
  prev: ReadonlyMap<string, NormalizedStation>,
  next: ReadonlyMap<string, NormalizedStation>,
  lastGoodAt: ReadonlyMap<string, number>,
  nowMs: number,
): DiscoveryMerge {
  const good = new Map(lastGoodAt);
  const answered = new Set<string>();
  for (const st of next.values()) answered.add(st.source);
  for (const source of answered) good.set(source, nowMs);

  const stations = new Map(next);
  const counts = new Map<string, number>();
  for (const st of prev.values()) {
    if (answered.has(st.source)) continue;
    const since = good.get(st.source);
    if (since == null || nowMs - since > DISCOVERY_CARRY_MAX_MS) continue;
    stations.set(st.id, st);
    counts.set(st.source, (counts.get(st.source) ?? 0) + 1);
  }
  return {
    stations,
    carried: [...counts.entries()].map(([source, count]) => ({ source, count })),
    lastGoodAt: good,
  };
}
