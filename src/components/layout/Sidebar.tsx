import { useState, lazy, Suspense } from 'react';
import { StationTable } from '../dashboard/StationTable';
import { TimeSeriesChart } from '../charts/TimeSeriesChart';
import { ForecastTimeline } from '../charts/ForecastTimeline';
import { ErrorBanner } from '../common/ErrorBanner';
import { ErrorBoundary } from '../common/ErrorBoundary';

const ThermalWindPanel = lazy(() =>
  import('../charts/ThermalWindPanel').then((m) => ({ default: m.ThermalWindPanel })),
);

type Tab = 'stations' | 'chart' | 'forecast' | 'thermal';

export function Sidebar() {
  const [activeTab, setActiveTab] = useState<Tab>('stations');

  return (
    <aside className="w-80 bg-slate-900 border-r border-slate-700 flex flex-col overflow-hidden">
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
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <ErrorBanner />
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
            <Suspense fallback={<div className="text-center text-slate-500 text-xs py-8">Cargando panel térmico...</div>}>
              <ThermalWindPanel />
            </Suspense>
          </ErrorBoundary>
        )}
      </div>
    </aside>
  );
}
