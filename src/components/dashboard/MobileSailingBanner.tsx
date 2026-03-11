import { memo, useMemo } from 'react';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { getSpotsForSector } from '../../config/spots';
import { VERDICT_STYLE } from './SpotSelector';
import { WeatherIcon } from '../icons/WeatherIcons';
import { useUIStore } from '../../store/uiStore';

/**
 * Compact floating pill that shows the active spot verdict above the map on mobile.
 * Tapping it opens the sidebar where the full SpotSelector is rendered.
 * Works for all sectors (Embalse + Rías).
 */
export const MobileSailingBanner = memo(function MobileSailingBanner() {
  const scores = useSpotStore((s) => s.scores);
  const activeSpotId = useSpotStore((s) => s.activeSpotId);
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

  const spots = useMemo(() => getSpotsForSector(sectorId), [sectorId]);
  const activeSpot = spots.find((s) => s.id === activeSpotId) ?? spots[0];
  const activeScore = activeSpot ? scores.get(activeSpot.id) : undefined;
  const verdict = activeScore?.verdict ?? 'unknown';
  const v = VERDICT_STYLE[verdict];

  if (!activeSpot) return null;

  return (
    <button
      onClick={() => setSidebarOpen(true)}
      className={`
        fixed top-14 left-1/2 -translate-x-1/2 z-20
        flex items-center gap-1.5 px-3 py-1.5 rounded-full
        border ${v.border} ${v.bg}
        backdrop-blur-sm shadow-lg shadow-black/30
        transition-all active:scale-95
      `}
    >
      <WeatherIcon id="sailboat" size={14} className={`flex-shrink-0 ${v.text}`} />
      <span className={`text-[11px] font-bold ${v.text} whitespace-nowrap`}>
        {activeSpot.shortName} {v.label}
      </span>
      {activeScore && (
        <span className={`${v.bg} ${v.text} text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums ${verdict === 'go' ? 'badge-shimmer' : ''}`}>
          {activeScore.score}/100
        </span>
      )}
      <WeatherIcon id="info" size={12} className="text-slate-500 flex-shrink-0 ml-0.5" />
    </button>
  );
});
