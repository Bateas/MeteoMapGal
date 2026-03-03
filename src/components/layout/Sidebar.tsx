import { useState, useEffect, lazy, Suspense } from 'react';
import { ErrorBanner } from '../common/ErrorBanner';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { useSectorStore } from '../../store/sectorStore';

const StationTable = lazy(() =>
  import('../dashboard/StationTable').then((m) => ({ default: m.StationTable })),
);
const TimeSeriesChart = lazy(() =>
  import('../charts/TimeSeriesChart').then((m) => ({ default: m.TimeSeriesChart })),
);
const ForecastTimeline = lazy(() =>
  import('../charts/ForecastTimeline').then((m) => ({ default: m.ForecastTimeline })),
);
const ThermalWindPanel = lazy(() =>
  import('../charts/ThermalWindPanel').then((m) => ({ default: m.ThermalWindPanel })),
);

type Tab = 'stations' | 'chart' | 'forecast' | 'thermal';

export function Sidebar() {
  const [activeTab, setActiveTab] = useState<Tab>('stations');
  const isEmbalse = useSectorStore((s) => s.activeSector.id === 'embalse');

  // Reset to 'stations' if viewing an Embalse-only tab and sector changes
  useEffect(() => {
    if (!isEmbalse && (activeTab === 'forecast' || activeTab === 'thermal')) {
      setActiveTab('stations');
    }
  }, [isEmbalse, activeTab]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab header */}
      <div className="flex border-b border-slate-700">
        <button
          onClick={() => setActiveTab('stations')}
          className={`flex-1 text-xs font-semibold py-2.5 uppercase tracking-wider transition-colors ${
            activeTab === 'stations'
              ? 'text-white border-b-2 border-blue-500 bg-slate-800/50'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          Estaciones
        </button>
        <button
          onClick={() => setActiveTab('chart')}
          className={`flex-1 text-xs font-semibold py-2.5 uppercase tracking-wider transition-colors ${
            activeTab === 'chart'
              ? 'text-white border-b-2 border-blue-500 bg-slate-800/50'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          Gráfica
        </button>
        {isEmbalse && (
          <button
            onClick={() => setActiveTab('forecast')}
            className={`flex-1 text-xs font-semibold py-2.5 uppercase tracking-wider transition-colors ${
              activeTab === 'forecast'
                ? 'text-white border-b-2 border-sky-500 bg-slate-800/50'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Previsión
          </button>
        )}
        {isEmbalse && (
          <button
            onClick={() => setActiveTab('thermal')}
            className={`flex-1 text-xs font-semibold py-2.5 uppercase tracking-wider transition-colors ${
              activeTab === 'thermal'
                ? 'text-white border-b-2 border-amber-500 bg-slate-800/50'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Térmico
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <ErrorBanner />
        <Suspense fallback={<div className="text-center text-slate-500 text-xs py-8">Cargando...</div>}>
          {activeTab === 'stations' && (
            <ErrorBoundary section="Estaciones">
              <StationTable />
            </ErrorBoundary>
          )}
          {activeTab === 'chart' && (
            <ErrorBoundary section="Gráfica">
              <TimeSeriesChart />
            </ErrorBoundary>
          )}
          {activeTab === 'forecast' && (
            <ErrorBoundary section="Previsión">
              <ForecastTimeline />
            </ErrorBoundary>
          )}
          {activeTab === 'thermal' && (
            <ErrorBoundary section="Panel Térmico">
              <ThermalWindPanel />
            </ErrorBoundary>
          )}
        </Suspense>
      </div>
    </div>
  );
}
