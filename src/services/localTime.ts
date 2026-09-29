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
