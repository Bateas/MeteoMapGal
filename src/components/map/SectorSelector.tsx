import { memo } from 'react';
import { SECTORS } from '../../config/sectors';
import { useSectorStore } from '../../store/sectorStore';

/**
 * Floating sector switcher buttons on the map.
 * Positioned top-left, below the navigation control.
 */
export const SectorSelector = memo(function SectorSelector() {
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
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold
              backdrop-blur-sm border transition-all shadow-md ${
              isActive
                ? 'bg-blue-600/90 text-white border-blue-500/50'
                : 'bg-slate-900/80 text-slate-400 border-slate-700/50 hover:text-white hover:bg-slate-800/90'
            }`}
          >
            <span className="text-sm">{sector.icon}</span>
            <span>{sector.shortName}</span>
          </button>
        );
      })}
    </div>
  );
});
