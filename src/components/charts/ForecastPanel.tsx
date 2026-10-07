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
import { memo, useEffect, useCallback, useMemo } from 'react';
import { useUIStore } from '../../store/uiStore';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useSectorStore } from '../../store/sectorStore';
import { getSpotsForSector } from '../../config/spots';
import { ForecastTimeline } from './ForecastTimeline';
import '../../styles/archivoFonts.css';
import './forecastG.css';

function ForecastPanelInner() {
  const open = useUIStore((s) => s.forecastPanelOpen);
  const spotId = useUIStore((s) => s.forecastPanelSpotId);
  const setOpen = useUIStore((s) => s.setForecastPanelOpen);
  const isMobile = useUIStore((s) => s.isMobile);
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const sectorName = useSectorStore((s) => s.activeSector.name);
  // Focus trap: Tab no escapa al mapa cuando el panel está abierto (WCAG 2.4.3)
  const focusTrapRef = useFocusTrap<HTMLDivElement>(open);

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
      ref={focusTrapRef}
      className={`g-theme fixed inset-0 z-50 flex flex-col ${isMobile ? '' : 'md:left-0'}`}
      style={isMobile ? { bottom: 'calc(48px + env(safe-area-inset-bottom, 0px))' } : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Prevision detallada"
    >
      {/* Header (V3 style G, tried on this panel only) */}
      <div className="g-head">
        <div style={{ minWidth: 0 }}>
          <h2>Previsión{spotInfo ? ` · ${spotInfo.name}` : ''}</h2>
          <div className="g-sub">{sectorName} · próximas 48 horas</div>
        </div>
        <div className="g-actions">
          <button type="button" className="g-btn" onClick={close} aria-label="Volver al mapa" title={isMobile ? undefined : 'Volver al mapa (Esc)'}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
          </button>
        </div>
      </div>

      {/* Content — ForecastTimeline in expanded mode */}
      <div className="g-body min-h-0">
        <ForecastTimeline expanded spotCoords={spotInfo ? { lat: spotInfo.center[1], lon: spotInfo.center[0] } : undefined} />
      </div>
    </div>
  );
}

export const ForecastPanel = memo(ForecastPanelInner);
