import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { WeatherMap } from '../map/WeatherMap';
import { useWeatherData } from '../../hooks/useWeatherData';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { useWeatherStore } from '../../store/weatherStore';

export function AppShell() {
  const { forceRefresh } = useWeatherData();
  const isLoading = useWeatherStore((s) => s.isLoading);
  const stations = useWeatherStore((s) => s.stations);

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950 text-white">
      <Header onRefresh={forceRefresh} />

      <div className="flex-1 flex overflow-hidden relative">
        <Sidebar />

        <main className="flex-1 relative">
          <WeatherMap />

          {/* Loading overlay (only on initial load) */}
          {isLoading && stations.length === 0 && (
            <div className="absolute inset-0 bg-slate-950/80 flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-3">
                <LoadingSpinner size={40} />
                <span className="text-sm text-slate-400">
                  Descubriendo estaciones en Ourense...
                </span>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
