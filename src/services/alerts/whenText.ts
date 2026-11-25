/**
 * Day and hour in words for the conditions list and the alerts: a warning for tomorrow must not read
 * as if it were for today. Pure and in local time, like the rest of the panel.
 */

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** «hoy», «mañana» or «el jue 6». */
export function dayWord(d: Date, now: Date = new Date()): string {
  if (sameDay(d, now)) return 'hoy';
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (sameDay(d, tomorrow)) return 'mañana';
  const weekday = d.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '');
  return `el ${weekday} ${d.getDate()}`;
}

/**
 * When a warning applies, with day and hour:
 * «hoy de 12 a 20 h», «hasta las 20 h», «hasta mañana a las 8 h», «el jue 6 de 6 a 14 h»,
 * «desde hoy a las 22 h hasta mañana a las 8 h».
 */
export function spanWords(from: Date, to: Date, now: Date = new Date()): string {
  const started = from.getTime() <= now.getTime();
  const fromH = from.getHours();
  const toH = to.getHours();
  if (started) {
    return sameDay(to, now) ? `hasta las ${toH} h` : `hasta ${dayWord(to, now)} a las ${toH} h`;
  }
  if (sameDay(from, to)) return `${dayWord(from, now)} de ${fromH} a ${toH} h`;
  return `desde ${dayWord(from, now)} a las ${fromH} h hasta ${dayWord(to, now)} a las ${toH} h`;
}
