/**
 * Sport-threshold reading of an ORANGE marine warning.
 *
 * An orange warning is read on the street as a binary "do not go out". It is
 * not: the Xunta rule in force since 2026-06-01 keeps sport practice (surf and
 * similar) outside the general ban while wave height stays at or below 4 m and
 * wind at or below 47 kt. That turns the warning into a numeric threshold, and
 * the numbers are already on screen — nobody puts them next to the warning.
 *
 * SCOPE — this module INFORMS, it never AUTHORISES:
 *   - It states the warning, states the published threshold, states the two
 *     current values. Nothing else.
 *   - It never emits a verdict, a permission, a green light or an imperative.
 *     Below the threshold there is NO positive statement at all (silence is the
 *     safe default); above it we say "por encima del umbral", never "prohibido".
 *   - Missing wave or wind => no numbers at all. An estimate here would be an
 *     invented input to a safety decision.
 *   - RED (level 3) => the exception does not apply. We say exactly that, with
 *     no threshold and no numbers, so the orange framing can never leak into a
 *     red situation (an orange wave warning can coexist with a red wind one).
 *
 * Pure module: no stores, no fetches, no React. All user-facing text is built
 * here so it can be asserted in tests (see the no-authorisation guardrail).
 */

import {
  classifyWarningType,
  type MGWarning,
  type MGWarningZone,
} from '../api/mgWarningsClient';
import { isCoastalSector } from '../config/sectors';

// ── Published thresholds ─────────────────────────────────
//
// Source: Xunta de Galicia rule in force since 2026-06-01 — sport practice is
// kept outside the orange-warning restriction while BOTH values stay at or
// below these limits. We do not invent them and we do not tune them: if the
// rule changes, only these two constants (and the source line) move.

/** Wave height ceiling of the sport exception, in metres. */
export const SPORT_WAVE_LIMIT_M = 4;
/** Wind speed ceiling of the sport exception, in knots. */
export const SPORT_WIND_LIMIT_KT = 47;

/** Visible attribution — the threshold is not ours. */
export const SPORT_RULE_SOURCE = 'Umbral de la norma de la Xunta vigente desde el 1 de junio de 2026';

// ── Types ────────────────────────────────────────────────

export type SportComparison = 'below' | 'above' | 'unknown';

export interface SportWarningNotice {
  /** Warning level driving the notice: 2 = naranja, 3 = rojo */
  level: 2 | 3;
  /** False on red — the sport exception is orange-only */
  exceptionApplies: boolean;
  /** Raw MG warning type ("Ondas", "Vento"...) */
  warningType: string;
  /** MG zone the level comes from */
  zoneName: string;
  /** End of the zone time window, when published */
  endTime: Date | null;
  /** Link to the official MG warning page */
  link: string;

  /** "Aviso naranja por oleaje" */
  headline: string;
  /** Published threshold. Null on red (it does not apply there). */
  thresholdText: string | null;
  /** Current readings. Null when a value is missing or on red. */
  currentText: string | null;
  /**
   * Only when something must be said beyond the facts: values above the
   * threshold, missing data, or the red exclusion. Null below the threshold —
   * we do not comment on a situation that needs no comment.
   */
  statusText: string | null;
  /** Attribution line */
  sourceText: string;

  /**
   * Which threshold is the one that actually decides anything HERE.
   *
   * The 4m figure is an open-coast wave. Inside a ría it is never reached —
   * Cesantes or Rande do not see 4m in a storm — so quoting it there compares
   * against something that cannot happen and buries the number that does
   * matter, which is the wind. Derived from how close each reading sits to its
   * own limit, so a sheltered spot naturally lands on 'viento' and an exposed
   * beach on 'ola', with no extra configuration.
   */
  binding: 'ola' | 'viento' | null;
  /** Plain sentence naming that threshold. Null when a value is missing. */
  bindingText: string | null;

  comparison: SportComparison;
  /** Which magnitudes sit above the threshold */
  exceeded: Array<'ola' | 'viento'>;
  waveHeightM: number | null;
  windKt: number | null;
}

export interface SportWarningParams {
  /** Warnings already filtered for the sector (getWarningsForSector) */
  warnings: MGWarning[];
  /** Active sector id — the notice is marine, coastal sectors only */
  sectorId: string;
  /**
   * Wave height AT THE SPOT, in metres — already through the spot's own
   * exposure factor. NEVER pass an open-sea or zone-wide wave: the 4m limit
   * is an open-coast figure, so feeding a sheltered inner-ria spot the swell
   * measured outside would compare it against water that never reaches it.
   */
  waveHeightM?: number | null;
  windKt?: number | null;
  /** Injectable clock for tests */
  now?: Date;
}

