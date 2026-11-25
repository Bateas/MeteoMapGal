// spotScoringEngine is where SpotVerdict is actually declared; types/station
// never exported it, so every Record<SpotVerdict, T> here was keyed by `any`
// and the comparator's order map silently accepted anything at all.
import type { SpotVerdict } from '../services/spotScoringEngine';
import { windTone, WIND_TONE_NAMES, WIND_TONES_ON_DARK, type WindToneName } from '../services/windUtils';

/** The word for each verdict, the same on every surface. Its colours are VERDICT_FILL and VERDICT_LINE. */
export const VERDICT_STYLE: Record<SpotVerdict, { label: string }> = {
  calm: { label: 'Calma' },
  light: { label: 'Flojo' },
  sailing: { label: 'Navegable' },
  good: { label: 'Bueno' },
  strong: { label: 'Fuerte' },
  unknown: { label: 'Sin datos' },
};

/**
 * The map's scale as tokens (v3tokens.css), one value per theme: marker, card, list and forecast read the same five
 * colours. Adjacent steps checked with the palette validator in both themes (normal vision >= 15, colour blindness
 * >= 8): dark 21,4 and 10,5; light 18,2 and 9,1. A tone more colour on 5-nov: the map read as washed out.
 * The shape and the figure inside say it as well: colour never goes alone.
 */
export const VERDICT_FILL: Record<SpotVerdict, string> = {
  calm: 'var(--g-c-calma)', light: 'var(--g-c-flojo)', sailing: 'var(--g-c-navegable)',
  good: 'var(--g-c-bueno)', strong: 'var(--g-c-fuerte)', unknown: 'var(--g-hair)',
};
/** A surf level on the map's scale: flat, small, good, classic, big read like calma, flojo, navegable, bueno, fuerte. */
export function surfTone(level: number): SpotVerdict {
  return (['calm', 'light', 'sailing', 'good', 'strong'] as const)[level] ?? 'unknown';
}
/** Text on VERDICT_FILL. */
export const VERDICT_FILL_TEXT: Record<SpotVerdict, string> = {
  calm: 'var(--g-ct-calma)', light: 'var(--g-ct-flojo)', sailing: 'var(--g-ct-navegable)',
  good: 'var(--g-ct-bueno)', strong: 'var(--g-ct-fuerte)', unknown: 'var(--g-ink)',
};
/** The same scale for a line beside text: >= 3:1 on the background. */
export const VERDICT_LINE: Record<SpotVerdict, string> = {
  calm: 'var(--g-s-calma)', light: 'var(--g-s-flojo)', sailing: 'var(--g-s-navegable)',
  good: 'var(--g-s-bueno)', strong: 'var(--g-s-fuerte)', unknown: 'var(--g-rule)',
};

/** The same scale as plain hex, for what cannot read a token and is drawn dark: the shared image and the widget. */
export const VERDICT_HEX: Record<SpotVerdict, string> = {
  calm: '#a3aca7', light: '#62a8f5', sailing: '#37bd78', good: '#f5b82e', strong: '#ff8a3d', unknown: '#64748b',
};

/**
 * A spot's colour is the greater of its verdict's and its wind's (18-nov). Only a
 * «Fuerte» spot moves: from 22 kt it takes the red, magenta or violet of the arrow beside it. Below, the verdict's
 * colour stands, so a spot «Fuerte» on its gusts with a 14 kt mean stays orange. Null: the verdict's colour.
 */
export function windToneOver(verdict: SpotVerdict, kt: number | null | undefined): WindToneName | null {
  if (verdict !== 'strong' || kt == null || !Number.isFinite(kt)) return null;
  const tone = windTone(kt);
  return tone > 4 ? WIND_TONE_NAMES[tone] : null;
}
export const fillOf = (verdict: SpotVerdict, tone: WindToneName | null) => (tone ? `var(--g-c-${tone})` : VERDICT_FILL[verdict]);
export const fillTextOf = (verdict: SpotVerdict, tone: WindToneName | null) => (tone ? `var(--g-ct-${tone})` : VERDICT_FILL_TEXT[verdict]);
export const lineOf = (verdict: SpotVerdict, tone: WindToneName | null) => (tone ? `var(--g-s-${tone})` : VERDICT_LINE[verdict]);
export const hexOf = (verdict: SpotVerdict, tone: WindToneName | null) => (tone ? WIND_TONES_ON_DARK[WIND_TONE_NAMES.indexOf(tone)] : VERDICT_HEX[verdict]);

