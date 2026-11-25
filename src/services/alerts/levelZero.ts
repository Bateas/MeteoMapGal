/**
 * Level zero of simple mode: the map with nothing touched. One fact, one voice on the screen, and
 * no more than two entries over the map. Pure rules; the components only draw what these return.
 *
 * - The official warnings of MeteoGalicia are said by the strip over the map, always. The strip
 *   beside the tools then says only what that one does not: fog, a sudden wind, a warning of IPMA.
 * - A line of the forecast with no tone is not a warning: it waits in Condiciones.
 * - What the one line over the map already says (fires, lightning) is not repeated below.
 */
import type { ConditionLine } from './conditionsList';

/** The entries the upper strip may show in simple mode. */
export const SIMPLE_TOP_MAX = 2;

/** A line of the upper strip urgent enough to go before a second official warning. */
export const LINE_BEFORE_SECOND_WARNING = 9.5;

/** The lines of Condiciones that nothing over the map says yet (simple mode). */
export function linesNotSaidAbove(lines: ConditionLine[], tickerKey: string | null): ConditionLine[] {
  return lines.filter((l) => {
    if (l.tone === null) return false;
    if (l.id.startsWith('official-mg-')) return false;
    if (tickerKey === 'active-fires' && l.id === 'active-fires') return false;
    if (tickerKey === 'lightning-measured' && l.icon === 'zap') return false;
    return true;
  });
}

interface TopPlan<W> {
  /** Official warnings to draw, gravest first */
  warnings: W[];
  /** Whether the one line is drawn */
  line: boolean;
  /** Official warnings left to Condiciones */
  hidden: number;
}

/**
 * What the upper strip draws. In advanced, everything. In simple, two entries: the gravest official
 * warning first; the second is the line when it is urgent (lightning, a near fire, a high tide) or
 * when there is no second warning, and the second warning otherwise. A warning is never dropped in
 * favour of a milder one: they go by level.
 */
export function topStripPlan<W extends { level: number }>(
  warnings: W[],
  line: { priority: number } | null,
  simple: boolean,
  phone = false,
): TopPlan<W> {
  if (!simple) return { warnings, line: line !== null, hidden: 0 };
  const byLevel = [...warnings].sort((a, b) => b.level - a.level);
  if (byLevel.length === 0) return { warnings: [], line: line !== null, hidden: 0 };
  // On a phone one official warning, the gravest: two took some 200 px before the map began (18-nov,
  // «aligerar la primera pantalla»). The line only when urgent; otherwise the strip by the map tools
  // says it, since nothing above does.
  if (phone) {
    return { warnings: byLevel.slice(0, 1), line: line !== null && line.priority >= LINE_BEFORE_SECOND_WARNING, hidden: byLevel.length - 1 };
  }
  const lineFirst = line !== null && (byLevel.length === 1 || line.priority >= LINE_BEFORE_SECOND_WARNING);
  const shown = byLevel.slice(0, lineFirst ? SIMPLE_TOP_MAX - 1 : SIMPLE_TOP_MAX);
  return { warnings: shown, line: lineFirst, hidden: byLevel.length - shown.length };
}
