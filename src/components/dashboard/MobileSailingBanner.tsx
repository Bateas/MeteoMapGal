import { memo } from 'react';
import { useSailingBriefing, VERDICT_CONFIG, ScoreBadge } from './DailySailingBriefing';
import { WeatherIcon } from '../icons/WeatherIcons';
import { useUIStore } from '../../store/uiStore';

/**
 * Compact floating pill that shows the sailing verdict above the map on mobile.
 * Tapping it opens the sidebar where the full DailySailingBriefing is rendered.
 */
export const MobileSailingBanner = memo(function MobileSailingBanner() {
  const briefing = useSailingBriefing();
  const v = VERDICT_CONFIG[briefing.verdict];
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

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
      <span className={`text-[11px] font-bold ${v.text} whitespace-nowrap`}>{v.label}</span>
      <ScoreBadge score={briefing.score} verdict={briefing.verdict} />
      <WeatherIcon id="info" size={12} className="text-slate-500 flex-shrink-0 ml-0.5" />
    </button>
  );
});
