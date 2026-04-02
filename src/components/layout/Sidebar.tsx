import { useState, useEffect, lazy, Suspense } from 'react';
import { ErrorBanner } from '../common/ErrorBanner';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { SkeletonLoader } from '../common/SkeletonLoader';
import { useSectorStore } from '../../store/sectorStore';
import { useUIStore } from '../../store/uiStore';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';
import { useBuoyStore } from '../../store/buoyStore';
import { downloadGeoJSON } from '../../services/exportService';
import { WeatherIcon } from '../icons/WeatherIcons';

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
const HistoryDashboard = lazy(() =>
  import('../dashboard/HistoryDashboard').then((m) => ({ default: m.HistoryDashboard })),
);
const BuoyPanel = lazy(() =>
  import('../dashboard/BuoyPanel').then((m) => ({ default: m.BuoyPanel })),
);
const SpotSelector = lazy(() =>
  import('../dashboard/SpotSelector').then((m) => ({ default: m.SpotSelector })),
);
const RankingsPanel = lazy(() =>
  import('../dashboard/RankingsPanel').then((m) => ({ default: m.RankingsPanel })),
);
const SpotComparator = lazy(() =>
  import('../dashboard/SpotComparator').then((m) => ({ default: m.SpotComparator })),
);

type Tab = 'stations' | 'chart' | 'compare' | 'forecast' | 'thermal' | 'history' | 'rankings' | 'verify';

