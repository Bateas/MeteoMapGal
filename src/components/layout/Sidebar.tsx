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
const DailySailingBriefing = lazy(() =>
  import('../dashboard/DailySailingBriefing').then((m) => ({ default: m.DailySailingBriefing })),
);
const HistoryDashboard = lazy(() =>
  import('../dashboard/HistoryDashboard').then((m) => ({ default: m.HistoryDashboard })),
);

type Tab = 'stations' | 'chart' | 'forecast' | 'thermal' | 'history';

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
      {/* Tab header — proper ARIA tab roles for accessibility */}
      <div className="flex border-b border-slate-700" role="tablist" aria-label="Paneles de datos">
        <button
          role="tab"
          aria-selected={activeTab === 'stations'}
          aria-controls="tabpanel-stations"
          onClick={() => setActiveTab('stations')}
          className={`flex-1 text-[13px] font-semibold py-2.5 uppercase tracking-wider transition-colors ${
            activeTab === 'stations'
              ? 'text-white border-b-2 border-blue-500 bg-slate-800/50'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          Estaciones
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'chart'}
          aria-controls="tabpanel-chart"
          onClick={() => setActiveTab('chart')}
          className={`flex-1 text-[13px] font-semibold py-2.5 uppercase tracking-wider transition-colors ${
            activeTab === 'chart'
              ? 'text-white border-b-2 border-blue-500 bg-slate-800/50'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          Gráfica
        </button>
        {isEmbalse && (
          <button
            role="tab"
            aria-selected={activeTab === 'forecast'}
            aria-controls="tabpanel-forecast"
            onClick={() => setActiveTab('forecast')}
            className={`flex-1 text-[13px] font-semibold py-2.5 uppercase tracking-wider transition-colors ${
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
            role="tab"
            aria-selected={activeTab === 'thermal'}
            aria-controls="tabpanel-thermal"
            onClick={() => setActiveTab('thermal')}
            className={`flex-1 text-[13px] font-semibold py-2.5 uppercase tracking-wider transition-colors ${
              activeTab === 'thermal'
                ? 'text-white border-b-2 border-amber-500 bg-slate-800/50'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Térmico
          </button>
        )}
        <button
          role="tab"
          aria-selected={activeTab === 'history'}
          aria-controls="tabpanel-history"
          onClick={() => setActiveTab('history')}
          className={`flex-1 text-[13px] font-semibold py-2.5 uppercase tracking-wider transition-colors ${
            activeTab === 'history'
              ? 'text-white border-b-2 border-amber-500 bg-slate-800/50'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          Historial
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <ErrorBanner />
        <Suspense fallback={<div className="text-center text-slate-500 text-xs py-8">Cargando...</div>}>
          {activeTab === 'stations' && (
            <>
              {isEmbalse && (
                <ErrorBoundary section="Resumen Navegación">
                  <DailySailingBriefing />
                </ErrorBoundary>
              )}
              <ErrorBoundary section="Estaciones">
                <StationTable />
              </ErrorBoundary>
            </>
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
          {activeTab === 'history' && (
            <ErrorBoundary section="Historial">
              <HistoryDashboard />
            </ErrorBoundary>
          )}
        </Suspense>
      </div>
    </div>
  );
}
