/**
 * Keeps a spot's verdict from flickering on the map.
 *
 * Measured 8-oct (spot_scores, 58 cycles of 5 min): Cies changed verdict 16 times, Lourido 15,
 * centro-ria 14, almost always with 1-2 kt between cycles, because the wind sat on the 12 kt
 * line (NAVEGABLE / BUENO) and the consensus moves about 1 kt from one cycle to the next.
 *
 * Rule: a change to the next level up or down waits until the new verdict has lasted
 * VERDICT_HOLD_MS, unless the wind is clearly past the line (the caller says so). Every other
 * change is immediate: going UP to strong (danger lives there), unknown (no data / cold load)
 * and any jump of two levels or more. Coming DOWN from strong to good waits like any other
 * adjacent change (17-18 kt flickered too): it keeps the warning colour a little longer, never
 * delays one. A state not refreshed for HOLD_STATE_TTL_MS (tab asleep, sector switch) counts as
 * no state, so a stale verdict is never kept. A change of CONTEXT is not noise: the map clears
 * the states when `holdContextKey` changes, and the engine drops the state of a provisional
 * score (a verdict nobody saw is no reference).
 *
 * Only the map passes this state to the engine. The server (Telegram alerts, spot_scores)
 * keeps the raw verdict, so the record and the alerts do not change.
 */
import type { SpotVerdict } from './spotScoringEngine';
import { assessSynopticRegime, type UpperWind } from './synopticRegime';

export const VERDICT_HOLD_MS = 8 * 60_000;
export const HOLD_STATE_TTL_MS = 20 * 60_000;
/** kt past the line that count as a real change, not noise around it. `windVerdict` rounds, so
 *  the line itself sits half a knot below the integer (BUENO from 11.5): with 1.0 a held colour
 *  reads at most «NAVEG. 12kt» going up and «BUENO 11kt» going down, as the guide says; with
 *  1.5 it could read «NAVEG. 13kt». */
export const VERDICT_CLEAR_MARGIN_KT = 1.0;

export interface VerdictHoldState {
  shown: SpotVerdict;
  /** The verdict waiting to be shown, and since when it has been seen without a break. */
  pending: SpotVerdict | null;
  pendingSince: number;
  seenAt: number;
}

const RANK: Record<SpotVerdict, number> = { calm: 0, light: 1, sailing: 2, good: 3, strong: 4, unknown: -1 };

export function verdictRank(v: SpotVerdict): number {
  return RANK[v];
}

/**
 * The verdict to show now and the state to keep. `clearlyRaw` = the wind is far enough past
 * the line between the shown verdict and `raw` that this is a real change.
 */
export function settleVerdict(
  prev: VerdictHoldState | undefined,
  raw: SpotVerdict,
  nowMs: number,
  clearlyRaw: boolean,
): { shown: SpotVerdict; state: VerdictHoldState } {
  const show = (v: SpotVerdict) => ({ shown: v, state: { shown: v, pending: null, pendingSince: nowMs, seenAt: nowMs } });
  if (!prev || nowMs - prev.seenAt > HOLD_STATE_TTL_MS) return show(raw);
  if (raw === prev.shown) return show(raw);
  if (raw === 'strong' || raw === 'unknown' || prev.shown === 'unknown') return show(raw);
  if (Math.abs(RANK[raw] - RANK[prev.shown]) >= 2 || clearlyRaw) return show(raw);
  if (prev.pending === raw) {
    if (nowMs - prev.pendingSince >= VERDICT_HOLD_MS) return show(raw);
    return { shown: prev.shown, state: { ...prev, seenAt: nowMs } };
  }
  return { shown: prev.shown, state: { shown: prev.shown, pending: raw, pendingSince: nowMs, seenAt: nowMs } };
}

/**
 * What the verdicts were computed WITH: when it changes, the next verdict is a new reading of the
 * wind, not noise on a line, and shows at once. The buoys arriving (a ría scored without them reads
 * low), the veto aloft switching on or off (it removes or allows the breeze boosts), and the Embalse
 * thermal context appearing.
 */
export function holdContextKey(ctx: { buoysPending: boolean; upperWind: UpperWind | null | undefined; thermalReady: boolean }): string {
  const regime = ctx.upperWind
    ? [assessSynopticRegime(ctx.upperWind, { coastal: true }), assessSynopticRegime(ctx.upperWind)]
      .map((r) => (r?.vetoed ? r.kind ?? 'veto' : 'ok')).join(',')
    : 'nodata';
  return [ctx.buoysPending ? 'buoys-pending' : 'buoys', regime, ctx.thermalReady ? 'thermal' : 'no-thermal'].join('|');
}
