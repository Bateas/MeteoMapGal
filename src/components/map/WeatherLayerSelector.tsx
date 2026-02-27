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

  return (
    <div className="absolute bottom-14 left-44 z-20 flex flex-col gap-1.5">
      {/* Layer toggle buttons */}
      <div className="flex items-center gap-1">
        {LAYER_BUTTONS.map((btn) => {
          const isOn = activeLayer === btn.id;
          return (
            <button
              key={btn.id}
              onClick={() => handleLayerClick(btn.id)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold
                backdrop-blur-md transition-all duration-200 cursor-pointer
                ${isOn
                  ? 'bg-sky-500/25 border border-sky-400/50 text-sky-300 shadow-[0_0_12px_rgba(14,165,233,0.25)]'
                  : 'bg-slate-800/60 border border-slate-600/40 text-slate-400 hover:bg-slate-700/60 hover:text-slate-300'
                }`}
              title={`${btn.label} (W para ciclar)`}
            >
              <span className="text-sm">{btn.icon}</span>
              <span>{btn.label}</span>
            </button>
          );
        })}
      </div>

      {/* Controls panel — visible when any layer is active */}
      {activeLayer !== 'none' && (
        <div className="bg-slate-900/80 backdrop-blur-md border border-slate-700/50 rounded-lg px-3 py-2 space-y-2 max-w-xs">
          {/* Opacity slider */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 w-14">Opacidad</span>
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

          {/* WRF-specific controls */}
          {activeLayer === 'wrf' && (
            <>
              {/* Variable selector */}
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
  );
});
