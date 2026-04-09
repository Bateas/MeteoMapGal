/**
 * ForecastPanel — expanded forecast overlay for desktop/mobile.
 *
 * Desktop: overlay covering the map area (z-50).
 * Mobile: fullscreen overlay above bottom nav.
 * Renders ForecastTimeline in expanded mode for maximum data visibility.
 *
 * Opened via: sidebar "Ampliar" button, mobile bottom nav "Previsión",
 * or keyboard shortcut 'P'.
 */
import { memo, useEffect, useCallback, useState, useMemo } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';
import { getSpotsForSector } from '../../config/spots';
import { ForecastTimeline } from './ForecastTimeline';
import { WeatherIcon } from '../icons/WeatherIcons';

/** Mini legend explaining the quality dots and color system */
function ForecastLegend({ onClose }: { onClose: () => void }) {
  return (
    <div className="bg-slate-800/90 border border-slate-700 rounded-lg p-3 text-xs text-slate-300 space-y-2 max-w-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-200">Leyenda</span>
        <button onClick={onClose} className="text-slate-500 hover:text-white p-0.5" aria-label="Cerrar leyenda">
          <WeatherIcon id="x" size={12} />
        </button>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="flex gap-px">
            {[1,2,3,4,5].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />)}
          </span>
          <span>Ideal: viento 8-18kt, sin lluvia, rachas suaves</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex gap-px">
            {[1,2,3].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />)}
          </span>
          <span>Bueno: viento 6-22kt, condiciones aceptables</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex gap-px">
            {[1,2].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />)}
          </span>
          <span>Marginal: viento flojo o fuerte</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-600">-</span>
          <span>Noche o sin viento</span>
        </div>
      </div>
      <div className="border-t border-slate-700 pt-1.5 space-y-1">
        <div className="flex items-center gap-2">
          <span className="w-6 h-3 rounded" style={{ background: 'rgba(34,197,94,0.18)' }} />
          <span>Viento ideal (10-18kt)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-6 h-3 rounded" style={{ background: 'rgba(249,115,22,0.18)' }} />
          <span>Viento fuerte (15-20kt)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-6 h-3 rounded" style={{ background: 'rgba(239,68,68,0.2)' }} />
          <span>Viento peligroso (20+kt)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-6 h-3 rounded" style={{ background: 'rgba(245,158,11,0.18)' }} />
          <span>HR baja (bueno para termicos)</span>
        </div>
      </div>
      <div className="border-t border-slate-700 pt-1.5 space-y-1">
        <div className="text-slate-400 font-semibold text-[10px] uppercase">Metricas de la franja</div>
        <div className="flex items-center gap-2">
          <span className="text-green-400 font-bold text-[10px]">Dir estable</span>
          <span>Viento mantiene rumbo constante (&gt;60%)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-red-400 font-bold text-[10px]">Dir caotico</span>
          <span>Viento cambia de rumbo frecuentemente</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-green-400 font-bold text-[10px]">Patron 60%+</span>
          <span>Condiciones similares a mejores dias historicos</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-amber-400 font-bold text-[10px]">Patron 35-60%</span>
          <span>Coincidencia parcial con patrones favorables</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-amber-400 font-bold text-[10px]">ΔT</span>
          <span>Diferencia temp max-min: &gt;16°C = termica probable</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-orange-400 font-bold text-[10px]">CAPE</span>
          <span>Energia convectiva: &gt;500 = tormentas posibles</span>
        </div>
      </div>
      <div className="text-slate-500 text-[10px] border-t border-slate-700 pt-1.5">
        <div>WRF-MG = MeteoGalicia 1km (mas preciso para Galicia)</div>
        <div>Auto = Open-Meteo ICON/GFS (sobreestima viento interior)</div>
      </div>
    </div>
  );
}

function ForecastPanelInner() {
  const open = useUIStore((s) => s.forecastPanelOpen);
  const spotId = useUIStore((s) => s.forecastPanelSpotId);
  const setOpen = useUIStore((s) => s.setForecastPanelOpen);
  const isMobile = useUIStore((s) => s.isMobile);
  const [showLegend, setShowLegend] = useState(false);
  const sectorId = useSectorStore((s) => s.activeSector.id);

  // Resolve spot name + coords for header
  const spotInfo = useMemo(() => {
    if (!spotId) return null;
    const spots = getSpotsForSector(sectorId);
    return spots.find(s => s.id === spotId) ?? null;
  }, [spotId, sectorId]);

  const close = useCallback(() => setOpen(false), [setOpen]);

  // Escape key closes panel
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col bg-slate-900 ${
        isMobile ? '' : 'md:left-0'
      }`}
      style={isMobile ? { bottom: 'calc(48px + env(safe-area-inset-bottom, 0px))' } : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Prevision detallada"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700 bg-slate-800/50 shrink-0">
        <div className="flex items-center gap-2">
          <WeatherIcon id="cloud-sun" size={18} className="text-sky-400" />
          <h2 className="text-sm font-semibold text-slate-200">
            Prevision {spotInfo ? spotInfo.name : 'detallada'}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Legend toggle */}
          <button
            onClick={() => setShowLegend(v => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
              showLegend ? 'bg-sky-600/20 text-sky-400' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700'
            }`}
            aria-label="Mostrar leyenda"
            title="Leyenda de colores y calidad"
          >
            <WeatherIcon id="info" size={12} />
            {!isMobile && <span>Leyenda</span>}
          </button>

          {!isMobile && (
            <span className="text-[11px] text-slate-600 font-mono">
              Esc / P
            </span>
          )}
          <button
            onClick={close}
            className="p-1.5 rounded-lg hover:bg-slate-700 transition-colors text-slate-400 hover:text-white min-w-[36px] min-h-[36px] flex items-center justify-center"
            aria-label="Cerrar prevision"
          >
            <WeatherIcon id="x" size={18} />
          </button>
        </div>
      </div>

      {/* Legend overlay */}
      {showLegend && (
        <div className="absolute top-12 right-3 z-10">
          <ForecastLegend onClose={() => setShowLegend(false)} />
        </div>
      )}

      {/* Content — ForecastTimeline in expanded mode */}
      <div className="flex-1 overflow-y-auto min-h-0 p-3">
        <ForecastTimeline expanded spotCoords={spotInfo ? { lat: spotInfo.center[1], lon: spotInfo.center[0] } : undefined} />
      </div>
    </div>
  );
}

export const ForecastPanel = memo(ForecastPanelInner);
