import { memo } from 'react';
import { useLightningStore } from '../../hooks/useLightningData';
import { useUIStore } from '../../store/uiStore';
import { WeatherIcon } from '../icons/WeatherIcons';

/**
 * Passive storm indicator on the map toolbar.
 * Lights up purple when real lightning activity is detected nearby.
 * Not clickable — purely informational.
 */
export const SimulationToggle = memo(function StormIndicator() {
  const isMobile = useUIStore((s) => s.isMobile);
  const stormLevel = useLightningStore((s) => s.stormAlert.level);

  const hasStorm = stormLevel !== 'none';

  return (
    <div
      className={`flex items-center justify-center shrink-0
        rounded-lg font-bold tracking-wide
        backdrop-blur-md transition-all duration-200
        ${isMobile ? 'gap-1 min-w-[44px] min-h-[44px] px-2.5 py-2 text-base' : 'gap-1.5 px-3 py-1.5 text-[11px]'}
        ${hasStorm
          ? 'bg-purple-500/25 border border-purple-400/50 text-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.3)]'
          : 'bg-slate-800/60 border border-slate-600/40 text-slate-500'
        }`}
      title={hasStorm
        ? `Actividad eléctrica detectada (${stormLevel})`
        : 'Sin actividad eléctrica'
      }
    >
      <WeatherIcon id="zap" size={isMobile ? 18 : 14} />
      {!isMobile && <span>{hasStorm ? stormLevel.toUpperCase() : 'RAYOS'}</span>}
      {hasStorm && (
        <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
      )}
    </div>
  );
});
