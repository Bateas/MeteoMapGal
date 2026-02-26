import { LastUpdated } from '../common/LastUpdated';
import { useWeatherStore } from '../../store/weatherStore';
import { useThermalStore, getMaxAlertLevel } from '../../store/thermalStore';

interface HeaderProps {
  onRefresh: () => void;
}

export function Header({ onRefresh }: HeaderProps) {
  const stationCount = useWeatherStore((s) => s.stations.length);
  const readingCount = useWeatherStore((s) => s.currentReadings.size);
  const zoneAlerts = useThermalStore((s) => s.zoneAlerts);
  const { level: alertLevel, score: alertScore } = getMaxAlertLevel(zoneAlerts);

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
            {readingCount}/{stationCount} estaciones
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
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
