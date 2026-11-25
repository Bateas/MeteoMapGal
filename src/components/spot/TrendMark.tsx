/**
 * Where the wind is going, in a word with its arrow: what someone wants to know before the figures.
 * Ink, like the rest of the words. Nothing at all when there is not enough to say it.
 */
import type { WindDrift } from '../../services/windTrendService';

const ARROW: Record<WindDrift, string> = {
  sube: 'M2.5 9.5 9.5 2.5M4.5 2.5h5v5',
  baja: 'M2.5 2.5 9.5 9.5M9.5 4.5v5h-5',
  estable: 'M1.5 6h9M7 2.5 10.5 6 7 9.5',
};

/** The arrow alone, where the word does not fit (the badge of a spot marker). Takes the colour of its text. */
export function TrendArrow({ drift, size = 12 }: { drift: WindDrift; size?: number | string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path d={ARROW[drift]} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TrendMark({ drift }: { drift: WindDrift | null }) {
  if (!drift) return null;
  return (
    <span
      className="gf-trend"
      title="Tendencia del viento, comparando los últimos 45 minutos con el rato anterior"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
    >
      {drift !== 'estable' && <TrendArrow drift={drift} />}
      {drift}
    </span>
  );
}
