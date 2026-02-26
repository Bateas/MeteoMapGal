import { useMemo, useState } from 'react';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { msToKnots, degreesToCardinal, windSpeedColor } from '../../services/windUtils';
import type { HourlyForecast } from '../../types/forecast';

// ── Time range selector ──────────────────────────────────
const RANGES = [
  { label: '12h', hours: 12 },
  { label: '24h', hours: 24 },
  { label: '48h', hours: 48 },
] as const;

// ── Wind speed bar max (kt) ──────────────────────────────
const MAX_WIND_KT = 25;

// ── Helpers ──────────────────────────────────────────────

function formatHour(d: Date): string {
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDay(d: Date): string {
  return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric' });
}

function precipColor(mm: number): string {
  if (mm < 0.5) return 'bg-transparent';
  if (mm < 2) return 'bg-sky-400/60';
  if (mm < 5) return 'bg-blue-500/70';
  if (mm < 10) return 'bg-blue-600/80';
  return 'bg-indigo-600/90';
}

function cloudIcon(cover: number | null): string {
  if (cover === null) return '';
  if (cover < 15) return '☀️';
  if (cover < 40) return '🌤️';
  if (cover < 70) return '⛅';
  if (cover < 90) return '🌥️';
  return '☁️';
}

/** Small inline SVG arrow pointing wind direction (meteorological "to") */
function WindArrow({ dir, size = 14 }: { dir: number | null; size?: number }) {
  if (dir === null) return <span className="text-slate-600">—</span>;
  const rotation = (dir + 180) % 360; // "from" → "to"
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className="inline-block"
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <path d="M8 2 L12 10 L8 8 L4 10 Z" fill="currentColor" />
    </svg>
  );
}

// ── Forecast row ──────────────────────────────────────────

