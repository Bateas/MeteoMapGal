import { useMemo } from 'react';
import { LastUpdated } from '../common/LastUpdated';
import { useWeatherStore } from '../../store/weatherStore';
import { useThermalStore, getMaxAlertLevel } from '../../store/thermalStore';
import { getSunTimes, formatTime, isDaylight } from '../../services/solarUtils';

interface HeaderProps {
  onRefresh: () => void;
  fieldDrawerOpen?: boolean;
  onToggleFieldDrawer?: () => void;
  fieldAlertLevel?: 'none' | 'riesgo' | 'alto' | 'critico';
}

export function Header({ onRefresh, fieldDrawerOpen, onToggleFieldDrawer, fieldAlertLevel = 'none' }: HeaderProps) {
  const stationCount = useWeatherStore((s) => s.stations.length);
  const readingCount = useWeatherStore((s) => s.currentReadings.size);
  const zoneAlerts = useThermalStore((s) => s.zoneAlerts);
  const { level: alertLevel, score: alertScore } = getMaxAlertLevel(zoneAlerts);

  const sun = useMemo(() => getSunTimes(), []);
  const daylight = isDaylight();

  return (
    <header className="bg-slate-900 border-b border-slate-700 px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold text-white tracking-tight">
          MeteoMap
        </h1>
        <span className="text-[10px] text-slate-500 font-medium">
          Ourense / Ribadavia
        </span>
        {stationCount > 0 && (
          <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded">
            {readingCount}/{stationCount} est.
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {/* Sunrise / Sunset */}
        <div
          className="flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded"
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

        {/* Campo button */}
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
          >
            <span>🌾</span>
            <span>Campo</span>
          </button>
        )}

        {alertLevel !== 'none' && (
          <div
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
              alertLevel === 'high' ? 'animate-pulse' : ''
            }`}
            style={{
              background:
                alertLevel === 'high'
                  ? 'rgba(239, 68, 68, 0.15)'
                  : alertLevel === 'medium'
                  ? 'rgba(245, 158, 11, 0.15)'
                  : 'rgba(59, 130, 246, 0.15)',
              color:
                alertLevel === 'high'
                  ? '#ef4444'
                  : alertLevel === 'medium'
                  ? '#f59e0b'
                  : '#3b82f6',
              border: `1px solid ${
                alertLevel === 'high'
                  ? 'rgba(239, 68, 68, 0.3)'
                  : alertLevel === 'medium'
                  ? 'rgba(245, 158, 11, 0.3)'
                  : 'rgba(59, 130, 246, 0.3)'
              }`,
            }}
          >
            <span>Térmico</span>
            <span>{alertScore}%</span>
          </div>
        )}
        <LastUpdated onRefresh={onRefresh} />
      </div>
    </header>
  );
}
