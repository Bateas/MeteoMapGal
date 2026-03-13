/**
 * Floating map style selector — lets users switch base map tiles.
 *
 * Positioned top-right on desktop (below NavigationControl),
 * top-right on mobile (below nav control, icon-only trigger).
 *
 * 6 styles: OSM, Positron (light), Dark Matter, Voyager, IGN Topo, IGN Grey.
 * All free, no API keys needed.
 */
import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { MAP_STYLES, useMapStyleStore } from '../../store/mapStyleStore';
import type { MapStyleId } from '../../store/mapStyleStore';
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';

export const MapStyleSelector = memo(function MapStyleSelector() {
  const isMobile = useUIStore((s) => s.isMobile);
  const isRias = useSectorStore((s) => s.activeSector.id === 'rias');
  const activeStyleId = useMapStyleStore((s) => s.activeStyleId);
  const setStyle = useMapStyleStore((s) => s.setStyle);
  const showSeamarks = useMapStyleStore((s) => s.showSeamarks);
  const showNauticalChart = useMapStyleStore((s) => s.showNauticalChart);
  const toggleSeamarks = useMapStyleStore((s) => s.toggleSeamarks);
  const toggleNauticalChart = useMapStyleStore((s) => s.toggleNauticalChart);
  const showIGNHillshade = useMapStyleStore((s) => s.showIGNHillshade);
  const showIGNContours = useMapStyleStore((s) => s.showIGNContours);
  const showIGNOrtho = useMapStyleStore((s) => s.showIGNOrtho);
  const toggleIGNHillshade = useMapStyleStore((s) => s.toggleIGNHillshade);
  const toggleIGNContours = useMapStyleStore((s) => s.toggleIGNContours);
  const toggleIGNOrtho = useMapStyleStore((s) => s.toggleIGNOrtho);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleSelect = useCallback((id: MapStyleId) => {
    setStyle(id);
    setOpen(false);
  }, [setStyle]);

  const activeStyle = MAP_STYLES.find((s) => s.id === activeStyleId) ?? MAP_STYLES[0];

  return (
    <div
      ref={panelRef}
      className={`${isMobile ? 'fixed z-30 top-[4.75rem] right-2' : 'absolute z-20 top-2 right-12'}`}
    >
      {/* Trigger button — swatch preview */}
      <button
        onClick={() => setOpen(!open)}
        title={`Mapa base: ${activeStyle.name}`}
        aria-label={`Cambiar mapa base (actual: ${activeStyle.name})`}
        className={`flex items-center gap-1.5 rounded-lg font-semibold
          backdrop-blur-sm border transition-all shadow-md cursor-pointer
          ${isMobile ? 'min-w-[44px] min-h-[44px] px-2 py-2' : 'px-2 py-1.5 text-[11px]'}
          ${open
            ? 'bg-blue-600/90 text-white border-blue-500/50'
            : 'bg-slate-900/80 text-slate-400 border-slate-700/50 hover:text-white hover:bg-slate-800/90 hover:shadow-[0_0_12px_rgba(148,163,184,0.15)] hover:border-slate-500/40'
          }`}
      >
        {/* Swatch circle */}
        <div
          className="w-4 h-4 rounded-full border border-slate-600 shrink-0"
          style={{
            background: `linear-gradient(135deg, ${activeStyle.swatch[0]} 50%, ${activeStyle.swatch[1]} 50%)`,
          }}
        />
        {!isMobile && <span>{activeStyle.shortName}</span>}
        <svg
          className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''} ${isMobile ? 'hidden' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className={`mt-1 bg-slate-900/95 backdrop-blur-md border border-slate-700/50 rounded-xl shadow-2xl overflow-hidden overflow-y-auto
          ${isMobile ? 'w-40 max-h-[calc(100dvh-8rem)]' : 'w-48 max-h-[70vh]'}`}
        >
          <div className="px-2 py-1.5 border-b border-slate-700/40">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Mapa base</span>
          </div>
          <div className="py-1">
            {MAP_STYLES.map((style) => {
              const isActive = style.id === activeStyleId;
              return (
                <button
                  key={style.id}
                  onClick={() => handleSelect(style.id)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors cursor-pointer
                    ${isMobile ? 'min-h-[40px]' : ''}
                    ${isActive
                      ? 'bg-blue-600/20 text-blue-300'
                      : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                    }`}
                >
                  {/* Swatch */}
                  <div
                    className={`w-5 h-5 rounded-md border shrink-0 ${isActive ? 'border-blue-400' : 'border-slate-600'}`}
                    style={{
                      background: `linear-gradient(135deg, ${style.swatch[0]} 50%, ${style.swatch[1]} 50%)`,
                    }}
                  />
                  <div className="flex flex-col min-w-0">
                    <span className={`text-[11px] font-semibold truncate ${isActive ? 'text-blue-300' : ''}`}>
                      {style.shortName}
                    </span>
                    <span className="text-[8px] text-slate-500 truncate">{style.name}</span>
                  </div>
                  {isActive && (
                    <svg className="w-3.5 h-3.5 ml-auto text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>

          {/* ── Nautical overlay toggles (Rías sector only) ── */}
          {isRias && (
            <>
              <div className="border-t border-slate-700/40 px-2 py-1.5">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Capas náuticas</span>
              </div>
              <div className="pb-1.5 px-1">
                <OverlayToggle
                  label="OpenSeaMap"
                  sublabel="Boyas, faros, marcas"
                  active={showSeamarks}
                  onClick={toggleSeamarks}
                  color="#0ea5e9"
                  isMobile={isMobile}
                />
                <OverlayToggle
                  label="Carta náutica"
                  sublabel="IHM — ENC oficial"
                  active={showNauticalChart}
                  onClick={toggleNauticalChart}
                  color="#14b8a6"
                  isMobile={isMobile}
                />
              </div>
            </>
          )}

          {/* ── IGN terrain overlay toggles (both sectors) ── */}
          <div className="border-t border-slate-700/40 px-2 py-1.5">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Capas IGN</span>
          </div>
          <div className="pb-1.5 px-1">
            <OverlayToggle
              label="Ortofotos"
              sublabel="PNOA — foto aérea 25cm"
              active={showIGNOrtho}
              onClick={toggleIGNOrtho}
              color="#22c55e"
              isMobile={isMobile}
            />
            <OverlayToggle
              label="Sombreado"
              sublabel="MDT — relieve del terreno"
              active={showIGNHillshade}
              onClick={toggleIGNHillshade}
              color="#a78bfa"
              isMobile={isMobile}
            />
            <OverlayToggle
              label="Curvas de nivel"
              sublabel="MDT — isohipsas 25m"
              active={showIGNContours}
              onClick={toggleIGNContours}
              color="#f59e0b"
              isMobile={isMobile}
            />
          </div>
        </div>
      )}
    </div>
  );
});

// ── Overlay toggle row ────────────────────────────────────

function OverlayToggle({
  label,
  sublabel,
  active,
  onClick,
  color,
  isMobile,
}: {
  label: string;
  sublabel: string;
  active: boolean;
  onClick: () => void;
  color: string;
  isMobile: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-1.5 py-1.5 rounded-lg text-left transition-colors cursor-pointer
        ${isMobile ? 'min-h-[40px]' : ''}
        ${active
          ? 'bg-slate-700/40 text-white'
          : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
        }`}
    >
      {/* Toggle dot */}
      <div
        className={`w-3 h-3 rounded-full border-2 shrink-0 transition-colors ${active ? 'border-current' : 'border-slate-600'}`}
        style={active ? { backgroundColor: color, borderColor: color } : undefined}
      />
      <div className="flex flex-col min-w-0">
        <span className="text-[10px] font-semibold truncate">{label}</span>
        <span className="text-[8px] text-slate-500 truncate">{sublabel}</span>
      </div>
    </button>
  );
}
