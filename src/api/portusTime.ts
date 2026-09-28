/**
 * PORTUS (Puertos del Estado) sends `fecha` as a UTC wall-clock time with no
 * zone: "2026-09-27 16:28:00.0" is 16:28 UTC, answered at 16:28:05 UTC.
 *
 * Read as a local time — `new Date(fecha)` on a Spanish machine, or the bare
 * string inserted into a Postgres session in Europe/Madrid — every reading
 * landed 2 h early in summer (1 h in winter). That is where "PORTUS arrives
 * 2 h late" came from: the data is real-time, the parsing was not. The
 * freshness gates then discarded fresh buoys as stale, and the meteorological
 * tide compared the gauge with the astronomical tide of another hour.
 *
 * ONE parser for the ingestor and the map. Returns an ISO string with its
 * zone ("...Z"), which Postgres and every browser read the same way.
 */

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?$/;
const HAS_ZONE = /(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/;

export function portusFechaToIso(fecha: string | null | undefined): string | null {
  if (!fecha) return null;
  const s = fecha.trim();
  // If PORTUS ever starts sending a zone, trust it instead of assuming UTC.
  if (HAS_ZONE.test(s)) {
    const t = Date.parse(s.replace(' ', 'T'));
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  const m = WALL_CLOCK.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec = '0', frac = '0'] = m;
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec, +frac.padEnd(3, '0'));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