export function Sidebar() {
  const [activeTab, setActiveTab] = useState<Tab>('stations');
  const activeSectorId = useSectorStore((s) => s.activeSector.id);
  const isEmbalse = activeSectorId === 'embalse';
  const isRias = activeSectorId === 'rias';
  const isMobile = useUIStore((s) => s.isMobile);

  // Reset to 'stations' if viewing an Embalse-only tab and sector changes
  // Forecast is now available for both sectors; thermal remains Embalse-only
  useEffect(() => {
    if (!isEmbalse && activeTab === 'thermal') {
      setActiveTab('stations');
    }
  }, [isEmbalse, activeTab]);

  // React to external tab switch requests (from popup "Ver historial" button)
  // AppShell handles expanding the sidebar; here we just switch the tab.
  const requestedTab = useUIStore((s) => s.requestedTab);
  const setRequestedTab = useUIStore((s) => s.setRequestedTab);
  useEffect(() => {
    if (requestedTab) {
      setActiveTab(requestedTab as Tab);
      setRequestedTab(null);
    }
  }, [requestedTab, setRequestedTab]);

  // When on History tab, clicking a station/buoy on map auto-loads its history
  const selectedStationId = useWeatherSelectionStore((s) => s.selectedStationId);
  const openHistory = useWeatherSelectionStore((s) => s.openHistory);
  const selectedBuoyId = useBuoyStore((s) => s.selectedBuoyId);
  useEffect(() => {
    if (activeTab === 'history' && selectedStationId) {
      openHistory(selectedStationId);
    }
  }, [activeTab, selectedStationId, openHistory]);
  useEffect(() => {
    if (activeTab === 'history' && selectedBuoyId != null) {
      openHistory(`buoy_${selectedBuoyId}`);
    }
  }, [activeTab, selectedBuoyId, openHistory]);

  // Compact tabs — wrap to multiple rows so all tabs are always visible
  const tabBase = isMobile
    ? 'px-2.5 text-[11px] font-semibold py-2.5 uppercase whitespace-nowrap transition-colors rounded-t min-h-[40px] flex items-center'
    : 'px-2 text-[11px] font-semibold py-2 uppercase whitespace-nowrap transition-colors rounded-t tracking-wide min-h-[36px] flex items-center';
  const tabOn = (color: string) => `text-white border-b-2 ${color} bg-slate-800/50`;
  const tabOff = 'text-slate-500 hover:text-slate-300 border-b-2 border-transparent';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab header — wraps to multiple rows so all tabs are visible */}
      <nav aria-label="Secciones de análisis">
      <div className="flex flex-wrap gap-0.5 border-b border-slate-700 px-1 py-0.5" role="tablist" aria-label="Paneles de datos">
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
        <button
          role="tab"
          aria-selected={activeTab === 'compare'}
          aria-controls="tabpanel-compare"
          onClick={() => setActiveTab('compare')}
          className={`${tabBase} ${activeTab === 'compare' ? tabOn('border-cyan-500') : tabOff}`}
        >
          Comparar
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'forecast'}
          aria-controls="tabpanel-forecast"
          onClick={() => setActiveTab('forecast')}
          className={`${tabBase} ${activeTab === 'forecast' ? tabOn('border-sky-500') : tabOff}`}
        >
          Previsión
        </button>
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
          aria-selected={activeTab === 'rankings'}
          aria-controls="tabpanel-rankings"
          onClick={() => setActiveTab('rankings')}
          className={`${tabBase} ${activeTab === 'rankings' ? tabOn('border-emerald-500') : tabOff}`}
        >
          Rankings
        </button>
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
      </nav>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <ErrorBanner />
        <Suspense fallback={<SkeletonLoader lines={4} title />}>
          {activeTab === 'stations' && (
            <>
              <ErrorBoundary section="Spots Navegación">
                <SpotSelector />
              </ErrorBoundary>
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
          {activeTab === 'compare' && (
            <ErrorBoundary section="Comparador">
              <SpotComparator />
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
          {activeTab === 'rankings' && (
            <ErrorBoundary section="Rankings">
              <RankingsPanel />
            </ErrorBoundary>
          )}
          {activeTab === 'history' && (
            <ErrorBoundary section="Historial">
              <HistoryDashboard />
            </ErrorBoundary>
          )}
        </Suspense>
      </div>

      {/* Footer: Guide + Feedback + Export + Ko-fi */}
      <div className="flex gap-1.5 mx-3 mb-2 shrink-0">
        <button
          onClick={() => useUIStore.getState().toggleGuide()}
          className="flex items-center justify-center gap-1 px-2.5 py-2.5 rounded-lg
            border border-slate-700/40 text-slate-500 text-[11px]
            hover:text-sky-400 hover:border-sky-500/30 hover:bg-slate-800/60
            transition-all min-h-[40px] min-w-[40px]"
          title="Guía completa de la app (G)"
          aria-label="Abrir guía meteorológica (tecla G)"
        >
          <WeatherIcon id="book-open" size={16} />
        </button>
        <button
          onClick={() => useUIStore.getState().setFeedbackOpen(true)}
          className="flex items-center justify-center gap-1 px-2.5 py-2.5 rounded-lg
            border border-emerald-600/30 text-emerald-500/80 text-[11px]
            hover:text-emerald-400 hover:border-emerald-500/30 hover:bg-slate-800/60
            transition-all min-h-[40px] min-w-[40px]"
          title="Enviar sugerencias o reportar problemas"
          aria-label="Enviar feedback"
        >
          <WeatherIcon id="message-square" size={16} />
        </button>
        <button
          onClick={() => {
            const { stations, currentReadings } = useWeatherStore.getState();
            const buoys = useBuoyStore.getState().readings;
            const sector = useSectorStore.getState().activeSector;
            downloadGeoJSON(stations, currentReadings, buoys, sector.name);
          }}
          className="flex items-center justify-center gap-1 px-2.5 py-2.5 rounded-lg
            border border-slate-700/40 text-slate-500 text-[11px]
            hover:text-emerald-400 hover:border-emerald-500/30 hover:bg-slate-800/60
            transition-all min-h-[40px] min-w-[40px]"
          title="Exportar datos GeoJSON"
          aria-label="Exportar datos GeoJSON"
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <a
          href="https://ko-fi.com/meteomapgal"
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg
            border border-slate-700/40 text-slate-500 text-[11px]
            hover:text-amber-400 hover:border-amber-500/30 hover:bg-slate-800/60
            transition-all min-h-[40px]"
        >
          <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>
          Apoyar
        </a>
      </div>
    </div>
  );
}
