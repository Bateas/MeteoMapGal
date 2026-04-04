import { memo, useMemo } from 'react';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import type { WeatherLayerType } from '../../store/weatherLayerStore';
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';
import { useAviationStore } from '../../store/aviationStore';
import { useWebcamStore } from '../../store/webcamStore';
import { useRegattaStore } from '../../store/regattaStore';
import { WeatherIcon, type IconId } from '../icons/WeatherIcons';

// ── Layer button configs ───────────────────────────────────

const LAYER_BUTTONS: { id: WeatherLayerType; icon: IconId; label: string; sector?: string }[] = [
  { id: 'wind-particles', icon: 'wind', label: 'Viento' },
  { id: 'humidity', icon: 'droplets', label: 'Humedad' },
  { id: 'radar', icon: 'radar', label: 'Radar' },
  { id: 'currents', icon: 'waves', label: 'Corrientes', sector: 'rias' },
];

// ── Component ──────────────────────────────────────────────

export const WeatherLayerSelector = memo(function WeatherLayerSelector() {
  const isMobile = useUIStore((s) => s.isMobile);
  const activeLayer = useWeatherLayerStore((s) => s.activeLayer);
  const layerOpacity = useWeatherLayerStore((s) => s.layerOpacity);
  const activeSector = useSectorStore((s) => s.activeSector);

  const setActiveLayer = useWeatherLayerStore((s) => s.setActiveLayer);
  const setLayerOpacity = useWeatherLayerStore((s) => s.setLayerOpacity);

  // Filter sector-restricted buttons (e.g. 'currents' only in Rías)
  const buttons = useMemo(
    () => LAYER_BUTTONS.filter((b) => !b.sector || b.sector === activeSector.id),
    [activeSector.id],
  );

  const handleLayerClick = (id: WeatherLayerType) => {
    setActiveLayer(activeLayer === id ? 'none' : id);
  };

  const isActive = activeLayer !== 'none';

  return (
    <div className="shrink-0" data-tour="layers">
      <div
        className={`bg-slate-900/85 backdrop-blur-md border border-slate-700/50 rounded-xl
          transition-all duration-200 ${isActive ? 'shadow-lg shadow-black/30' : ''}`}
      >
        {/* Expanded controls — ABOVE buttons so panel grows upward */}
        {isActive && (
          <div className={`border-b border-slate-700/40 space-y-2 ${isMobile ? 'w-[min(calc(100vw-2rem),18rem)] px-2.5 py-2' : 'w-72 px-3 py-2'}`}>
            {/* Opacity slider */}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-500 shrink-0">Opacidad</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(layerOpacity * 100)}
                onChange={(e) => setLayerOpacity(Number(e.target.value) / 100)}
                className="flex-1 h-1 accent-sky-500 cursor-pointer"
                aria-label="Opacidad de la capa"
                aria-valuetext={`${Math.round(layerOpacity * 100)} por ciento`}
              />
              <span className="text-[11px] text-slate-400 w-8 text-right font-mono">
                {Math.round(layerOpacity * 100)}%
              </span>
            </div>

            {/* ── Color legend for wind particles ── */}
            {activeLayer === 'wind-particles' && <WindLegend />}

            {/* ── Color legend for humidity ── */}
            {activeLayer === 'humidity' && <HumidityLegend />}


            {/* ── Radar info ── */}
            {activeLayer === 'radar' && <RadarLegend />}

            {/* ── Currents info ── */}
            {activeLayer === 'currents' && <CurrentsLegend />}
          </div>
        )}

        {/* Layer toggle buttons + tracking toggles — single row */}
        <div className={`flex items-center gap-0.5 ${isMobile ? 'p-0.5' : 'p-1.5'}`} role="group" aria-label="Capas meteorológicas">
          {buttons.map((btn) => {
            const isOn = activeLayer === btn.id;
            return (
              <button
                key={btn.id}
                onClick={() => handleLayerClick(btn.id)}
                aria-pressed={isOn}
                className={`flex items-center justify-center gap-1 rounded-lg font-bold
                  transition-all duration-200 cursor-pointer
                  ${isMobile ? 'min-w-[44px] min-h-[44px] px-2.5 py-2 text-base' : 'px-2.5 py-1 text-[11px]'}
                  ${isOn
                    ? 'bg-sky-500/25 border border-sky-400/50 text-sky-300 shadow-[0_0_10px_rgba(56,189,248,0.25)]'
                    : 'border border-slate-600/30 text-slate-500 hover:bg-slate-700/60 hover:text-slate-200 hover:shadow-[0_0_12px_rgba(56,189,248,0.15)] hover:border-sky-500/20'
                  }`}
                title={isMobile ? btn.label : `${btn.label} (W para ciclar)`}
              >
                <WeatherIcon id={btn.icon} size={isMobile ? 18 : 14} />
                {!isMobile && <span>{btn.label}</span>}
              </button>
            );
          })}
          {/* Tracking toggles inline — no border separator, same row */}
          <TrackingTogglesInline isMobile={isMobile} sectorId={activeSector.id} />
        </div>

        {/* Event/Regatta mode button */}
        <EventModeButton isMobile={isMobile} />
      </div>
    </div>
  );
});

