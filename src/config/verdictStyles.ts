import type { SpotVerdict } from '../types/station';

/** Verdict → Tailwind classes + label. Shared across SpotSelector, ConditionsTicker, MobileSailingBanner. */
/**
 * Verdict visual styles — aligned with simplified windSpeedColor() scale.
 * Calma=slate, Flojo=sky-blue, Navegable=green, Buen día=yellow, Fuerte=orange.
 */
export const VERDICT_STYLE: Record<SpotVerdict, { label: string; bg: string; border: string; text: string; dot: string }> = {
  calm:    { label: 'Calma',     bg: 'bg-slate-500/10',   border: 'border-slate-500/40',   text: 'text-slate-400',   dot: 'bg-slate-400' },
  light:   { label: 'Flojo',     bg: 'bg-sky-500/10',     border: 'border-sky-500/40',     text: 'text-sky-400',     dot: 'bg-sky-400' },
  sailing: { label: 'Navegable', bg: 'bg-green-500/10',   border: 'border-green-500/40',   text: 'text-green-400',   dot: 'bg-green-400' },
  good:    { label: 'Buen d\u00eda',  bg: 'bg-yellow-500/10', border: 'border-yellow-500/40', text: 'text-yellow-400', dot: 'bg-yellow-400' },
  strong:  { label: 'Fuerte',    bg: 'bg-orange-500/10',  border: 'border-orange-500/40',  text: 'text-orange-400',  dot: 'bg-orange-400' },
  unknown: { label: 'Sin datos', bg: 'bg-slate-500/10',   border: 'border-slate-500/40',   text: 'text-slate-400',   dot: 'bg-slate-400' },
};

/** Verdict hex colors for inline styles. Matches simplified windSpeedColor() scale. */
export const VERDICT_HEX: Record<SpotVerdict, string> = {
  calm: '#94a3b8', light: '#38bdf8', sailing: '#22c55e',
  good: '#eab308', strong: '#f97316', unknown: '#64748b',
};

// ── Provisional scores: one place, so every surface agrees ────
//
// A spot's verdict can be marked provisional during cold load — the engine has
// stations but is still missing inputs that move the answer (a buoy's water
// temperature, radiation, mouth humidity). The verdict at that moment is not
// wrong so much as not ready, and stating it in firm is how the app ends up
// saying two different things about the same spot in the same second: the
// ticker reading "BUENO 12kt" next to a marker reading "calculando".
//
// SpotMarker got this right on its own and everything else was left to
// remember. Six surfaces did not — ticker, sidebar list, comparator, mobile
// banner, user spots and the shared image, which is the worst of them because
// its artefact leaves the phone with the bad number and keeps circulating long
// after the app has corrected itself.
//
// So the decision lives here rather than in each caller. Note this reuses the
// existing 'unknown' verdict rather than adding a value to SpotVerdict: that
// keeps every Record<SpotVerdict, T> in the codebase complete, including the
// comparator's sort order, where a missing key would have sunk provisional
// spots to the bottom of the list in silence.

/** What a provisional score is called. Not "sin datos" — there are data, they
 *  are simply not enough yet, and the distinction matters to whoever is
 *  deciding whether to drive to the water. */
export const PROVISIONAL_LABEL = 'Calculando…';

/** Minimal shape needed to decide. Kept structural so callers can pass a
 *  SpotScore, a partial, or undefined without importing the engine's types. */
export interface VerdictSource {
  verdict?: SpotVerdict;
  provisional?: boolean;
  effectiveWindKt?: number | null;
  wind?: { avgSpeedKt: number } | null;
}

/** The verdict a surface should RENDER. Provisional collapses to the neutral
 *  'unknown' so colours, ordering and styles all keep working untouched. */
export function displayVerdict(score: VerdictSource | undefined | null): SpotVerdict {
  if (!score) return 'unknown';
  return score.provisional ? 'unknown' : (score.verdict ?? 'unknown');
}

/** The text to show beside it. */
export function verdictLabel(score: VerdictSource | undefined | null): string {
  if (score?.provisional) return PROVISIONAL_LABEL;
  return VERDICT_STYLE[displayVerdict(score)].label;
}

/**
 * The wind figure a surface should show, or null when it should show none.
 *
 * Two rules in one call, because they were being got wrong separately. Null
 * while provisional — a number printed then is the raw consensus before the
 * detectors have spoken, and it moves once they do. And the CALIBRATED value
 * otherwise: several surfaces read `wind.avgSpeedKt` directly and so displayed
 * the station's reading under a verdict computed from the boosted one, which is
 * how a sidebar badge came to say "BUENO 6kt" when 'good' starts at 12.
 */
export function displayWindKt(score: VerdictSource | undefined | null): number | null {
  if (!score || score.provisional) return null;
  return score.effectiveWindKt ?? score.wind?.avgSpeedKt ?? null;
}
