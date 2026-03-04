import { memo } from 'react';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import type { WeatherLayerType } from '../../store/weatherLayerStore';
import { useUIStore } from '../../store/uiStore';

// ── Layer button configs ───────────────────────────────────
// NOTE: WRF removed from map layers — only real-time data on map.
// WRF files kept (WrfOverlay.tsx, wrfWmsClient.ts) for future "Previsiones" section.

const LAYER_BUTTONS: { id: WeatherLayerType; icon: string; label: string }[] = [
  { id: 'wind-particles', icon: '💨', label: 'Viento' },
  { id: 'humidity', icon: '💧', label: 'Humedad' },
  { id: 'satellite', icon: '🛰️', label: 'Satélite' },
  { id: 'radar', icon: '📡', label: 'Radar' },
];

// ── Component ──────────────────────────────────────────────

export const WeatherLayerSelector = memo(function WeatherLayerSelector() {
  const isMobile = useUIStore((s) => s.isMobile);
  const activeLayer = useWeatherLayerStore((s) => s.activeLayer);
  const layerOpacity = useWeatherLayerStore((s) => s.layerOpacity);

  const setActiveLayer = useWeatherLayerStore((s) => s.setActiveLayer);
  const setLayerOpacity = useWeatherLayerStore((s) => s.setLayerOpacity);

  const handleLayerClick = (id: WeatherLayerType) => {
    setActiveLayer(activeLayer === id ? 'none' : id);
  };

  const isActive = activeLayer !== 'none';

  return (
    <div className="shrink-0">
      <div
        className={`bg-slate-900/85 backdrop-blur-md border border-slate-700/50 rounded-xl
          transition-all duration-200 ${isActive ? 'shadow-lg shadow-black/30' : ''}`}
      >
        {/* Expanded controls — ABOVE buttons so panel grows upward */}
        {isActive && (
          <div className={`border-b border-slate-700/40 px-3 py-2 space-y-2 ${isMobile ? 'w-64' : 'w-72'}`}>
            {/* Opacity slider */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 shrink-0">Opacidad</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(layerOpacity * 100)}
                onChange={(e) => setLayerOpacity(Number(e.target.value) / 100)}
                className="flex-1 h-1 accent-sky-500 cursor-pointer"
                aria-label="Opacidad de la capa"
              />
              <span className="text-[10px] text-slate-400 w-8 text-right font-mono">
                {Math.round(layerOpacity * 100)}%
              </span>
            </div>

            {/* ── Color legend for wind particles ── */}
            {activeLayer === 'wind-particles' && <WindLegend />}

            {/* ── Color legend for humidity ── */}
            {activeLayer === 'humidity' && <HumidityLegend />}

            {/* ── Satellite info ── */}
            {activeLayer === 'satellite' && <SatelliteLegend />}

            {/* ── Radar info ── */}
            {activeLayer === 'radar' && <RadarLegend />}

            {/* WRF removed — only real-time layers on map */}
          </div>
        )}

        {/* Layer toggle buttons — always visible, bottom row */}
        <div className={`flex items-center gap-0.5 ${isMobile ? 'p-0.5' : 'p-1.5'}`} role="group" aria-label="Capas meteorológicas">
          {LAYER_BUTTONS.map((btn) => {
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
                    ? 'bg-sky-500/25 border border-sky-400/50 text-sky-300'
                    : 'border border-transparent text-slate-400 hover:bg-slate-700/60 hover:text-slate-300'
                  }`}
                title={isMobile ? btn.label : `${btn.label} (W para ciclar)`}
              >
                <span className={isMobile ? 'text-lg' : 'text-sm'}>{btn.icon}</span>
                {!isMobile && <span>{btn.label}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});

/* ─── Wind speed color legend (matches windSpeedColor in windUtils.ts) ─── */
function WindLegend() {
  return (
    <div className="space-y-1">
      <span className="text-[9px] text-slate-500 font-semibold">Velocidad viento (kt)</span>
      <div className="flex items-center gap-0">
        {[
          { color: '#64748b', label: '0' },
          { color: '#93c5fd', label: '1' },
          { color: '#22d3ee', label: '3' },
          { color: '#22c55e', label: '6' },
          { color: '#a3e635', label: '9' },
          { color: '#eab308', label: '13' },
          { color: '#f97316', label: '17' },
          { color: '#ef4444', label: '23+' },
        ].map((s, i) => (
          <div key={i} className="flex-1 flex flex-col items-center">
            <div className="w-full h-2 rounded-sm" style={{ background: s.color }} />
            <span className="text-[7px] text-slate-600 mt-0.5 font-mono">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Humidity color legend (matches HumidityHeatmapOverlay colors) ─── */
function HumidityLegend() {
  return (
    <div className="space-y-1">
      <span className="text-[9px] text-slate-500 font-semibold">Humedad relativa (%)</span>
      <div className="h-2.5 rounded-sm overflow-hidden"
        style={{
          background: 'linear-gradient(to right, #22c55e, #22c55e 25%, #3b82f6 40%, #8b5cf6 65%, #ef4444 85%, #dc2626)',
        }}
      />
      <div className="flex justify-between text-[7px] text-slate-600 font-mono">
        <span>30%</span>
        <span>50%</span>
        <span>70%</span>
        <span>85%</span>
        <span>100%</span>
      </div>
      <div className="flex justify-between text-[7px] text-slate-500">
        <span>Seco</span>
        <span>Medio</span>
        <span>Húmedo</span>
        <span>Saturado</span>
      </div>
    </div>
  );
}

/* ─── Satellite info panel ─── */
function SatelliteLegend() {
  return (
    <div className="space-y-1">
      <span className="text-[9px] text-slate-500 font-semibold">🛰️ EUMETSAT Meteosat (IR 10.8μm)</span>
      <div className="text-[9px] text-slate-400">
        Imagen infrarroja cada 15 min. Nubes brillantes = altas/frías (cumulonimbus).
        Oscuro = cielo despejado o nubes bajas.
      </div>
      <div className="flex items-center gap-2 mt-1">
        <div className="flex items-center gap-1">
          <div className="w-3 h-2 rounded-sm bg-white border border-slate-600" />
          <span className="text-[8px] text-slate-500">Cb alto</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-2 rounded-sm bg-gray-400" />
          <span className="text-[8px] text-slate-500">Nubes medias</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-2 rounded-sm bg-gray-700 border border-slate-600" />
          <span className="text-[8px] text-slate-500">Despejado</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Radar info panel ─── */
function RadarLegend() {
  return (
    <div className="space-y-1">
      <span className="text-[9px] text-slate-500 font-semibold">📡 AEMET Radar de Cuntis (Galicia)</span>
      <div className="text-[9px] text-slate-400">
        Radar regional cada 10 min. Radio ~240 km.
        Colores indican reflectividad (intensidad de precipitación).
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
            <span className="text-[7px] text-slate-600 mt-0.5">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
