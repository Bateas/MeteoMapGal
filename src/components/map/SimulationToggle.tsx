import { memo } from 'react';
import { useLightningStore } from '../../hooks/useLightningData';
import { useUIStore } from '../../store/uiStore';

/**
 * Small floating button on the map to toggle storm simulation mode.
 * Shows a lightning icon + "SIM" label when simulation is active.
 * Only visible in development mode. Icon-only on mobile.
 */
export const SimulationToggle = memo(function SimulationToggle() {
  const isMobile = useUIStore((s) => s.isMobile);
  const simulationActive = useLightningStore((s) => s.simulationActive);
  const toggleSimulation = useLightningStore((s) => s.toggleSimulation);

  // Only show in development
  if (import.meta.env.PROD) return null;

  return (
    <button
      onClick={toggleSimulation}
      className={`flex items-center justify-center shrink-0
        rounded-lg font-bold tracking-wide
        backdrop-blur-md transition-all duration-200 cursor-pointer
        ${isMobile ? 'gap-1 min-w-[44px] min-h-[44px] px-2.5 py-2 text-base' : 'gap-1.5 px-3 py-1.5 text-[11px]'}
        ${simulationActive
          ? 'bg-purple-500/25 border border-purple-400/50 text-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.3)]'
          : 'bg-slate-800/60 border border-slate-600/40 text-slate-400 hover:bg-slate-700/60 hover:text-slate-300'
        }`}
      title={simulationActive ? 'Desactivar simulación de tormenta' : 'Activar simulación de tormenta'}
    >
      <span className={isMobile ? 'text-lg' : 'text-sm'}>{simulationActive ? '⛈️' : '⚡'}</span>
      {!isMobile && <span>{simulationActive ? 'SIM ON' : 'SIM'}</span>}
      {simulationActive && (
        <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
      )}
    </button>
  );
});
