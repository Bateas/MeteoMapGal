/**
 * The hour of the day in Galicia, whatever the clock of the machine running the code: the
 * browser of a visitor abroad, a test runner in UTC, the server. Everything that reasons about
 * «mañanas» or «tardes» asks here.
 */
export function madridHour(at: Date | number): number {
  // Europe/Madrid switches between CET and CEST, so ask Intl instead of adding an offset.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(typeof at === 'number' ? new Date(at) : at);
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  // Some Node versions write midnight as "24".
  return h === 24 ? 0 : h;
}

/** Offset of Madrid's wall clock from UTC at an instant (+2 h in summer, +1 h in winter). */
function madridOffsetMs(atMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(atMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return wall - Math.floor(atMs / 1000) * 1000;
}

/**
 * A Madrid wall-clock time as text ("2026-10-12 23:00", seconds optional, "T" also accepted) to
 * UTC milliseconds, or NaN if it does not parse. For providers that publish local time with no
 * offset (MeteoGalicia's air-quality JSON). The offset is checked again at the result, so the
 * days the clocks change land on the right side.
 */
export function parseMadridWallTime(text: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text?.trim() ?? '');
  if (!m) return NaN;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  const first = guess - madridOffsetMs(guess);
  return guess - madridOffsetMs(first);
}
