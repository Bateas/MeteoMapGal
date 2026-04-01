import { memo, useEffect, useState, useCallback } from 'react';
import { useRegattaStore, type SemaphoreLevel } from '../../store/regattaStore';
import { useWeatherStore } from '../../store/weatherStore';
import { isPointInBounds } from '../../services/geoUtils';
import { msToKnots } from '../../services/windUtils';
import { degreesToCardinal } from '../../services/windUtils';

const SEMAPHORE_COLORS: Record<SemaphoreLevel, { bg: string; border: string; text: string; label: string }> = {
  green: { bg: 'bg-green-500/20', border: 'border-green-400/50', text: 'text-green-400', label: 'SEGURO' },
  yellow: { bg: 'bg-amber-500/20', border: 'border-amber-400/50', text: 'text-amber-400', label: 'PRECAUCION' },
  red: { bg: 'bg-red-500/20', border: 'border-red-400/50', text: 'text-red-400', label: 'PELIGRO' },
};

/**
 * Regatta/Event floating control panel.
 * Shows timer, zone conditions, semaphore, and action buttons.
 */
export const RegattaPanel = memo(function RegattaPanel() {
  const { active, zone, timerRunning, timerStartMs, elapsedMs, conditions, buoyMarkers } = useRegattaStore();
  const stations = useWeatherStore((s) => s.stations);
  const readings = useWeatherStore((s) => s.currentReadings);
  const [displayMs, setDisplayMs] = useState(0);

  // Timer tick
  useEffect(() => {
    if (!timerRunning) { setDisplayMs(elapsedMs); return; }
    const interval = setInterval(() => {
      setDisplayMs(elapsedMs + (Date.now() - timerStartMs));
    }, 100);
    return () => clearInterval(interval);
  }, [timerRunning, timerStartMs, elapsedMs]);

  // Compute zone conditions from stations inside bounds
  const computeConditions = useCallback(() => {
    if (!zone) return;
    const { ne, sw } = zone;
    const store = useRegattaStore.getState();

    let totalSpeed = 0, maxGust = 0, count = 0;
    const dirs: number[] = [];

    for (const st of stations) {
      if (!isPointInBounds(st.lat, st.lon, ne, sw)) continue;
      const r = readings.get(st.id);
      if (!r) continue;

      const speedKt = r.windSpeed != null ? msToKnots(r.windSpeed) : 0;
      const gustKt = r.windGust != null ? msToKnots(r.windGust) : 0;

      totalSpeed += speedKt;
      if (gustKt > maxGust) maxGust = gustKt;
      if (r.windDirection != null && r.windDirection > 0) dirs.push(r.windDirection);
      count++;
    }

    const avgWind = count > 0 ? totalSpeed / count : 0;
    const windDir = dirs.length > 0 ? Math.round(dirs.reduce((a, b) => a + b, 0) / dirs.length) : null;

    // Semaphore logic
    let semaphore: SemaphoreLevel = 'green';
    const alerts: string[] = [];

    if (avgWind > 25 || maxGust > 35) {
      semaphore = 'red';
      alerts.push(`Viento fuerte: media ${avgWind.toFixed(0)}kt, racha ${maxGust.toFixed(0)}kt`);
    } else if (avgWind > 15 || maxGust > 25) {
      semaphore = 'yellow';
      alerts.push(`Viento moderado: media ${avgWind.toFixed(0)}kt`);
    }

    if (count === 0) {
      semaphore = 'yellow';
      alerts.push('Sin estaciones en la zona seleccionada');
    }

    store.setConditions({
      avgWindKt: Math.round(avgWind * 10) / 10,
      maxGustKt: Math.round(maxGust * 10) / 10,
      windDir,
      stationsInZone: count,
      semaphore,
      alerts,
    });
  }, [zone, stations, readings]);

  // Update conditions every 10s
  useEffect(() => {
    if (!active || !zone) return;
    computeConditions();
    const interval = setInterval(computeConditions, 10_000);
    return () => clearInterval(interval);
  }, [active, zone, computeConditions]);

  if (!active || !zone) return null;

  const sem = conditions ? SEMAPHORE_COLORS[conditions.semaphore] : SEMAPHORE_COLORS.green;
  const mins = Math.floor(displayMs / 60_000);
  const secs = Math.floor((displayMs % 60_000) / 1000);
  const timerStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  return (
    <div className="absolute top-20 right-2 z-40 w-64 rounded-xl bg-slate-900/95 border border-amber-500/40 backdrop-blur-md shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-amber-500/15 border-b border-amber-500/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-amber-400 text-sm font-bold uppercase tracking-wider">Modo Evento</span>
          <span className="text-[8px] text-amber-400/60 font-bold uppercase bg-amber-500/20 px-1.5 py-0.5 rounded">alpha</span>
        </div>
        <button
          onClick={() => useRegattaStore.getState().deactivate()}
          className="text-slate-500 hover:text-red-400 text-lg leading-none cursor-pointer"
          title="Salir modo evento"
        >
          x
        </button>
      </div>

      {/* Timer */}
      <div className="px-3 py-3 border-b border-slate-700/40 text-center">
        <div className="font-mono text-3xl font-bold text-white tracking-widest">{timerStr}</div>
        <div className="flex justify-center gap-2 mt-2">
          <button
            onClick={() => useRegattaStore.getState().toggleTimer()}
            className={`px-3 py-1 rounded text-xs font-bold cursor-pointer transition-all ${
              timerRunning
                ? 'bg-red-500/25 border border-red-400/50 text-red-300'
                : 'bg-green-500/25 border border-green-400/50 text-green-300'
            }`}
          >
            {timerRunning ? 'Parar' : 'Iniciar'}
          </button>
          <button
            onClick={() => useRegattaStore.getState().resetTimer()}
            className="px-3 py-1 rounded text-xs font-bold bg-slate-700/50 border border-slate-600/50 text-slate-400 cursor-pointer hover:text-white transition-all"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Semaphore */}
      <div className={`mx-3 mt-3 px-3 py-2 rounded-lg ${sem.bg} border ${sem.border}`}>
        <div className={`text-center text-sm font-black ${sem.text}`}>
          {sem.label}
        </div>
      </div>

      {/* Conditions */}
      {conditions && (
        <div className="px-3 py-2 space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Viento medio</span>
            <span className="text-white font-bold">{conditions.avgWindKt.toFixed(1)} kt</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Racha max</span>
            <span className="text-amber-400 font-bold">{conditions.maxGustKt.toFixed(1)} kt</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Direccion</span>
            <span className="text-white font-bold">
              {conditions.windDir ? `${degreesToCardinal(conditions.windDir)} (${conditions.windDir}°)` : 'Variable'}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-500">Estaciones zona</span>
            <span className="text-teal-400 font-bold">{conditions.stationsInZone}</span>
          </div>
          {conditions.alerts.map((a, i) => (
            <div key={i} className="text-[10px] text-amber-400/80 mt-1">{a}</div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="px-3 py-2 border-t border-slate-700/40 flex gap-2">
        <button
          onClick={() => {
            if (!zone) return;
            const cLon = (zone.ne[0] + zone.sw[0]) / 2;
            const cLat = (zone.ne[1] + zone.sw[1]) / 2;
            useRegattaStore.getState().addBuoy(cLon, cLat);
          }}
          className="flex-1 px-2 py-1.5 rounded text-[10px] font-bold bg-teal-500/20 border border-teal-400/40 text-teal-300 cursor-pointer hover:bg-teal-500/30 transition-all"
        >
          + Baliza ({buoyMarkers.length})
        </button>
        <button
          onClick={() => useRegattaStore.getState().deactivate()}
          className="flex-1 px-2 py-1.5 rounded text-[10px] font-bold bg-red-500/15 border border-red-400/30 text-red-400 cursor-pointer hover:bg-red-500/25 transition-all"
        >
          Finalizar
        </button>
      </div>
    </div>
  );
});
