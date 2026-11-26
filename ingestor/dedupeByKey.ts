/**
 * One row per key, the last one winning, in the order the keys first appeared. Pure.
 *
 * Why (F-03 of the 26-nov-2026 audit): Open-Meteo answers times without a zone ("2027-03-28T02:00")
 * and `new Date()` reads them in the server's local time. On the night the clocks go forward
 * (28-mar-2027) the 02:00 and 03:00 hours both land on 01:00Z, and a multi-row
 * `INSERT ... ON CONFLICT DO UPDATE` that carries the same key twice fails whole («cannot affect row
 * a second time»): every cycle would lose all its rows for a day and a half. Removing the duplicate
 * avoids that without moving any hour, so the data the champion model already reads stay the same.
 * Fixing the hour itself is a separate change, to be made together with a model retraining.
 */
export function dedupeByKey<T>(rows: T[], keyOf: (row: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const r of rows) byKey.set(keyOf(r), r);
  return byKey.size === rows.length ? rows : [...byKey.values()];
}
