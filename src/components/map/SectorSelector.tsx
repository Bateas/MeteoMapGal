import { memo } from 'react';
import { SECTORS } from '../../config/sectors';
import { useSectorStore } from '../../store/sectorStore';
import { useUIStore } from '../../store/uiStore';
import { WeatherIcon } from '../icons/WeatherIcons';

/**
 * Floating sector switcher buttons on the map.
 * Positioned top-left, below the navigation control.
 * Icon-only on mobile to save space.
 *
 * Desktop sizing (user feedback): users reported the buttons were
 * too small / didn't stand out — a primary action shouldn't look like
 * decorative chrome. Bumped to a clear 40px height + larger text + 2px
 * border + glow on the active state so it reads as "this is THE big
 * decision" of the page.
 */
export const SectorSelector = memo(function SectorSelector() {
  const isMobile = useUIStore((s) => s.isMobile);
  const activeSectorId = useSectorStore((s) => s.activeSectorId);
  const switchSector = useSectorStore((s) => s.switchSector);

  return (
    <div className={`${isMobile ? 'hidden' : 'absolute z-30 top-2'} left-2 flex gap-1.5`}>
      {SECTORS.map((sector) => {
        const isActive = sector.id === activeSectorId;
        return (
          <button
            key={sector.id}
            onClick={() => switchSector(sector.id)}
            title={sector.name}
            aria-label={`Cambiar a sector ${sector.name}`}
            className={`flex items-center justify-center rounded-lg font-semibold
              backdrop-blur-sm border-2 transition-all shadow-lg
              ${isMobile
                ? 'gap-0 min-w-[44px] min-h-[44px] px-2.5 py-2 text-base'
                : 'gap-1.5 min-h-[40px] px-4 py-2 text-[13px]'
              }
              ${isActive
                ? 'bg-blue-600 text-white border-blue-400 shadow-[0_0_16px_rgba(59,130,246,0.45)] scale-105'
                : 'bg-slate-800/90 text-slate-200 border-slate-600/60 hover:text-white hover:bg-slate-700/90 hover:border-slate-400/70 hover:shadow-[0_0_12px_rgba(148,163,184,0.25)]'
            }`}
          >
            <WeatherIcon id={sector.icon} size={isMobile ? 18 : 16} />
            {!isMobile && <span>{sector.shortName}</span>}
          </button>
        );
      })}
    </div>
  );
});
