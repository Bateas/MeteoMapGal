import { useMemo } from 'react';
import { useWeatherStore } from '../../store/weatherStore';
import { StationCard } from './StationCard';

export function StationTable() {
  const stations = useWeatherStore((s) => s.stations);
  const currentReadings = useWeatherStore((s) => s.currentReadings);

  // Sort by wind speed (descending), stations without data at end
  const sortedStations = useMemo(() => {
    return [...stations].sort((a, b) => {
      const readingA = currentReadings.get(a.id);
      const readingB = currentReadings.get(b.id);
      const windA = readingA?.windSpeed ?? -1;
      const windB = readingB?.windSpeed ?? -1;
      return windB - windA;
    });
  }, [stations, currentReadings]);

  if (stations.length === 0) {
    return (
      <div className="text-center text-slate-500 text-xs py-4">
        Buscando estaciones...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-400 font-medium px-1">
        {stations.length} estaciones encontradas
      </div>
      {sortedStations.map((station) => (
        <StationCard
          key={station.id}
          station={station}
          reading={currentReadings.get(station.id)}
        />
      ))}
    </div>
  );
}
