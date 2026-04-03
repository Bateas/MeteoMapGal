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
