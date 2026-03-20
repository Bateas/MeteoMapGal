import type { SpotVerdict } from '../types/station';

/** Verdict → Tailwind classes + label. Shared across SpotSelector, ConditionsTicker, MobileSailingBanner. */
export const VERDICT_STYLE: Record<SpotVerdict, { label: string; bg: string; border: string; text: string; dot: string }> = {
  calm:    { label: 'Calma',     bg: 'bg-slate-500/10',   border: 'border-slate-500/40',   text: 'text-slate-400',   dot: 'bg-slate-400' },
  light:   { label: 'Flojo',     bg: 'bg-sky-500/10',     border: 'border-sky-500/40',     text: 'text-sky-400',     dot: 'bg-sky-400' },
  sailing: { label: 'Navegable', bg: 'bg-amber-500/15',   border: 'border-amber-500/40',   text: 'text-amber-300',   dot: 'bg-amber-400' },
  good:    { label: 'Buen d\u00eda',  bg: 'bg-emerald-500/10', border: 'border-emerald-500/40', text: 'text-emerald-400', dot: 'bg-emerald-400' },
  strong:  { label: 'Fuerte',    bg: 'bg-cyan-500/10',    border: 'border-cyan-500/40',    text: 'text-cyan-400',    dot: 'bg-cyan-400' },
  unknown: { label: 'Sin datos', bg: 'bg-slate-500/10',   border: 'border-slate-500/40',   text: 'text-slate-400',   dot: 'bg-slate-400' },
};

/** Verdict hex colors for inline styles (popups, comparator badges). Single source of truth. */
export const VERDICT_HEX: Record<SpotVerdict, string> = {
  calm: '#94a3b8', light: '#38bdf8', sailing: '#fbbf24',
  good: '#34d399', strong: '#22d3ee', unknown: '#64748b',
};
