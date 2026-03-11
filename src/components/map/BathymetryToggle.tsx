import { memo } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';
import { WeatherIcon } from '../icons/WeatherIcons';

/**
 * Toggle button for EMODnet bathymetry layer. Only visible in Rías Baixas sector.
 * Follows same styling pattern as TemperatureToggle.
 */
export const BathymetryToggle = memo(function BathymetryToggle() {
  const isMobile = useUIStore((s) => s.isMobile);
  const visible = useUIStore((s) => s.bathymetryVisible);
  const toggle = useUIStore((s) => s.toggleBathymetry);
  const sectorId = useSectorStore((s) => s.activeSector.id);

  if (sectorId !== 'rias') return null;

  const btnClasses = visible
    ? 'bg-teal-500/25 border border-teal-400/50 text-teal-300 shadow-[0_0_15px_rgba(20,184,166,0.3)]'
    : 'bg-slate-800/60 border border-slate-600/40 text-slate-400 hover:bg-slate-700/60 hover:text-slate-300';

  return (
    <button
      onClick={toggle}
      className={`flex items-center justify-center
        rounded-lg font-bold tracking-wide
        backdrop-blur-md transition-all duration-200 cursor-pointer
        ${isMobile ? 'gap-1 min-w-[44px] min-h-[44px] px-2.5 py-2 text-base' : 'gap-1.5 px-3 py-1.5 text-[11px]'}
        ${btnClasses}`}
      title={visible ? 'Ocultar batimetría (EMODnet)' : 'Mostrar batimetría submarina (EMODnet)'}
    >
      <WeatherIcon id="anchor" size={isMobile ? 18 : 14} />
      {!isMobile && <span>{visible ? 'Fondo ON' : 'Fondo'}</span>}
    </button>
  );
});
