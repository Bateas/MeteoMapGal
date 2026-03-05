import { useState, useEffect } from 'react';
import { useWeatherStore } from '../../store/weatherStore';
import { useUIStore } from '../../store/uiStore';
import { msToKnots, windSpeedColor, degreesToCardinal } from '../../services/windUtils';
import { WeatherIcon } from '../icons/WeatherIcons';

/**
 * Full-screen "big numbers" wind display.
 * Toggle with 'B' key or button. Shows wind from the selected station
 * (or best wind station) in giant typography for glancing at from distance.
 */
export function BigWindDisplay() {
  const [open, setOpen] = useState(false);
  const isMobile = useUIStore((s) => s.isMobile);
  const stations = useWeatherStore((s) => s.stations);
  const readings = useWeatherStore((s) => s.currentReadings);
  const selectedStationId = useWeatherStore((s) => s.selectedStationId);

  // Listen for 'B' key (desktop only)
  useEffect(() => {
    if (isMobile) return;
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key.toLowerCase() === 'b') setOpen((o) => !o);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMobile]);

  // Mobile FAB: floating wind button in bottom-left when no big display is open
  if (!open && isMobile) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed z-30 bottom-20 left-3 p-2.5 rounded-full bg-slate-800/90 backdrop-blur-sm border border-slate-700/50 text-slate-400 active:bg-slate-700 shadow-lg"
        style={{ paddingBottom: 'calc(0.625rem + env(safe-area-inset-bottom, 0px))' }}
        aria-label="Vista grande de viento"
        title="Vista grande de viento"
      >
        <WeatherIcon id="wind" size={20} />
      </button>
    );
  }

  if (!open) return null;

  // Find the station to show: selected, or best wind among valley stations
  let stationId = selectedStationId;
  if (!stationId) {
    let bestKt = 0;
    for (const s of stations) {
      if (s.tempOnly || s.altitude > 400) continue;
      const r = readings.get(s.id);
      if (!r || r.windSpeed === null) continue;
      const kt = msToKnots(r.windSpeed);
      if (kt > bestKt) {
        bestKt = kt;
        stationId = s.id;
      }
    }
  }

  const station = stations.find((s) => s.id === stationId);
  const reading = stationId ? readings.get(stationId) : undefined;

  if (!station || !reading) {
    return (
      <div
        className="fixed inset-0 z-50 bg-slate-950/95 flex items-center justify-center cursor-pointer"
        onClick={() => setOpen(false)}
      >
        <div className="text-center">
          <div className="text-2xl text-slate-500 mb-4">Sin datos de viento</div>
          <div className="text-xs text-slate-600">{isMobile ? 'Toca para cerrar' : 'Pulsa B o toca para cerrar'}</div>
        </div>
      </div>
    );
  }

  const speedKt = reading.windSpeed !== null ? msToKnots(reading.windSpeed) : null;
  const gustKt = reading.windGust !== null ? msToKnots(reading.windGust) : null;
  const dir = reading.windDirection;
  const cardinal = dir !== null ? degreesToCardinal(dir) : '--';
  const color = windSpeedColor(reading.windSpeed);

  // Arrow pointing where wind goes TO (meteorological "from" + 180)
  const arrowRotation = dir !== null ? (dir + 180) % 360 : 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/95 flex items-center justify-center cursor-pointer select-none"
      onClick={() => setOpen(false)}
    >
      <div className="flex flex-col items-center gap-4">
        {/* Station name */}
        <div className="text-sm text-slate-500 uppercase tracking-widest">
          {station.name}
        </div>

        {/* Giant wind direction arrow */}
        {dir !== null && (
          <svg width="100" height="100" viewBox="0 0 100 100" className="opacity-60">
            <g transform={`rotate(${arrowRotation} 50 50)`}>
              <line x1="50" y1="85" x2="50" y2="15" stroke={color} strokeWidth="4" strokeLinecap="round" />
              <polygon points="50,10 38,30 62,30" fill={color} />
            </g>
          </svg>
        )}

        {/* Giant wind speed */}
        <div className="flex items-baseline gap-3">
          <span
            className="font-black leading-none"
            style={{ color, fontSize: 'clamp(4rem, 15vw, 10rem)' }}
          >
            {speedKt !== null ? speedKt.toFixed(0) : '--'}
          </span>
          <span className="text-3xl font-light text-slate-500">kt</span>
        </div>

        {/* Direction text */}
        <div className="text-2xl font-semibold text-slate-400">
          {cardinal} {dir !== null ? `${dir.toFixed(0)}°` : ''}
        </div>

        {/* Gust (if available) */}
        {gustKt !== null && gustKt > 0 && (
          <div className="text-lg text-slate-600">
            Racha {gustKt.toFixed(0)} kt
          </div>
        )}

        {/* Temp + Humidity */}
        <div className="flex gap-6 text-lg text-slate-500 mt-2">
          {reading.temperature !== null && (
            <span>{reading.temperature.toFixed(1)}°C</span>
          )}
          {reading.humidity !== null && (
            <span>HR {Math.round(reading.humidity)}%</span>
          )}
        </div>

        {/* Hint to close */}
        <div className="text-xs text-slate-700 mt-4">
          {isMobile ? 'Toca para cerrar' : 'Pulsa B o toca para cerrar'}
        </div>
      </div>
    </div>
  );
}
