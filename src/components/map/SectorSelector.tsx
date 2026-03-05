import { memo } from 'react';
import { SECTORS } from '../../config/sectors';
import { useSectorStore } from '../../store/sectorStore';
import { useUIStore } from '../../store/uiStore';
import { WeatherIcon } from '../icons/WeatherIcons';

/**
 * Floating sector switcher buttons on the map.
 * Positioned top-left, below the navigation control.
 * Icon-only on mobile to save space.
 */
export const SectorSelector = memo(function SectorSelector() {
  const isMobile = useUIStore((s) => s.isMobile);
  const activeSectorId = useSectorStore((s) => s.activeSectorId);
  const switchSector = useSectorStore((s) => s.switchSector);

  return (
    <div className="absolute top-2 left-2 z-20 flex gap-1">
      {SECTORS.map((sector) => {
        const isActive = sector.id === activeSectorId;
        return (
          <button
            key={sector.id}
            onClick={() => switchSector(sector.id)}
            title={sector.name}
            aria-label={`Cambiar a sector ${sector.name}`}
            className={`flex items-center justify-center rounded-lg font-semibold
              backdrop-blur-sm border transition-all shadow-md
              ${isMobile ? 'gap-0 min-w-[44px] min-h-[44px] px-2.5 py-2 text-base' : 'gap-1 px-2.5 py-1.5 text-[11px]'}
              ${isActive
                ? 'bg-blue-600/90 text-white border-blue-500/50'
                : 'bg-slate-900/80 text-slate-400 border-slate-700/50 hover:text-white hover:bg-slate-800/90'
            }`}
          >
            <WeatherIcon id={sector.icon} size={isMobile ? 18 : 14} />
            {!isMobile && <span>{sector.shortName}</span>}
          </button>
        );
      })}
    </div>
  );
});