/* ─── Tracking layer toggles (Webcams, Aviation) — inline in same row ─── */

const TRACKING_BUTTONS: { id: string; icon: IconId; label: string; sector: string; alpha?: boolean }[] = [
  { id: 'webcams', icon: 'camera', label: 'Webcams', sector: 'rias' },
  { id: 'aviation', icon: 'navigation', label: 'Aviones', sector: 'embalse', alpha: true },
];

function TrackingTogglesInline({ isMobile, sectorId }: { isMobile: boolean; sectorId: string }) {
  const avShow = useAviationStore((s) => s.showOverlay);
  const avAlert = useAviationStore((s) => s.alert);
  const avToggle = useAviationStore((s) => s.toggleOverlay);
  const wcShow = useWebcamStore((s) => s.showOverlay);
  const wcToggle = useWebcamStore((s) => s.toggleOverlay);

  const visible = TRACKING_BUTTONS.filter((b) => b.sector === sectorId);
  if (visible.length === 0) return null;

  const getState = (id: string) => {
    if (id === 'webcams') return { isOn: wcShow, toggle: wcToggle, badge: undefined };
    if (id === 'aviation') return { isOn: avShow, toggle: avToggle, badge: avAlert.level !== 'none' ? avAlert.aircraftInBbox.toString() : undefined };
    return { isOn: false, toggle: () => {}, badge: undefined };
  };

  return (
    <>
      {visible.map((btn) => {
        const { isOn, toggle, badge } = getState(btn.id);
        return (
          <button
            key={btn.id}
            onClick={toggle}
            aria-pressed={isOn}
            className={`relative flex items-center justify-center gap-1 rounded-lg font-bold
              transition-all duration-200 cursor-pointer
              ${isMobile ? 'min-w-[44px] min-h-[44px] px-2.5 py-2 text-base' : 'px-2.5 py-1 text-[11px]'}
              ${isOn
                ? 'bg-teal-500/25 border border-teal-400/50 text-teal-300 shadow-[0_0_10px_rgba(20,184,166,0.25)]'
                : 'border border-slate-600/30 text-slate-500 hover:bg-slate-700/60 hover:text-slate-200 hover:border-teal-500/20'
              }`}
            title={btn.label}
          >
            <WeatherIcon id={btn.icon} size={isMobile ? 18 : 14} />
            {!isMobile && <span>{btn.label}</span>}
            {btn.alpha && (
              <span className="text-[7px] font-bold text-amber-400/80 uppercase tracking-wider">alpha</span>
            )}
            {badge && (
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 flex items-center justify-center rounded-full bg-teal-500 text-[8px] text-white font-bold">
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}

/* ─── Event/Regatta mode button ─── */

function EventModeButton({ isMobile }: { isMobile: boolean }) {
  const active = useRegattaStore((s) => s.active);

  const handleClick = () => {
    if (active) {
      useRegattaStore.getState().deactivate();
    } else {
      useRegattaStore.getState().startEvent();
      // In Embalse, aircraft are visible from the water — auto-enable aviation overlay
      const sector = useSectorStore.getState().activeSector;
      if (sector.id === 'embalse' && !useAviationStore.getState().showOverlay) {
        useAviationStore.getState().toggleOverlay();
      }
    }
  };

  return (
    <div className={`flex items-center gap-0.5 border-t border-slate-700/30 ${isMobile ? 'p-0.5' : 'px-1.5 pb-1.5 pt-1'}`}>
      <button
        onClick={handleClick}
        className={`flex items-center justify-center gap-1.5 rounded-lg font-bold
          transition-all duration-200 cursor-pointer w-full
          ${isMobile ? 'min-h-[44px] px-2.5 py-2 text-[13px]' : 'px-2.5 py-1 text-[11px]'}
          ${active
            ? 'bg-amber-500/25 border border-amber-400/50 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.25)]'
            : 'border border-amber-500/20 text-amber-400/70 bg-amber-500/5 hover:bg-amber-500/15 hover:text-amber-300'
          }`}
        title="Modo Evento / Regata"
      >
        <WeatherIcon id="sailboat" size={isMobile ? 18 : 14} />
        <span>{active ? 'Cancelar Evento' : 'Modo Evento'}</span>
        <span className="text-[7px] font-bold text-amber-400/60 uppercase">alpha</span>
      </button>
    </div>
  );
}

/* ─── Wind speed color legend (matches windSpeedColor in windUtils.ts) ─── */
function WindLegend() {
  return (
    <div className="space-y-1">
      <span className="text-[11px] text-slate-500 font-semibold">Velocidad viento (kt)</span>
      <div className="flex items-center gap-0">
        {[
          { color: '#64748b', label: '0' },
          { color: '#38bdf8', label: '6' },
          { color: '#22c55e', label: '9' },
          { color: '#a3e635', label: '13' },
          { color: '#eab308', label: '17' },
          { color: '#f97316', label: '23' },
          { color: '#ef4444', label: '23+' },
        ].map((s, i) => (
          <div key={i} className="flex-1 flex flex-col items-center">
            <div className="w-full h-2 rounded-sm" style={{ background: s.color }} />
            <span className="text-[11px] text-slate-600 mt-0.5 font-mono">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Humidity color legend (matches humidityColor() in HumidityHeatmapOverlay) ─── */
function HumidityLegend() {
  return (
    <div className="space-y-1">
      <span className="text-[11px] text-slate-500 font-semibold">Humedad relativa (%)</span>
      <div className="flex items-center gap-0">
        {[
          { color: '#ef7316', label: '0' },
          { color: '#f59e0b', label: '30' },
          { color: '#eab308', label: '50' },
          { color: '#22c55e', label: '70' },
          { color: '#3b82f6', label: '85' },
          { color: '#1e40af', label: '100' },
        ].map((s, i) => (
          <div key={i} className="flex-1 flex flex-col items-center">
            <div className="w-full h-2 rounded-sm" style={{ background: s.color }} />
            <span className="text-[11px] text-slate-600 mt-0.5 font-mono">{s.label}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-slate-500">
        <span>Seco</span>
        <span className="text-center">Medio</span>
        <span className="text-center">Húmedo</span>
        <span>Saturado</span>
      </div>
    </div>
  );
}

/* ─── (SatelliteLegend removed — EUMETSAT non-commercial license incompatible) ─── */

/* ─── Surface currents info panel ─── */
function CurrentsLegend() {
  return (
    <div className="space-y-1">
      <span className="text-[11px] text-slate-500 font-semibold inline-flex items-center gap-1"><WeatherIcon id="waves" size={10} /> RADAR ON RAIA — Corrientes superficiales</span>
      <div className="text-[11px] text-slate-400">
        Radar HF costero (INTECMAR). Flechas indican dirección y velocidad
        de corrientes superficiales. Actualización horaria (~2h retardo).
      </div>
      <div className="flex items-center gap-0">
        {[
          { color: '#0000ff', label: '0' },
          { color: '#00ccff', label: '0.1' },
          { color: '#00ff00', label: '0.2' },
          { color: '#ffff00', label: '0.3' },
          { color: '#ff8800', label: '0.4' },
          { color: '#ff0000', label: '0.5+' },
        ].map((s, i) => (
          <div key={i} className="flex-1 flex flex-col items-center">
            <div className="w-full h-2 rounded-sm" style={{ background: s.color }} />
            <span className="text-[11px] text-slate-600 mt-0.5 font-mono">{s.label}</span>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-slate-500 text-center">m/s</div>
    </div>
  );
}

/* ─── Radar info panel ─── */
function RadarLegend() {
  return (
    <div className="space-y-1">
      <span className="text-[11px] text-slate-500 font-semibold inline-flex items-center gap-1"><WeatherIcon id="radar" size={10} /> Radar</span>
      <div className="text-[11px] text-slate-400">
        AEMET nacional (estático) + RainViewer (animación 2h).
        Pulsa el botón del mapa para animar.
      </div>
      <div className="flex items-center gap-0">
        {[
          { color: '#00c8ff', label: 'Débil' },
          { color: '#00ff00', label: 'Mod.' },
          { color: '#ffff00', label: 'Fuerte' },
          { color: '#ff8000', label: 'Intensa' },
          { color: '#ff0000', label: 'Muy int.' },
          { color: '#ff00ff', label: 'Granizo' },
        ].map((s, i) => (
          <div key={i} className="flex-1 flex flex-col items-center">
            <div className="w-full h-2 rounded-sm" style={{ background: s.color }} />
            <span className="text-[11px] text-slate-600 mt-0.5">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
