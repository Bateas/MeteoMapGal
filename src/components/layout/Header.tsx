import { useMemo } from 'react';
import { LastUpdated } from '../common/LastUpdated';
import { SourceStatusIndicator } from '../common/SourceStatusIndicator';
import { useWeatherStore } from '../../store/weatherStore';
import { useSectorStore } from '../../store/sectorStore';
import { useThermalStore } from '../../store/thermalStore';
import { getSunTimes, formatTime, isDaylight } from '../../services/solarUtils';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { scoreForecastThermal, thermalColor } from '../../services/forecastScoringUtils';
import { useUIStore } from '../../store/uiStore';

interface HeaderProps {
  onRefresh: () => void;
  fieldDrawerOpen?: boolean;
  onToggleFieldDrawer?: () => void;
  fieldAlertLevel?: 'none' | 'riesgo' | 'alto' | 'critico';
}

export function Header({ onRefresh, fieldDrawerOpen, onToggleFieldDrawer, fieldAlertLevel = 'none' }: HeaderProps) {
  const stationCount = useWeatherStore((s) => s.stations.length);
  const readingCount = useWeatherStore((s) => s.currentReadings.size);
  const activeSector = useSectorStore((s) => s.activeSector);
  const isEmbalse = activeSector.id === 'embalse';
  const forecastHourly = useForecastStore((s) => s.hourly);
  const thermalRules = useThermalStore((s) => s.rules);
  const isMobile = useUIStore((s) => s.isMobile);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  const sun = useMemo(() => getSunTimes(new Date(), activeSector.center), [activeSector.center]);
  const daylight = isDaylight(new Date(), activeSector.center);

  const nextSailingWindow = useMemo(() => {
    if (forecastHourly.length === 0 || thermalRules.length === 0) return null;

    const now = Date.now();
    // Find all future forecast temps for deltaT computation
    const futurePoints = forecastHourly.filter(p => p.time.getTime() > now);
    if (futurePoints.length === 0) return null;

    // Compute deltaT from min/max temps in forecast
    const temps = futurePoints
      .map(p => p.temperature)
      .filter((t): t is number => t !== null);
    const deltaT = temps.length >= 2 ? Math.max(...temps) - Math.min(...temps) : null;

    // Score each future point
    let bestScore = 0;
    let bestPoint: typeof futurePoints[0] | null = null;

    for (const point of futurePoints) {
      const result = scoreForecastThermal(point, thermalRules, deltaT);
      if (result.score > bestScore) {
        bestScore = result.score;
        bestPoint = point;
      }
    }

    if (!bestPoint || bestScore < 40) return null;

    return {
      time: bestPoint.time,
      score: Math.round(bestScore),
      color: thermalColor(bestScore),
    };
  }, [forecastHourly, thermalRules]);

  return (
    <header className="bg-slate-900 border-b border-slate-700 px-2 md:px-4 py-2 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 md:gap-3 min-w-0">
        {/* Hamburger — mobile only */}
        {isMobile && (
          <button
            onClick={toggleSidebar}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors flex-shrink-0"
            aria-label="Abrir panel lateral"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}

        <h1 className="text-sm md:text-base font-bold text-white tracking-tight flex-shrink-0">
          MeteoMap
        </h1>
        <span className="text-[10px] text-slate-500 font-medium truncate">
          {activeSector.icon} {isMobile ? '' : activeSector.name}
        </span>
        {stationCount > 0 && (
          <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded flex-shrink-0">
            {readingCount}/{stationCount}
          </span>
        )}
        {/* Source status — hide on mobile */}
        {!isMobile && <SourceStatusIndicator />}
        {!isMobile && (
          <button
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }))}
            className="text-[10px] text-slate-500 hover:text-blue-400 transition-colors px-1.5 py-0.5 rounded hover:bg-slate-800"
            title="Guía meteorológica (G)"
          >
            📖
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5 md:gap-3 flex-shrink-0">
        {/* Sunrise / Sunset — hide on very small mobile */}
        <div
          className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded"
          style={{
            background: daylight ? 'rgba(250, 204, 21, 0.08)' : 'rgba(100, 116, 139, 0.1)',
            color: daylight ? '#facc15' : '#64748b',
            border: `1px solid ${daylight ? 'rgba(250, 204, 21, 0.2)' : 'rgba(100, 116, 139, 0.15)'}`,
          }}
          title={`Mediodía solar: ${formatTime(sun.solarNoon)} | Térmico: ${formatTime(sun.thermalStart)}–${formatTime(sun.thermalEnd)}`}
        >
          <span>{daylight ? '\u2600' : '\u263E'}</span>
          <span>{formatTime(sun.sunrise)}</span>
          <span className="text-slate-600">/</span>
          <span>{formatTime(sun.sunset)}</span>
        </div>

        {/* Alerts drawer button */}
        {onToggleFieldDrawer && (
          <button
            onClick={onToggleFieldDrawer}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
              fieldDrawerOpen
                ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                : fieldAlertLevel !== 'none'
                ? 'bg-slate-800 border animate-pulse'
                : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
            }`}
            style={
              !fieldDrawerOpen && fieldAlertLevel !== 'none'
                ? {
                    color: fieldAlertLevel === 'critico' ? '#ef4444' : fieldAlertLevel === 'alto' ? '#f59e0b' : '#3b82f6',
                    borderColor: fieldAlertLevel === 'critico' ? 'rgba(239,68,68,0.3)' : fieldAlertLevel === 'alto' ? 'rgba(245,158,11,0.3)' : 'rgba(59,130,246,0.3)',
                  }
                : undefined
            }
            title="Panel de alertas (C)"
          >
            <span>{isMobile ? '⚠' : 'Alertas'}</span>
          </button>
        )}

        {/* Next sailing window banner (Embalse only — hide on mobile) */}
        {!isMobile && isEmbalse && nextSailingWindow && (
          <div
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono"
            style={{
              background: `${nextSailingWindow.color}12`,
              border: `1px solid ${nextSailingWindow.color}30`,
              color: nextSailingWindow.color,
            }}
            title={`Mejor ventana térmica en las próximas 48h: ${nextSailingWindow.score}%`}
          >
            <span>⛵</span>
            <span className="font-semibold">{nextSailingWindow.score}%</span>
            <span className="text-slate-500 text-[9px]">
              {nextSailingWindow.time.toLocaleDateString('es-ES', { weekday: 'short' })}{' '}
              {nextSailingWindow.time.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}

        <LastUpdated onRefresh={onRefresh} />
      </div>
    </header>
  );
}
