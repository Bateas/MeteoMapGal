/**
 * Shadow record of what the map says (pure part). The map computes fog, cross sea, pressure
 * trend, frost, rain now, beach day and sea breeze in the browser and none of it leaves a
 * trace, so none of it can be examined afterwards. The server runs the same pure functions and
 * stores the answer ONLY when it changes, plus one «still the same» row every six hours so a
 * silent table can be told apart from a stopped writer.
 *
 * Nothing here is sent to anybody or changes what a visitor sees.
 */

/** One answer of one solution for one place. */
export interface ShadowClaim {
  /** alert_log.alert_type, always starting with `shadow-` */
  type: string;
  /** Sector id */
  sector: string;
  /** Spot id when the answer is per spot; absent when it is for the sector */
  subject?: string;
  /** The state the map would show ('none', 'riesgo', 'raining', 'great'...). A change of it is a row. */
  state: string;
  /** 0-100 when the solution gives one */
  score: number | null;
  /** The inputs that decided it */
  params: Record<string, unknown>;
  /** The sentence the map would print, when there is one */
  hypothesis: string | null;
}

export type ShadowReason = 'inicio' | 'cambio' | 'sigue';

/** What goes to alert_log. `time` is put by the database. */
export interface ShadowRow {
  alertType: string;
  sector: string;
  level: string;
  score: number | null;
  params: Record<string, unknown>;
  hypothesis: string | null;
}

export interface SeenState { state: string; writtenAt: number }

/** A «still the same» row at most this often. */
export const SHADOW_KEEPALIVE_MS = 6 * 60 * 60_000;

export function claimKey(c: { type: string; sector: string; subject?: string | null }): string {
  return `${c.type}|${c.sector}|${c.subject ?? ''}`;
}

/** Numbers to two decimals and dates to ISO, so the stored inputs stay small and readable. */
export function tidyParams(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue;
    if (typeof v === 'number') out[k] = Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
    else if (v instanceof Date) out[k] = Number.isFinite(v.getTime()) ? v.toISOString() : null;
    else out[k] = v;
  }
  return out;
}

export function toRow(c: ShadowClaim, reason: ShadowReason, prev: string | null): ShadowRow {
  return {
    alertType: c.type,
    sector: c.sector,
    level: c.state,
    score: c.score == null || !Number.isFinite(c.score) ? null : Math.round(c.score * 100) / 100,
    params: { ...(c.subject ? { subject: c.subject } : {}), reason, prev, ...tidyParams(c.params) },
    hypothesis: c.hypothesis,
  };
}

/**
 * Which claims become rows now. `seen` is NOT modified: the caller marks a key as written
 * (markWritten) only after its insert went through, so a failed insert is tried again.
 */
export function decideWrites(
  claims: ShadowClaim[],
  seen: ReadonlyMap<string, SeenState>,
  nowMs: number,
  keepAliveMs: number = SHADOW_KEEPALIVE_MS,
): { rows: { key: string; row: ShadowRow }[]; changes: number } {
  const rows: { key: string; row: ShadowRow }[] = [];
  let changes = 0;
  const done = new Set<string>();
  for (const c of claims) {
    const key = claimKey(c);
    if (done.has(key)) continue;            // one answer per key and cycle
    done.add(key);
    const prev = seen.get(key);
    if (!prev) {
      rows.push({ key, row: toRow(c, 'inicio', null) });
    } else if (prev.state !== c.state) {
      changes++;
      rows.push({ key, row: toRow(c, 'cambio', prev.state) });
    } else if (nowMs - prev.writtenAt >= keepAliveMs) {
      rows.push({ key, row: toRow(c, 'sigue', prev.state) });
    }
  }
  return { rows, changes };
}

export function markWritten(seen: Map<string, SeenState>, key: string, state: string, nowMs: number): void {
  seen.set(key, { state, writtenAt: nowMs });
}

/** Rows read back from alert_log after a restart → the memory of what was last written. */
export function seenFromRows(
  rows: { alert_type: string; sector: string; level: string; subject: string | null; time: Date | string }[],
): Map<string, SeenState> {
  const seen = new Map<string, SeenState>();
  for (const r of rows) {
    const key = claimKey({ type: r.alert_type, sector: r.sector, subject: r.subject });
    const t = new Date(r.time).getTime();
    const had = seen.get(key);
    if (!had || t > had.writtenAt) seen.set(key, { state: r.level, writtenAt: t });
  }
  return seen;
}

/** The heartbeat line. */
export function describeCycle(solutions: number, claims: number, changes: number, written: number, skipped: string[]): string {
  const tail = skipped.length > 0 ? ` (sin dato: ${skipped.join(', ')})` : '';
  return `[Sombra] ${solutions} soluciones, ${claims} estados, ${changes} cambios, ${written} filas${tail}`;
}