// ── Warning selection ────────────────────────────────────

/**
 * MG types that are marine enough for the sport rule. Heat or snow warnings
 * share the colour but not the subject, and would make the threshold line a
 * non sequitur.
 */
const EXTRA_MARINE_TYPES = new Set([
  'Temporal costeiro',
  'Temporal costero',
  'Costeiro',
  'Costero',
]);

function isMarineWarning(w: MGWarning): boolean {
  const kind = classifyWarningType(w.type);
  return kind === 'wave' || kind === 'wind' || EXTRA_MARINE_TYPES.has(w.type);
}

/** Zone window covering the instant we are reporting on. */
function isZoneActive(z: MGWarningZone, now: number): boolean {
  const start = z.startTime?.getTime?.();
  const end = z.endTime?.getTime?.();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return (start as number) <= now && (end as number) > now;
}

/** Spanish label for the MG (Galician) warning type. */
function typeLabel(type: string): string {
  const kind = classifyWarningType(type);
  if (kind === 'wave') return 'oleaje';
  if (kind === 'wind') return 'viento';
  if (EXTRA_MARINE_TYPES.has(type)) return 'temporal costero';
  return type.toLowerCase();
}

// ── Formatting ───────────────────────────────────────────

function isUsable(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/** Spanish decimal comma — "2,1" not "2.1". */
function formatMetres(v: number): string {
  return `${v.toFixed(1).replace('.', ',')} m`;
}

function formatKnots(v: number): string {
  return `${Math.round(v)} kt`;
}

// ── Main ─────────────────────────────────────────────────

/**
 * Build the informative notice for a spot, or null when there is nothing to
 * say. Null is the common case by design: no marine warning, yellow only, or
 * an inland sector.
 */
export function buildSportWarningNotice(params: SportWarningParams): SportWarningNotice | null {
  const { warnings, sectorId, now = new Date() } = params;

  // Marine rule, marine sectors. Inland spots never see this.
  if (!isCoastalSector(sectorId)) return null;
  if (!Array.isArray(warnings) || warnings.length === 0) return null;

  const nowMs = now.getTime();

  // Worst active marine zone drives the notice.
  let best: { warning: MGWarning; zone: MGWarningZone } | null = null;
  for (const w of warnings) {
    if (!isMarineWarning(w)) continue;
    for (const z of w.zones ?? []) {
      if (!isZoneActive(z, nowMs)) continue;
      if (!best || z.level > best.zone.level) best = { warning: w, zone: z };
    }
  }
  if (!best) return null;

  const level = best.zone.level;
  // Yellow (or anything below orange) is not what this notice is about.
  if (level < 2) return null;

  const label = typeLabel(best.warning.type);
  const common = {
    warningType: best.warning.type,
    zoneName: best.zone.name,
    endTime: best.zone.endTime ?? null,
    link: best.warning.link ?? '',
    sourceText: SPORT_RULE_SOURCE,
  };

  // Red: the exception is orange-only. State that and stop — no threshold, no
  // numbers, nothing that could be read as the orange case.
  if (level >= 3) {
    return {
      ...common,
      level: 3,
      exceptionApplies: false,
      headline: `Aviso rojo por ${label}`,
      thresholdText: null,
      currentText: null,
      statusText: 'La excepción deportiva de la Xunta se refiere al aviso naranja: con aviso rojo no se aplica.',
      comparison: 'unknown',
      exceeded: [],
      // No threshold applies on red, so naming which one binds would imply
      // there is still a threshold conversation to have. There is not.
      binding: null,
      bindingText: null,
      waveHeightM: null,
      windKt: null,
    };
  }

  const thresholdText =
    `El umbral deportivo son ${SPORT_WAVE_LIMIT_M} m de ola y ${SPORT_WIND_LIMIT_KT} kt de viento.`;

  const wave = isUsable(params.waveHeightM) ? params.waveHeightM : null;
  const wind = isUsable(params.windKt) ? params.windKt : null;

  // One magnitude missing: show the one we have and NAME the absent one.
  // Hiding both was considered and rejected — inside a ría there is rarely a
  // spot-local wave reading, but the wind is measured and is precisely the
  // number that decides anything there. Naming the missing magnitude keeps
  // the reader from assuming it was checked.
  if (wave === null || wind === null) {
    const missing =
      wave === null && wind === null
        ? 'de ola ni de viento'
        : wave === null
          ? 'de ola'
          : 'de viento';
    const knownText =
      wind !== null && wave === null
        ? `Ahora mismo: ${formatKnots(wind)} de viento.`
        : wave !== null && wind === null
          ? `Ahora mismo: ${formatMetres(wave)} de ola.`
          : null;
    return {
      ...common,
      level: 2,
      exceptionApplies: true,
      headline: `Aviso naranja por ${label}`,
      thresholdText,
      currentText: knownText,
      statusText: `No hay dato ${missing} en este spot, así que esa parte del umbral no se puede comparar.`,
      comparison: 'unknown',
      exceeded: [],
      binding: null,
      bindingText: null,
      waveHeightM: wave,
      windKt: wind,
    };
  }

  const exceeded: Array<'ola' | 'viento'> = [];
  if (wave > SPORT_WAVE_LIMIT_M) exceeded.push('ola');
  if (wind > SPORT_WIND_LIMIT_KT) exceeded.push('viento');
  const above = exceeded.length > 0;

  // Which limit is actually in play here. Compare each reading against its own
  // limit rather than against the other: 2m of wave and 20kt of wind are not
  // comparable numbers, but "half the wave limit" and "40% of the wind limit"
  // are. In a ria the wave ratio stays near zero all year, so this lands on
  // the wind by itself — no per-spot shelter flag needed.
  const waveRatio = wave / SPORT_WAVE_LIMIT_M;
  const windRatio = wind / SPORT_WIND_LIMIT_KT;
  const binding: 'ola' | 'viento' = waveRatio >= windRatio ? 'ola' : 'viento';
  const bindingText = binding === 'ola'
    ? 'Aquí manda la ola.'
    : 'Aquí manda el viento: la ola no se acerca al umbral en este punto.';

  return {
    ...common,
    level: 2,
    exceptionApplies: true,
    headline: `Aviso naranja por ${label}`,
    thresholdText,
    currentText: `Ahora mismo: ${formatMetres(wave)} de ola y ${formatKnots(wind)} de viento.`,
    // Below the threshold we add nothing. Any sentence here would read as a
    // verdict, and there is no verdict to give.
    statusText: above
      ? `Por encima del umbral deportivo: ${exceeded.join(' y ')}.`
      : null,
    comparison: above ? 'above' : 'below',
    exceeded,
    binding,
    bindingText,
    waveHeightM: wave,
    windKt: wind,
  };
}

/** Every user-facing string of a notice — used by the UI and by the tests. */
export function sportWarningTexts(notice: SportWarningNotice): string[] {
  return [
    notice.headline,
    notice.thresholdText,
    notice.currentText,
    notice.bindingText,
    notice.statusText,
    notice.sourceText,
  ].filter((t): t is string => typeof t === 'string' && t.length > 0);
}

// ── Dev simulation ───────────────────────────────────────

export type SportWarningSimCase = 'below' | 'above' | 'missing' | 'red';

/**
 * Synthetic warning for `?simorange=` — an orange warning is rare, and the
 * notice must be reviewable without waiting for one. Same idea as `?simfog=`
 * and `?simstrike=`.
 */
export function createSimulatedWarning(
  simCase: SportWarningSimCase = 'below',
  now: Date = new Date(),
): { warnings: MGWarning[]; waveHeightM: number | null; windKt: number | null } {
  const level = simCase === 'red' ? 3 : 2;
  const zone: MGWarningZone = {
    name: 'Rías Baixas (simulado)',
    id: 400,
    level,
    startTime: new Date(now.getTime() - 60 * 60_000),
    endTime: new Date(now.getTime() + 6 * 60 * 60_000),
    comment: 'Aviso simulado para revisar la ficha en pantalla.',
  };
  const warnings: MGWarning[] = [
    {
      type: 'Ondas',
      typeId: 3,
      maxLevel: level,
      zones: [zone],
      publishedAt: now,
      link: 'https://www.meteogalicia.gal/',
    },
  ];

  if (simCase === 'above') return { warnings, waveHeightM: 5.2, windKt: 22 };
  if (simCase === 'missing') return { warnings, waveHeightM: null, windKt: 18 };
  if (simCase === 'red') return { warnings, waveHeightM: 5.8, windKt: 40 };
  return { warnings, waveHeightM: 2.1, windKt: 18 };
}
