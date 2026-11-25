/**
 * The order of the Estaciones tab. A station that stopped sending hours ago with a lot of wind must
 * not come first, and neither must one whose anemometer the map already sets aside: those go last
 * in the wind order. Ties and the end of the list go by name, so rows do not swap at random.
 */
import type { NormalizedReading, NormalizedStation } from '../types/station';
import { ageMinutes, dataAge } from './dataAge';

export type StationSortMode = 'wind' | 'temp' | 'name';

export function sortStations(
  stations: readonly NormalizedStation[],
  readings: ReadonlyMap<string, NormalizedReading>,
  mode: StationSortMode,
  nowMs: number,
  windSetAside: (stationId: string) => boolean,
): NormalizedStation[] {
  const byName = (a: NormalizedStation, b: NormalizedStation) => a.name.localeCompare(b.name, 'es');
  if (mode === 'name') return [...stations].sort(byName);

  /** The figure this order goes by, or null when it does not count. */
  const figure = (s: NormalizedStation): number | null => {
    const r = readings.get(s.id);
    if (!r || dataAge(ageMinutes(r.timestamp, nowMs)) === 'gone') return null;
    if (mode === 'temp') return r.temperature;
    return windSetAside(s.id) ? null : r.windSpeed;
  };

  return [...stations].sort((a, b) => {
    const fa = figure(a);
    const fb = figure(b);
    if (fa == null && fb == null) return byName(a, b);
    if (fa == null) return 1;
    if (fb == null) return -1;
    return fb - fa || byName(a, b);
  });
}
