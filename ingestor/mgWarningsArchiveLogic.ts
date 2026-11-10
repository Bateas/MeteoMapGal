/**
 * Rows of the official-warnings archive (pure; the requests live in mgWarningsArchive.ts).
 *
 * The feed only says what is in force or announced NOW. To judge a detector against «there was an
 * orange wind warning from 14 to 20 h» afterwards, each warning has to be kept while it is visible:
 * one row per type, zone, level and time span, with the first and the last time the feed showed it.
 * A warning that is extended or raised appears as a new row; the old one stops being seen.
 */
import type { MGWarning } from '../src/api/mgWarningsClient.js';

export interface WarningRow {
  type: string;
  typeId: number;
  zone: string;
  zoneId: number;
  level: number;
  start: Date;
  end: Date;
  comment: string | null;
  publishedAt: Date | null;
}

/** Feed times are whole minutes of Galicia's clock. The parser answers «now» for a date it cannot
 *  read, and that would make a new row at every pass: anything with seconds is not a feed time. */
const wholeMinute = (d: Date): boolean => Number.isFinite(d.getTime()) && d.getTime() % 60_000 === 0;

const keyOf = (r: WarningRow): string => [r.typeId, r.zoneId, r.level, r.start.getTime(), r.end.getTime()].join('|');

/** Every zone and span of every warning, once. Spans the feed wrote badly are left out and counted. */
export function warningRows(warnings: MGWarning[]): { rows: WarningRow[]; skipped: number } {
  const seen = new Map<string, WarningRow>();
  let skipped = 0;
  for (const w of warnings) {
    for (const z of w.zones) {
      if (!wholeMinute(z.startTime) || !wholeMinute(z.endTime) || z.endTime.getTime() <= z.startTime.getTime()
        || !Number.isInteger(z.level) || z.level < 1 || z.level > 3) {
        skipped++;
        continue;
      }
      const row: WarningRow = {
        type: w.type, typeId: w.typeId, zone: z.name.trim(), zoneId: z.id, level: z.level,
        start: z.startTime, end: z.endTime,
        comment: z.comment ? z.comment.slice(0, 2000) : null,
        publishedAt: Number.isFinite(w.publishedAt.getTime()) ? w.publishedAt : null,
      };
      seen.set(keyOf(row), row);
    }
  }
  return { rows: [...seen.values()], skipped };
}

export const WARNING_COLS = 10;

/** Placeholders and values for one INSERT (the column order of mgWarningsArchive.ts). */
export function warningInsertParts(rows: WarningRow[], seenAt: Date): { tuples: string[]; values: unknown[] } {
  const tuples: string[] = [];
  const values: unknown[] = [];
  rows.forEach((r, i) => {
    const o = i * WARNING_COLS;
    tuples.push(`(${Array.from({ length: WARNING_COLS }, (_, k) => `$${o + k + 1}`).join(',')})`);
    values.push(r.typeId, r.zoneId, r.level, r.start, r.end, r.type, r.zone, r.comment, r.publishedAt, seenAt);
  });
  return { tuples, values };
}

/** «2 naranja, 5 amarillo» for the log. */
export function describeLevels(rows: WarningRow[]): string {
  const n = (l: number) => rows.filter((r) => r.level === l).length;
  const parts = [[3, 'rojo'], [2, 'naranja'], [1, 'amarillo']] as const;
  return parts.filter(([l]) => n(l) > 0).map(([l, name]) => `${n(l)} ${name}`).join(', ') || 'ninguno';
}
