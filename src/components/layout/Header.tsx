import { LastUpdated } from '../common/LastUpdated';
import { useWeatherStore } from '../../store/weatherStore';

interface HeaderProps {
  onRefresh: () => void;
}

export function Header({ onRefresh }: HeaderProps) {
  const stationCount = useWeatherStore((s) => s.stations.length);
  const readingCount = useWeatherStore((s) => s.currentReadings.size);

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
      <LastUpdated onRefresh={onRefresh} />
    </header>
  );
}