/** Short labels for a marker's badge */
export const VERDICT_MAP_LABEL: Record<SpotVerdict, string> = {
  calm: 'CALMA', light: 'FLOJO', sailing: 'NAVEG.', good: 'BUENO', strong: 'FUERTE', unknown: '—',
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
  hardGateKind?: 'wind' | 'wave' | null;
  hardGateTriggered?: string | null;
  gustKt?: number | null;
  waves?: { waveHeight: number | null; sourceBuoy?: string | null; localHeight?: number | null; localSource?: 'swan' | 'estimate' | 'buoy' | null } | null;
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
  if (isWaveGate(score)) return WAVE_GATE_LABEL;
  return VERDICT_STYLE[displayVerdict(score)].label;
}

// ── Wind on a line: say the doubt ────
//
// 44 % of the cycles sit within 1 kt of a verdict line (20-oct to 10-nov), and an anemometer does
// not tell 11 kt from 12. The colour waits for the wind to pass the line by that margin
// (verdictHold.ts); meanwhile the card names both levels. Never from above: a spot shown FUERTE,
// closed by gusts or by the sea, or still loading, states no doubt. The two low lines (6 and 8 kt)
// change nobody's decision, so they speak only when the colour is being held and the figure would
// otherwise contradict the label.

/** kt either side of a line inside which the reading does not tell the two levels apart. */
export const VERDICT_DOUBT_KT = 1.0;

// `windVerdict` rounds, so each line sits half a knot below its integer.
const DOUBT_LINES: { at: number; low: SpotVerdict; high: SpotVerdict; always: boolean }[] = [
  { at: 5.5, low: 'calm', high: 'light', always: false },
  { at: 7.5, low: 'light', high: 'sailing', always: false },
  { at: 11.5, low: 'sailing', high: 'good', always: true },
  { at: 17.5, low: 'good', high: 'strong', always: true },
];

/** The two levels the wind sits between, or null when the verdict is clear. */
export function verdictDoubt(score: VerdictSource | undefined | null): { low: SpotVerdict; high: SpotVerdict } | null {
  if (!score || score.provisional || score.hardGateTriggered || score.hardGateKind) return null;
  const shown = score.verdict;
  if (!shown || shown === 'strong' || shown === 'unknown') return null;
  const kt = displayWindKt(score);
  if (kt == null) return null;
  const line = DOUBT_LINES.find((l) => Math.abs(kt - l.at) < VERDICT_DOUBT_KT);
  if (!line || (shown !== line.low && shown !== line.high)) return null;
  const held = (kt >= line.at ? line.high : line.low) !== shown;
  if (!line.always && !held) return null;
  return { low: line.low, high: line.high };
}

/** «entre Navegable y Bueno», or null. */
export function verdictDoubtText(score: VerdictSource | undefined | null): string | null {
  const d = verdictDoubt(score);
  return d ? `entre ${VERDICT_STYLE[d.low].label} y ${VERDICT_STYLE[d.high].label}` : null;
}

// ── A spot closed by the SEA, not the wind ────
//
// The wave hard gate keeps the verdict 'strong' (orange, last in order, every Record intact) but
// it is not wind: on 21-oct Cíes-Ría read «FUERTE 4kt» on the marker, the ticker, the comparator
// and Telegram because Cabo Silleiro, open ocean 50 km away, had 3 m. Every surface asks here.

export const WAVE_GATE_LABEL = 'Oleaje';

export function isWaveGate(score: VerdictSource | undefined | null): boolean {
  return !!score && !score.provisional && score.hardGateKind === 'wave';
}

/** «3,0 m» for the gate's sea height, or null when the spot is not closed by the sea. */
export function gateWaveText(score: VerdictSource | undefined | null): string | null {
  if (!isWaveGate(score)) return null;
  const h = score!.waves?.localHeight ?? score!.waves?.waveHeight;
  if (h == null) return null;
  const m = `${h.toFixed(1).replace('.', ',')} m`;
  return score!.waves?.localSource === 'estimate' ? `≈${m}` : m;
}

