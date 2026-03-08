import { useMemo } from 'react';
import { LastUpdated } from '../common/LastUpdated';
import { SourceStatusIndicator } from '../common/SourceStatusIndicator';
import { WeatherIcon } from '../icons/WeatherIcons';
import { useWeatherStore } from '../../store/weatherStore';
import { useSectorStore } from '../../store/sectorStore';
import { useThermalStore } from '../../store/thermalStore';
import { getSunTimes, formatTime, isDaylight } from '../../services/solarUtils';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { scoreForecastThermal, thermalColor } from '../../services/forecastScoringUtils';
import { useUIStore } from '../../store/uiStore';
import { APP_VERSION } from '../../config/version';

interface WindFrontInfo {
  active: boolean;
  etaMin: number | null;
  directionLabel: string;
  frontSpeedKt: number;
}

interface HeaderProps {
  onRefresh: () => void;
  fieldDrawerOpen?: boolean;
  onToggleFieldDrawer?: () => void;
  fieldAlertLevel?: 'none' | 'riesgo' | 'alto' | 'critico';
  windFront?: WindFrontInfo | null;
}

export function Header({ onRefresh, fieldDrawerOpen, onToggleFieldDrawer, fieldAlertLevel = 'none', windFront }: HeaderProps) {
  const stationCount = useWeatherStore((s) => s.stations.length);
  const readingCount = useWeatherStore((s) => s.currentReadings.size);
  const activeSector = useSectorStore((s) => s.activeSector);
  const isEmbalse = activeSector.id === 'embalse';
  const forecastHourly = useForecastStore((s) => s.hourly);
  const thermalRules = useThermalStore((s) => s.rules);
  const isMobile = useUIStore((s) => s.isMobile);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  const sun = useMemo(() => getSunTimes(new Date(), activeSector.center), [activeSector.center]);
  const daylight = useMemo(() => {
    const now = new Date();
    return now >= sun.sunrise && now <= sun.sunset;
  }, [sun.sunrise, sun.sunset]);

  const nextSailingWindow = useMemo(() => {
    if (forecastHourly.length === 0 || thermalRules.length === 0) return null;

    const now = Date.now();
    const futurePoints = forecastHourly.filter(p => p.time.getTime() > now);
    if (futurePoints.length === 0) return null;

    const temps = futurePoints
      .map(p => p.temperature)
      .filter((t): t is number => t !== null);
    const deltaT = temps.length >= 2 ? Math.max(...temps) - Math.min(...temps) : null;

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
    <header className="bg-slate-900 border-b border-slate-700 px-3 md:px-4 py-2 md:py-2 flex items-center justify-between gap-1.5 md:gap-2">
      <div className="flex items-center gap-2 md:gap-3 min-w-0">
        {/* Hamburger — mobile only, 44px touch target */}
        {isMobile && (
          <button
            onClick={toggleSidebar}
            className="p-2.5 -m-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors flex-shrink-0 active:bg-slate-700"
            aria-label="Abrir panel lateral"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}

        <h1 className="text-sm md:text-base font-bold text-white tracking-tight flex-shrink-0">
          MeteoMapGal
          <span className="text-[9px] font-normal text-slate-600 ml-1">v{APP_VERSION}</span>
        </h1>
        {!isMobile && (
          <span className="text-[10px] text-slate-500 font-medium truncate inline-flex items-center gap-1">
            <WeatherIcon id={activeSector.icon} size={12} /> {activeSector.name}
          </span>
        )}
        {stationCount > 0 && (
          <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded flex-shrink-0">
            {readingCount}/{stationCount}
          </span>
        )}
        {/* Source status — hide on mobile */}
        {!isMobile && <SourceStatusIndicator />}
        <button
          onClick={() => useUIStore.getState().toggleGuide()}
          className={`btn-guide-glow transition-colors rounded-lg hover:bg-slate-800/60 ${
            isMobile ? 'p-2 active:bg-slate-700 min-w-[40px] min-h-[40px] flex items-center justify-center' : 'text-[10px] px-2 py-1'
          }`}
          title={isMobile ? 'Guía meteorológica' : 'Guía meteorológica (G)'}
          aria-label="Abrir guía meteorológica"
        >
          <WeatherIcon id="book-open" size={isMobile ? 18 : 14} />
        </button>
      </div>
      <div className="flex items-center gap-1 md:gap-3 flex-shrink-0">
        {/* Sunrise / Sunset — hide on mobile */}
        <div
          className="hidden md:flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded"
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

        {/* Alerts drawer button — 44px touch target on mobile */}
        {onToggleFieldDrawer && (
          <button
            onClick={onToggleFieldDrawer}
            className={`flex items-center gap-1 rounded font-semibold transition-colors
              ${isMobile ? 'px-3 py-2 text-xs' : 'px-2 py-0.5 text-[10px]'}
              ${fieldDrawerOpen
                ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                : fieldAlertLevel !== 'none'
                ? 'bg-slate-800 border animate-pulse'
                : 'btn-panel-glow bg-slate-800/60'
              }`}
            style={
              !fieldDrawerOpen && fieldAlertLevel !== 'none'
                ? {
                    color: fieldAlertLevel === 'critico' ? '#ef4444' : fieldAlertLevel === 'alto' ? '#f59e0b' : '#3b82f6',
                    borderColor: fieldAlertLevel === 'critico' ? 'rgba(239,68,68,0.3)' : fieldAlertLevel === 'alto' ? 'rgba(245,158,11,0.3)' : 'rgba(59,130,246,0.3)',
                  }
                : undefined
            }
            title={isMobile ? 'Panel campo y alertas' : 'Panel campo y alertas (C)'}
          >
            <span className="inline-flex items-center gap-1">{isMobile && <WeatherIcon id="clipboard-list" size={14} />} Panel</span>
          </button>
        )}

        {/* Wind front ETA badge — when propagation detected */}
        {windFront?.active && windFront.etaMin != null && (
          <div
            className={`flex items-center gap-1 rounded font-mono ${
              isMobile ? 'px-2 py-1.5 text-[10px]' : 'px-2 py-0.5 text-[10px]'
            }`}
            style={{
              background: 'rgba(245, 158, 11, 0.10)',
              border: '1px solid rgba(245, 158, 11, 0.30)',
              color: '#f59e0b',
            }}
            title={`Frente de viento ${windFront.directionLabel} a ${windFront.frontSpeedKt.toFixed(0)} kt — llegada estimada ~${windFront.etaMin} min`}
          >
            <WeatherIcon id="radar" size={isMobile ? 14 : 12} />
            <span className="font-bold">~{windFront.etaMin} min</span>
            {!isMobile && (
              <span className="text-slate-500 text-[9px]">{windFront.directionLabel}</span>
            )}
          </div>
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
            <WeatherIcon id="sailboat" size={14} />
            <span className="font-semibold">{nextSailingWindow.score}%</span>
            <span className="text-slate-500 text-[9px]">
              {nextSailingWindow.time.toLocaleDateString('es-ES', { weekday: 'short' })}{' '}
              {nextSailingWindow.time.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        )}

        <LastUpdated onRefresh={onRefresh} compact={isMobile} />
      </div>
    </header>
  );
}
