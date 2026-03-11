import { memo } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';
import { WeatherIcon } from '../icons/WeatherIcons';

/**
 * Toggle button for CMEMS SST (Sea Surface Temperature) overlay.
 * Only visible in Rías Baixas sector.
 * Follows same styling pattern as BathymetryToggle.
 */
export const SSTToggle = memo(function SSTToggle() {
  const isMobile = useUIStore((s) => s.isMobile);
  const visible = useUIStore((s) => s.sstVisible);
  const toggle = useUIStore((s) => s.toggleSST);
  const sectorId = useSectorStore((s) => s.activeSector.id);

  if (sectorId !== 'rias') return null;

  const btnClasses = visible
    ? 'bg-orange-500/25 border border-orange-400/50 text-orange-300 shadow-[0_0_15px_rgba(249,115,22,0.3)]'
    : 'bg-slate-800/60 border border-slate-600/40 text-slate-400 hover:bg-slate-700/60 hover:text-slate-300';

  return (
    <button
      onClick={toggle}
      className={`flex items-center justify-center
        rounded-lg font-bold tracking-wide
        backdrop-blur-md transition-all duration-200 cursor-pointer
        ${isMobile ? 'gap-1 min-w-[44px] min-h-[44px] px-2.5 py-2 text-base' : 'gap-1.5 px-3 py-1.5 text-[11px]'}
        ${btnClasses}`}
      title={visible ? 'Ocultar temperatura del mar (CMEMS)' : 'Mostrar temperatura superficial del mar (CMEMS SST)'}
    >
      <WeatherIcon id="thermometer" size={isMobile ? 18 : 14} />
      {!isMobile && <span>{visible ? 'SST ON' : 'SST'}</span>}
    </button>
  );
});
