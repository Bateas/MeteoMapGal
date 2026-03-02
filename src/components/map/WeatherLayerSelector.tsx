import { memo, useEffect } from 'react';
import { useWeatherLayerStore, WRF_VARIABLES } from '../../store/weatherLayerStore';
import type { WeatherLayerType, WrfVariable } from '../../store/weatherLayerStore';
import { resolveAvailableRun } from '../../api/wrfWmsClient';

// ── Layer button configs ───────────────────────────────────

const LAYER_BUTTONS: { id: WeatherLayerType; icon: string; label: string }[] = [
  { id: 'wind-particles', icon: '💨', label: 'Viento' },
  { id: 'humidity', icon: '💧', label: 'Humedad' },
  { id: 'wrf', icon: '🌧️', label: 'WRF' },
];

// ── Component ──────────────────────────────────────────────

export const WeatherLayerSelector = memo(function WeatherLayerSelector() {
  const activeLayer = useWeatherLayerStore((s) => s.activeLayer);
  const layerOpacity = useWeatherLayerStore((s) => s.layerOpacity);
  const wrfVariable = useWeatherLayerStore((s) => s.wrfVariable);
  const wrfTimeIndex = useWeatherLayerStore((s) => s.wrfTimeIndex);
  const wrfAvailableTimes = useWeatherLayerStore((s) => s.wrfAvailableTimes);
  const wrfLoading = useWeatherLayerStore((s) => s.wrfLoading);

  const setActiveLayer = useWeatherLayerStore((s) => s.setActiveLayer);
  const setLayerOpacity = useWeatherLayerStore((s) => s.setLayerOpacity);
  const setWrfVariable = useWeatherLayerStore((s) => s.setWrfVariable);
  const setWrfTimeIndex = useWeatherLayerStore((s) => s.setWrfTimeIndex);
  const setWrfAvailableTimes = useWeatherLayerStore((s) => s.setWrfAvailableTimes);
  const setWrfLoading = useWeatherLayerStore((s) => s.setWrfLoading);

  // Resolve WRF model run when WRF layer becomes active
  useEffect(() => {
    if (activeLayer !== 'wrf') return;
    if (wrfAvailableTimes.length > 0) return; // already loaded

    let cancelled = false;
    setWrfLoading(true);

    resolveAvailableRun().then((result) => {
      if (cancelled) return;
      if (result) {
        setWrfAvailableTimes(result.timeSteps, result.modelRun);
      }
      setWrfLoading(false);
    });

    return () => { cancelled = true; };
  }, [activeLayer, wrfAvailableTimes.length, setWrfAvailableTimes, setWrfLoading]);

  const handleLayerClick = (id: WeatherLayerType) => {
    setActiveLayer(activeLayer === id ? 'none' : id);
  };

  const isActive = activeLayer !== 'none';

  return (
    <div className="absolute bottom-3 left-44 z-20">
      <div
        className={`bg-slate-900/85 backdrop-blur-md border border-slate-700/50 rounded-xl
          transition-all duration-200 ${isActive ? 'shadow-lg shadow-black/30' : ''}`}
      >
        {/* Layer toggle buttons — always visible, top row */}
        <div className="flex items-center gap-0.5 p-1.5">
          {LAYER_BUTTONS.map((btn) => {
            const isOn = activeLayer === btn.id;
            return (
              <button
                key={btn.id}
                onClick={() => handleLayerClick(btn.id)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold
                  transition-all duration-200 cursor-pointer
                  ${isOn
                    ? 'bg-sky-500/25 border border-sky-400/50 text-sky-300'
                    : 'border border-transparent text-slate-400 hover:bg-slate-700/60 hover:text-slate-300'
                  }`}
                title={`${btn.label} (W para ciclar)`}
              >
                <span className="text-sm">{btn.icon}</span>
                <span>{btn.label}</span>
              </button>
            );
          })}
        </div>

        {/* Expanded controls — only when a layer is active */}
        {isActive && (
          <div className="border-t border-slate-700/40 px-3 py-2 space-y-2 w-72">
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
              />
              <span className="text-[10px] text-slate-400 w-8 text-right font-mono">
                {Math.round(layerOpacity * 100)}%
              </span>
            </div>

            {/* ── Color legend for wind particles ── */}
            {activeLayer === 'wind-particles' && <WindLegend />}

            {/* ── Color legend for humidity ── */}
            {activeLayer === 'humidity' && <HumidityLegend />}

            {/* ── WRF-specific controls ── */}
            {activeLayer === 'wrf' && (
              <>
                {/* Variable selector — compact grid */}
                <div className="flex flex-wrap gap-1">
                  {WRF_VARIABLES.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setWrfVariable(v.id as WrfVariable)}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-semibold transition-colors cursor-pointer
                        ${wrfVariable === v.id
                          ? 'bg-sky-500/30 text-sky-300 border border-sky-400/40'
                          : 'bg-slate-800 text-slate-500 hover:text-slate-300 border border-slate-700'
                        }`}
                      title={`${v.label} (${v.unit})`}
                    >
                      {v.icon} {v.label}
                    </button>
                  ))}
                </div>

                {/* Time scrubber */}
                {wrfAvailableTimes.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500">Tiempo</span>
                      <span className="text-[10px] text-sky-300 font-mono">
                        {wrfAvailableTimes[wrfTimeIndex]?.label ?? '—'}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={wrfAvailableTimes.length - 1}
                      value={wrfTimeIndex}
                      onChange={(e) => setWrfTimeIndex(Number(e.target.value))}
                      className="w-full h-1 accent-sky-500 cursor-pointer"
                    />
                    <div className="flex justify-between text-[8px] text-slate-600">
                      <span>{wrfAvailableTimes[0]?.label}</span>
                      <span>{wrfAvailableTimes[wrfAvailableTimes.length - 1]?.label}</span>
                    </div>
                  </div>
                )}

                {/* WRF rainbow legend */}
                <WrfLegend variable={wrfVariable} />

                {wrfLoading && (
                  <div className="text-[10px] text-slate-500 animate-pulse">
                    Cargando modelo WRF...
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

/* ─── Wind speed color legend (matches windSpeedColor in windUtils.ts) ─── */
function WindLegend() {
  return (
    <div className="space-y-1">
      <span className="text-[9px] text-slate-500 font-semibold">Escala Beaufort (kt)</span>
      <div className="flex items-center gap-0">
        {[
          { color: '#64748b', label: '0' },
          { color: '#22d3ee', label: '4' },
          { color: '#22c55e', label: '7' },
          { color: '#eab308', label: '11' },
          { color: '#f97316', label: '17' },
          { color: '#ef4444', label: '22' },
          { color: '#991b1b', label: '34' },
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

/* ─── WRF rainbow legend (ncWMS boxfill/rainbow) ─── */
function WrfLegend({ variable }: { variable: WrfVariable }) {
  const varInfo = WRF_VARIABLES.find((v) => v.id === variable);
  if (!varInfo) return null;

  return (
    <div className="space-y-1">
      <span className="text-[9px] text-slate-500 font-semibold">
        {varInfo.label} ({varInfo.unit})
      </span>
      <div
        className="h-2.5 rounded-sm overflow-hidden"
        style={{
          background: 'linear-gradient(to right, #00008b, #0000ff, #00ffff, #00ff00, #ffff00, #ff8800, #ff0000, #8b0000)',
        }}
      />
      <div className="flex justify-between text-[7px] text-slate-600 font-mono">
        <span>{varInfo.range[0]}</span>
        <span>{Math.round((varInfo.range[0] + varInfo.range[1]) / 2)}</span>
        <span>{varInfo.range[1]}</span>
      </div>
    </div>
  );
}
