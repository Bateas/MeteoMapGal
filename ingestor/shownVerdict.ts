/**
 * What the map SHOWS for each spot, recorded next to the raw verdict.
 *
 * The map does not follow the raw verdict cycle by cycle: a change to the next level waits until
 * the wind is 1 kt past the line (src/services/verdictHold.ts), and on a line the card names both
 * levels (verdictDoubt in src/config/verdictStyles.ts). Until 10-nov that shown state lived only in
 * the browser, so the flicker a user sees could only be estimated by replaying spot_scores. Here the
 * server applies the SAME rule to the engine's score, with the state kept in memory per spot, and
 * spot_scores keeps it in shown_verdict and doubt.
 *
 * Nothing else reads it: the raw verdict, the alerts and Telegram do not change.
 *
 * Known differences from a real browser, on purpose: the map keeps a spot closed by gusts for 15 min
 * after the last gust reading and clears every state when its context changes (the buoys arrive, the
 * veto aloft switches); the server sees neither, and its state starts empty at every restart.
 */
import { isClearlyPastLine, type SpotScore, type SpotVerdict } from '../src/services/spotScoringEngine.js';
import { settleVerdict, type VerdictHoldState } from '../src/services/verdictHold.js';
import { verdictDoubt } from '../src/config/verdictStyles.js';

export interface ShownVerdict {
  /** As the marker would colour it: 'unknown' while provisional. */
  verdict: SpotVerdict;
  /** 'sailing-good' when the card would say «entre Navegable y Buen día», else null. */
  doubt: string | null;
}

/** The shown verdict of one engine score, updating that spot's state. Pure given `states`. */
export function settleShown(score: SpotScore, nowMs: number, states: Map<string, VerdictHoldState>): ShownVerdict {
  const id = score.spotId;
  // A verdict nobody saw is no reference (the engine drops the state of a provisional score too).
  if (score.provisional) {
    states.delete(id);
    return { verdict: 'unknown', doubt: null };
  }
  const raw = score.verdict;
  const kt = score.effectiveWindKt ?? score.wind?.avgSpeedKt ?? null;
  // Danger gates and «no wind» never wait: shown at once, and they become the reference.
  if (score.hardGateTriggered !== null || raw === 'unknown' || kt == null) {
    states.set(id, settleVerdict(undefined, raw, nowMs, true).state);
    return { verdict: raw, doubt: null };
  }
  const prev = states.get(id);
  const out = settleVerdict(prev, raw, nowMs, isClearlyPastLine(prev?.shown, raw, kt, id));
  states.set(id, out.state);
  const d = verdictDoubt({ ...score, verdict: out.shown });
  return { verdict: out.shown, doubt: d ? `${d.low}-${d.high}` : null };
}

const liveStates = new Map<string, VerdictHoldState>();

/** One call per analysis cycle: the shown verdict of every scored spot. */
export function shownVerdicts(scores: Map<string, SpotScore>, nowMs = Date.now()): Map<string, ShownVerdict> {
  const out = new Map<string, ShownVerdict>();
  for (const [id, score] of scores) out.set(id, settleShown(score, nowMs, liveStates));
  return out;
}

/** «shown: 3 mantenidos, 5 en duda de 12» for the cycle heartbeat. */
export function describeShown(shown: Map<string, ShownVerdict>, scores: Map<string, SpotScore>): string {
  let held = 0;
  let doubt = 0;
  for (const [id, s] of shown) {
    const raw = scores.get(id);
    if (raw && !raw.provisional && s.verdict !== raw.verdict) held++;
    if (s.doubt) doubt++;
  }
  return `${held} con el color mantenido, ${doubt} en duda de ${shown.size}`;
}
