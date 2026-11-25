import { memo } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useConditionsList } from '../../hooks/useConditionsList';
import type { AlertLevel } from '../../types/campo';
import type { ConditionLine } from '../../services/alerts/conditionsList';
import { linesNotSaidAbove } from '../../services/alerts/levelZero';
import { useLevelZeroStore } from '../../store/levelZeroStore';
import { useSpotLightningRisk } from '../../hooks/useSpotLightningRisk';
import { namedFirst, type SpotLightningRisk } from '../../services/lightningProximityService';
import { useSpotStore } from '../../store/spotStore';

/**
 * The strip beside the map tools: the state of the one list of Condiciones and its gravest line.
 * Tapping it opens the list (the drawer): there is no second list here any more.
 */

const SEMAPHORE: Record<Exclude<AlertLevel, 'none'>, { tone: string; label: string }> = {
  riesgo: { tone: 'gc-t-moderado', label: 'Aviso' },
  alto: { tone: 'gc-t-alto', label: 'Alerta' },
  critico: { tone: 'gc-t-critico', label: 'Peligro' },
};

export const AlertPanel = memo(function AlertPanel() {
  const isMobile = useUIStore((s) => s.isMobile);
  const drawerOpen = useUIStore((s) => s.fieldDrawerOpen);
  const toggleDrawer = useUIStore((s) => s.toggleFieldDrawer);
  const list = useConditionsList();

  const simpleMode = useUIStore((s) => s.simpleMode);
  const tickerKey = useLevelZeroStore((s) => s.tickerKey);
  // Lightning near a spot is said by the safety band over the map, not by the list of Condiciones:
  // the strip must not say «Nada activo» under that band (F35, seen with ?simstrike).
  const lightningRisks = useSpotLightningRisk();
  // The spot the reader looks at: the strip names the same one as the band (lightningRiskLine)
  const activeSpotId = useSpotStore((s) => s.activeSpotId);
  const favoriteSpotId = useSpotStore((s) => s.favoriteSpotId);

  const all = [...list.now, ...list.ahead];
  // Simple mode: one voice per fact. The strip over the map says the official warnings and its one
  // line; this one says only what that one does not, and with nothing left it is not drawn. The dot
  // of Condiciones still marks that there are warnings.
  const lines = simpleMode ? linesNotSaidAbove(all, tickerKey) : all;
  if (simpleMode && lines.length === 0 && !list.unknownShort && lightningRisks.length === 0) return null;
  // Green would say more than we know: with nothing active the dot stays grey, and a source that does
  // not answer is said instead.
  const listLevel = simpleMode ? levelOfLines(lines) : list.level;
  const lightning = lightningRiskLine(lightningRisks, activeSpotId, favoriteSpotId);
  const level = lightning && LEVEL_RANK[lightning.level] > LEVEL_RANK[listLevel] ? lightning.level : listLevel;
  const state = level !== 'none'
    ? SEMAPHORE[level]
    : list.unknownShort
      ? { tone: 'gc-t-alto', label: list.unknownShort }
      : { tone: '', label: lines.length > 0 ? 'Nada urgente' : 'Nada activo' };
  // One sentence, not three cut chips that all began «Aviso amarillo de…»: the gravest line, where and
  // until when, and how many more wait in the list. The list is already in order inside each level
  // (MeteoGalicia before IPMA, measured before model), so the first line of the gravest tone is taken.
  const listWorst = worstLine(lines);
  // When the lightning sets the level, its line leads; the list's own lines count as «y N más».
  const lightningLeads = lightning != null && level === lightning.level && LEVEL_RANK[lightning.level] > LEVEL_RANK[listLevel];
  const worst = lightningLeads ? lightning.line : listWorst;
  const more = worst ? lines.length - (lightningLeads ? 0 : 1) : 0;
  const sentence = worst ? `${worst.text}${worst.sub ? `, ${worst.sub}` : ''}` : '';
  const word = level !== 'none' ? stripWord(level, worst) : state.label;

  return (
    <button
      type="button"
      className="g-theme gc-alertstrip"
      onClick={toggleDrawer}
      aria-expanded={drawerOpen}
      aria-label={`${word}${worst ? `: ${sentence}` : ''}${more > 0 ? `, y ${more} más` : ''}. Ver condiciones`}
    >
      <span className={`gc-alertstrip-risk ${state.tone}`}>
        <span className={`gc-dot${level === 'critico' ? ' animate-pulse' : ''}`} />
        {/* The level in a word, always: the colour of the dot alone does not say it */}
        {word}
      </span>
      {worst && (
        <span className="gc-alertline" title={sentence}>
          <b>{worst.text}</b>
          {worst.sub && !isMobile && <span className="gc-alertline-sub">{worst.sub}</span>}
        </span>
      )}
      {more > 0 && <span className="gc-alertline-more">y {more} más</span>}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginLeft: 'auto', transform: drawerOpen ? 'rotate(180deg)' : undefined }}>
        <path d="M18 15l-6-6-6 6" />
      </svg>
    </button>
  );
});

