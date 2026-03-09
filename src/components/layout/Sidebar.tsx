import { useState, useEffect, lazy, Suspense } from 'react';
import { ErrorBanner } from '../common/ErrorBanner';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { useSectorStore } from '../../store/sectorStore';
import { useUIStore } from '../../store/uiStore';

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
const BuoyPanel = lazy(() =>
  import('../dashboard/BuoyPanel').then((m) => ({ default: m.BuoyPanel })),
);

type Tab = 'stations' | 'chart' | 'forecast' | 'thermal' | 'history';

export function Sidebar() {
  const [activeTab, setActiveTab] = useState<Tab>('stations');
  const activeSectorId = useSectorStore((s) => s.activeSector.id);
  const isEmbalse = activeSectorId === 'embalse';
  const isRias = activeSectorId === 'rias';
  const isMobile = useUIStore((s) => s.isMobile);

  // Reset to 'stations' if viewing an Embalse-only tab and sector changes
  useEffect(() => {
    if (!isEmbalse && (activeTab === 'forecast' || activeTab === 'thermal')) {
      setActiveTab('stations');
    }
  }, [isEmbalse, activeTab]);

  // Compact tabs — mobile: scrollable horizontal; desktop: evenly distributed
  const tabBase = isMobile
    ? 'shrink-0 px-3 text-[11px] font-semibold py-2 uppercase whitespace-nowrap transition-colors'
    : 'flex-1 text-[10px] font-semibold py-2 uppercase whitespace-nowrap transition-colors';
  const tabOn = (color: string) => `text-white border-b-2 ${color} bg-slate-800/50`;
  const tabOff = 'text-slate-500 hover:text-slate-300';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab header — horizontally scrollable on mobile */}
      <div className="flex border-b border-slate-700 overflow-x-auto scrollbar-none" role="tablist" aria-label="Paneles de datos">
        <button
          role="tab"
          aria-selected={activeTab === 'stations'}
          aria-controls="tabpanel-stations"
          onClick={() => setActiveTab('stations')}
          className={`${tabBase} ${activeTab === 'stations' ? tabOn('border-blue-500') : tabOff}`}
        >
          Estaciones
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'chart'}
          aria-controls="tabpanel-chart"
          onClick={() => setActiveTab('chart')}
          className={`${tabBase} ${activeTab === 'chart' ? tabOn('border-blue-500') : tabOff}`}
        >
          Gráfica
        </button>
        {isEmbalse && (
          <button
            role="tab"
            aria-selected={activeTab === 'forecast'}
            aria-controls="tabpanel-forecast"
            onClick={() => setActiveTab('forecast')}
            className={`${tabBase} ${activeTab === 'forecast' ? tabOn('border-sky-500') : tabOff}`}
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
            className={`${tabBase} ${activeTab === 'thermal' ? tabOn('border-amber-500') : tabOff}`}
          >
            Térmico
          </button>
        )}
        <button
          role="tab"
          aria-selected={activeTab === 'history'}
          aria-controls="tabpanel-history"
          onClick={() => setActiveTab('history')}
          className={`${tabBase} ${activeTab === 'history' ? tabOn('border-amber-500') : tabOff}`}
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
              {isRias && (
                <ErrorBoundary section="Boyas Marinas">
                  <BuoyPanel />
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
