import { useUIStore } from '../../store/uiStore';
import { useSpotStore } from '../../store/spotStore';

/**
 * Compact inline legend for spot verdict colors on the map.
 * Shows the 5 verdict levels (Calma → Fuerte) with colored dots.
 * Only visible when spots have data. Positioned bottom-right.
 */

const ITEMS: { label: string; color: string }[] = [
  { label: 'Calma',     color: '#94a3b8' },
  { label: 'Flojo',     color: '#38bdf8' },
  { label: 'Navegable', color: '#fbbf24' },
  { label: 'Bueno',     color: '#34d399' },
  { label: 'Fuerte',    color: '#22d3ee' },
];

export function SpotScoreLegend() {
  const isMobile = useUIStore((s) => s.isMobile);
  const scores = useSpotStore((s) => s.spotScores);

  // Only show when at least one spot has a verdict
  if (scores.size === 0) return null;

  return (
    <div
      className={`absolute z-20 pointer-events-none
        ${isMobile ? 'bottom-[7.5rem] right-2' : 'bottom-14 right-2'}`}
    >
      <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-slate-900/70 backdrop-blur-sm border border-slate-700/40">
        {ITEMS.map((it) => (
          <div key={it.label} className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: it.color }}
            />
            <span className="text-[10px] text-white/80 leading-none whitespace-nowrap">
              {it.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