const TONE_RANK: Record<string, number> = { critico: 4, alto: 3, moderado: 2, riesgo: 1 };

/**
 * The word of the strip. «Aviso» is what MeteoGalicia calls its warnings, so the lowest level says it
 * only for an official line; rain measured by the gauges, fog or the model say «Atención» (18-nov:
 * «Aviso · Lluvia moderada ahora» read as an official warning). «Alerta» and «Peligro» stay.
 */
export function stripWord(level: Exclude<AlertLevel, 'none'>, lead: ConditionLine | null): string {
  if (level === 'riesgo' && lead?.origin !== 'oficial') return 'Atención';
  return SEMAPHORE[level].label;
}

/** The level of what is left to say: the word of the strip has to match the line beside it. */
export function levelOfLines(lines: ConditionLine[]): AlertLevel {
  const worst = worstLine(lines);
  if (!worst || worst.tone === null) return 'none';
  return worst.tone === 'critico' ? 'critico' : worst.tone === 'alto' ? 'alto' : 'riesgo';
}

/** The gravest line; among equals, the first of the list. */
export function worstLine(lines: ConditionLine[]): ConditionLine | null {
  let best: ConditionLine | null = null;
  for (const l of lines) {
    if (!best || (TONE_RANK[l.tone ?? ''] ?? 0) > (TONE_RANK[best.tone ?? ''] ?? 0)) best = l;
  }
  return best;
}

const LEVEL_RANK: Record<AlertLevel, number> = { none: 0, riesgo: 1, alto: 2, critico: 3 };

/**
 * The strip's line for strikes near a spot, danger as «Peligro», warning as «Alerta». It names the same
 * spot as the safety band over the map (namedFirst: the reader's spot if it is among the worst, else the
 * first of the list, which comes with the gravest and closest first). With a rule of its own it named the
 * closest one, and two spots at the same distance read «Rayo a 6 km — Cesantes» above and «Rayos a 6 km
 * de Lourido» below (25-nov).
 */
export function lightningRiskLine(
  risks: SpotLightningRisk[],
  activeSpotId?: string | null,
  favoriteSpotId?: string | null,
): { level: AlertLevel; line: ConditionLine } | null {
  if (risks.length === 0) return null;
  const danger = risks.filter((r) => r.level === 'peligro');
  const pool = danger.length ? danger : risks;
  const nearest = namedFirst(pool, activeSpotId, favoriteSpotId);
  const others = pool.length - 1;
  return {
    level: danger.length ? 'critico' : 'alto',
    line: {
      id: 'spot-lightning',
      icon: 'zap',
      tone: danger.length ? 'critico' : 'alto',
      origin: 'medido',
      text: `Rayos a ${Math.max(1, Math.round(nearest.nearestKm))} km de ${nearest.spotName}`,
      sub: others > 0 ? `y ${others === 1 ? 'otro spot' : `${others} spots más`}` : undefined,
    },
  };
}