/** Where that sea comes from, as a phrase: «en la zona, según el modelo», «estimada desde Cabo
 *  Silleiro» or «en Cabo Silleiro, mar abierto» (a spot with no local estimate). */
export function gateWaveWhere(score: VerdictSource | undefined | null): string | null {
  if (!isWaveGate(score)) return null;
  const w = score!.waves;
  const buoy = w?.sourceBuoy;
  if (w?.localSource === 'swan') return 'en la zona, según el modelo';
  if (w?.localSource === 'estimate') return buoy ? `estimada desde ${buoy}` : 'estimada';
  return buoy ? `en ${buoy}, mar abierto` : 'mar abierto';
}

/** The figure a surface prints beside the label: the sea height for a wave gate, the wind
 *  otherwise («3,0 m» / «12kt»), or null when there is nothing firm to print. */
export function verdictFigure(score: VerdictSource | undefined | null): string | null {
  const wave = gateWaveText(score);
  if (wave) return wave;
  const kt = displayWindKt(score);
  return kt != null ? `${Math.round(kt)}kt` : null;
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

// ── A light mean with strong gusts: say so ────
//
// The verdict comes from the mean, and the gust gate only closes a spot at 30 kt backed by 25. In
// between, a card read «Calma, 5 kt» beside «racha 21» as if the two were one thing (24-nov: Liméns
// and Lourido through a front; Castrelo on 17-nov with white water). Over 30 days, 9-19 h, a gust of
// 18 kt and twice the mean under «Calma» or «Flojo» happened in 279 ten-minute steps across eleven
// spots, nearly all on the frontal days; at 15 kt it was 497 and showed one day in three.

/** The gust that makes a light mean «racheado», and how many times the mean it has to be. */
export const GUSTY_MIN_KT = 18;
export const GUSTY_RATIO = 2;
export const GUSTY_LABEL = 'racheado';

/** Whether a spot shown «Calma» or «Flojo» carries gusts worth a word. `gustKt` is the gust the
 *  surface shows, when it differs from the measured one. Never while loading or closed by a gate. */
export function isGusty(score: VerdictSource | undefined | null, gustKt: number | null | undefined = score?.gustKt): boolean {
  if (!score || score.provisional || score.hardGateTriggered || score.hardGateKind) return false;
  if (score.verdict !== 'calm' && score.verdict !== 'light') return false;
  const kt = displayWindKt(score);
  if (kt == null || gustKt == null) return false;
  return Math.round(gustKt) >= GUSTY_MIN_KT && gustKt >= GUSTY_RATIO * kt;
}

// ── Wind direction: "variable" when the sources disagree ────
//
// The consensus direction is a weighted mean, and a mean of directions pointing every which
// way is a number with no meaning behind it: on 25-Sep the app said "N" at Lourido while its
// sources were split between NE and W. The engine now reports how well they agree
// (dirSteadiness, the length of the weighted mean vector), and below this threshold every
// surface says "variable" and draws no arrow.

/** Below this agreement the sources' mean direction is noise (angular spread over ~70°).
 *  Replayed over 25-Sep it caught one spot-hour in nine, nearly all during the midday turn
 *  from the NE morning to the W afternoon, when some stations had veered and others not. */
export const DIR_VARIABLE_BELOW = 0.5;

/** Minimal shape needed, structural like VerdictSource. */
export interface DirSource {
  wind?: { dominantDir?: string; dirDeg?: number; dirSteadiness?: number | null } | null;
}

/** True when the sources disagree too much to state a direction. */
export function isDirVariable(wind: DirSource['wind']): boolean {
  return wind?.dirSteadiness != null && wind.dirSteadiness < DIR_VARIABLE_BELOW;
}

/** The direction a surface should state: 'variable' with no arrow when the sources disagree,
 *  otherwise the 8-point name and the degrees for the arrow. Null with no wind at all. */
export function displayWindDir(score: DirSource | undefined | null): { label: string; deg: number | null } | null {
  const w = score?.wind;
  if (!w || w.dominantDir == null) return null;
  if (isDirVariable(w)) return { label: 'variable', deg: null };
  return { label: w.dominantDir, deg: w.dirDeg ?? null };
}