function ForecastRow({ point, showDate }: { point: HourlyForecast; showDate: boolean }) {
  const kt = point.windSpeed !== null ? msToKnots(point.windSpeed) : null;
  const gustKt = point.windGusts !== null ? msToKnots(point.windGusts) : null;
  const barWidth = kt !== null ? Math.min((kt / MAX_WIND_KT) * 100, 100) : 0;
  const gustWidth = gustKt !== null ? Math.min((gustKt / MAX_WIND_KT) * 100, 100) : 0;
  const barColor = point.windSpeed !== null ? windSpeedColor(point.windSpeed) : '#475569';
  const cardinal = point.windDirection !== null ? degreesToCardinal(point.windDirection) : '';
  const precip = point.precipitation ?? 0;
  const precipProb = point.precipProbability ?? 0;

  return (
    <div
      className={`grid grid-cols-[52px_28px_1fr_42px_36px_36px_24px] gap-1 items-center px-2 py-[3px] text-xs
        ${!point.isDay ? 'bg-slate-800/40' : ''}
        ${showDate ? 'border-t border-slate-600' : 'border-t border-slate-800/50'}
        hover:bg-slate-700/30 transition-colors`}
    >
      {/* Time */}
      <div className="text-slate-400 tabular-nums">
        {showDate && (
          <span className="text-slate-500 text-[10px] block leading-tight">
            {formatDay(point.time)}
          </span>
        )}
        {formatHour(point.time)}
      </div>

      {/* Wind arrow + cardinal */}
      <div className="flex items-center gap-0.5 text-slate-300" title={`${cardinal} ${point.windDirection ?? '—'}°`}>
        <WindArrow dir={point.windDirection} />
      </div>

      {/* Wind speed bar */}
      <div className="relative h-4 bg-slate-800 rounded overflow-hidden">
        {/* Gust bar (lighter, behind) */}
        {gustWidth > barWidth && (
          <div
            className="absolute top-0 left-0 h-full rounded opacity-30"
            style={{ width: `${gustWidth}%`, backgroundColor: barColor }}
          />
        )}
        {/* Speed bar */}
        <div
          className="absolute top-0 left-0 h-full rounded"
          style={{ width: `${barWidth}%`, backgroundColor: barColor }}
        />
        {/* Label inside bar */}
        {kt !== null && kt >= 1 && (
          <span className="absolute inset-0 flex items-center px-1.5 text-[10px] font-semibold text-white drop-shadow-sm">
            {kt.toFixed(0)} kt
            {gustKt !== null && gustKt - (kt ?? 0) > 2 && (
              <span className="ml-1 text-slate-300/80">({gustKt.toFixed(0)})</span>
            )}
          </span>
        )}
      </div>

      {/* Temperature */}
      <div className="text-right tabular-nums">
        {point.temperature !== null ? (
          <span className={point.temperature >= 30 ? 'text-orange-400' : point.temperature <= 5 ? 'text-cyan-400' : 'text-slate-200'}>
            {point.temperature.toFixed(0)}°
          </span>
        ) : '—'}
      </div>

      {/* Humidity */}
      <div className="text-right tabular-nums text-slate-400">
        {point.humidity !== null ? `${point.humidity.toFixed(0)}%` : '—'}
      </div>

      {/* Precipitation */}
      <div className="text-right tabular-nums">
        {precip > 0.1 ? (
          <span className="text-sky-400">{precip.toFixed(1)}</span>
        ) : precipProb > 30 ? (
          <span className="text-sky-700 text-[10px]">{precipProb}%</span>
        ) : (
          <span className="text-slate-700">·</span>
        )}
      </div>

      {/* Cloud icon */}
      <div className="text-center text-[11px]" title={`Nubes: ${point.cloudCover ?? '—'}%`}>
        {cloudIcon(point.cloudCover)}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────

export function ForecastTimeline() {
  const hourly = useForecastStore((s) => s.hourly);
  const fetchedAt = useForecastStore((s) => s.fetchedAt);
  const isLoading = useForecastStore((s) => s.isLoading);
  const error = useForecastStore((s) => s.error);
  const [range, setRange] = useState(24);

  // Filter data by selected time range
  const visibleData = useMemo(() => {
    if (hourly.length === 0) return [];
    const now = new Date();
    const cutoff = new Date(now.getTime() + range * 60 * 60 * 1000);
    // Include past hours too (up to 6h back)
    const startCutoff = new Date(now.getTime() - 6 * 60 * 60 * 1000);
    return hourly.filter(
      (p) => p.time >= startCutoff && p.time <= cutoff,
    );
  }, [hourly, range]);

  // Find the "now" index for highlighting
  const nowIndex = useMemo(() => {
    const now = Date.now();
    let closest = 0;
    let minDelta = Infinity;
    for (let i = 0; i < visibleData.length; i++) {
      const delta = Math.abs(visibleData[i].time.getTime() - now);
      if (delta < minDelta) {
        minDelta = delta;
        closest = i;
      }
    }
    return closest;
  }, [visibleData]);

  // Sailing conditions summary
  const sailingSummary = useMemo(() => {
    if (visibleData.length === 0) return null;
    const future = visibleData.filter((p) => p.time.getTime() > Date.now());
    if (future.length === 0) return null;

    // Find best wind window in the next hours
    let bestKt = 0;
    let bestTime: Date | null = null;
    let rainHours = 0;

    for (const p of future) {
      const kt = p.windSpeed !== null ? msToKnots(p.windSpeed) : 0;
      if (kt > bestKt) {
        bestKt = kt;
        bestTime = p.time;
      }
      if ((p.precipitation ?? 0) > 0.5) rainHours++;
    }

    return { bestKt, bestTime, rainHours, totalHours: future.length };
  }, [visibleData]);

  if (error && hourly.length === 0) {
    return (
      <div className="text-red-400 text-xs p-2 bg-red-950/30 rounded">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-200">
            Previsión Embalse
          </h3>
          {isLoading && (
            <div className="w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
          )}
        </div>

        {/* Time range buttons */}
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.hours}
              onClick={() => setRange(r.hours)}
              className={`px-2 py-0.5 text-[10px] font-semibold rounded transition-colors ${
                range === r.hours
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Sailing summary */}
      {sailingSummary && sailingSummary.bestKt > 0 && (
        <div className="mb-2 px-2 py-1.5 bg-slate-800/60 rounded text-[11px] text-slate-300 flex items-center gap-2">
          <span>🏄</span>
          <div>
            Mejor viento:{' '}
            <span className="text-white font-semibold">{sailingSummary.bestKt.toFixed(0)} kt</span>
            {sailingSummary.bestTime && (
              <span> a las {formatHour(sailingSummary.bestTime)}</span>
            )}
            {sailingSummary.rainHours > 0 && (
              <span className="text-sky-400 ml-2">
                🌧 {sailingSummary.rainHours}h lluvia
              </span>
            )}
          </div>
        </div>
      )}

      {/* Column header */}
      <div className="grid grid-cols-[52px_28px_1fr_42px_36px_36px_24px] gap-1 px-2 py-1 text-[10px] text-slate-500 uppercase tracking-wider border-b border-slate-700">
        <span>Hora</span>
        <span>Dir</span>
        <span>Viento</span>
        <span className="text-right">°C</span>
        <span className="text-right">HR</span>
        <span className="text-right">mm</span>
        <span className="text-center">☁</span>
      </div>

      {/* Timeline rows */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {visibleData.length === 0 && !isLoading && (
          <div className="text-slate-500 text-xs text-center py-8">
            Sin datos de previsión
          </div>
        )}

        {visibleData.map((point, i) => {
          // Show date label on first row and when day changes
          const prevDay = i > 0 ? visibleData[i - 1].time.getDate() : -1;
          const showDate = i === 0 || point.time.getDate() !== prevDay;

          return (
            <div
              key={point.time.getTime()}
              className={i === nowIndex ? 'relative' : ''}
            >
              {/* "Now" indicator */}
              {i === nowIndex && (
                <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-blue-500 z-10" />
              )}
              <ForecastRow point={point} showDate={showDate} />
            </div>
          );
        })}
      </div>

      {/* Footer */}
      {fetchedAt && (
        <div className="text-[10px] text-slate-600 text-center py-1 border-t border-slate-800">
          Open-Meteo · Actualizado {formatHour(fetchedAt)}
        </div>
      )}
    </div>
  );
}
