import { useState, useEffect, useMemo, lazy, Suspense, type KeyboardEvent } from 'react';
import { ErrorBanner } from '../common/ErrorBanner';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { SkeletonLoader } from '../common/SkeletonLoader';
import { useSectorStore } from '../../store/sectorStore';
import { isCoastalSector } from '../../config/sectors';
import { useUIStore } from '../../store/uiStore';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';
import { useBuoyStore } from '../../store/buoyStore';
import { WeatherIcon } from '../icons/WeatherIcons';
import { getSpotsForSector } from '../../config/spots';
import { SIMPLE_TABS, fallbackTab, visibleSidebarTabs, type SidebarTab } from '../../config/simpleTabs';

const StationTable = lazy(() =>
  import('../dashboard/StationTable').then((m) => ({ default: m.StationTable })),
);
const ForecastTimeline = lazy(() =>
  import('../charts/ForecastTimeline').then((m) => ({ default: m.ForecastTimeline })),
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

// Tab ids + simpleMode visibility live in config/simpleTabs.ts (shared with
// MobileBottomNav so the "Más" menu never requests a tab hidden here).
type Tab = SidebarTab;

export function Sidebar() {
  const [activeTab, setActiveTab] = useState<Tab>('spots');
  const activeSectorId = useSectorStore((s) => s.activeSector.id);
  const isCoastal = isCoastalSector(activeSectorId);
  const simpleMode = useUIStore((s) => s.simpleMode);
  const isMobile = useUIStore((s) => s.isMobile);

  // Fallback when simpleMode hides the current tab
  useEffect(() => {
    if (simpleMode && !SIMPLE_TABS.has(activeTab)) {
      setActiveTab(fallbackTab(true));
    }
  }, [simpleMode, activeTab]);

  // Prefetch the heavier tabs 1.5s after sidebar mount.
  // By the time the user clicks "Previsión" / "Historial",
  // the chunks are already in browser cache → -400ms perceived latency.
  // Fire-and-forget: the imports return promises we ignore.
  useEffect(() => {
    const id = setTimeout(() => {
      import('../charts/ForecastTimeline').catch(() => {});
      import('../dashboard/HistoryDashboard').catch(() => {});
    }, 1500);
    return () => clearTimeout(id);
  }, []);

  // Forecast spot selector — null = sector default
  const [forecastSpotId, setForecastSpotId] = useState<string | null>(null);
  const sectorSpots = useMemo(() => getSpotsForSector(activeSectorId), [activeSectorId]);
  const forecastSpotCoords = useMemo(() => {
    if (!forecastSpotId) return undefined;
    const spot = sectorSpots.find(s => s.id === forecastSpotId);
    if (!spot) return undefined;
    return { lat: spot.center[1], lon: spot.center[0] };
  }, [forecastSpotId, sectorSpots]);
  // Reset spot selection on sector change
  useEffect(() => { setForecastSpotId(null); }, [activeSectorId]);

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

  const tabs = visibleSidebarTabs(simpleMode);
  const tabLabel = tabs.find((t) => t.id === activeTab)?.label ?? '';

  // Standard tab keys: arrows move and select, Home and End go to the ends. Tab leaves the row.
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === activeTab);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setActiveTab(tabs[next].id);
    document.getElementById(`tab-${tabs[next].id}`)?.focus();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" data-tour="sidebar">
      {/* On a phone the bottom bar and «Más» already lead to each one: a second row of tabs here would be
          a second navigation. The title says where you are. */}
      {isMobile ? (
        <div className="gc-panelhead">
          <h2>{tabLabel}</h2>
          <button
            type="button"
            className="gc-btn gc-btn--plain gc-btn--icon"
            aria-label="Cerrar panel"
            onClick={() => useUIStore.getState().setSidebarOpen(false)}
          >
            <WeatherIcon id="x" size={18} />
          </button>
        </div>
      ) : (
      <nav aria-label="Secciones de análisis">
      <div className="gc-tabs" role="tablist" aria-label="Paneles de datos" onKeyDown={onTabKey}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            className="gc-tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`tabpanel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      </nav>
      )}

      {/* One container serves every tab, so its id follows activeTab: the
          selected tab's aria-controls always points at a real element (the
          unselected tabs' panels are not mounted, which ARIA allows). */}
      <div
        id={`tabpanel-${activeTab}`}
        role={isMobile ? 'region' : 'tabpanel'}
        aria-labelledby={isMobile ? undefined : `tab-${activeTab}`}
        aria-label={isMobile ? tabLabel : undefined}
        className="gc-panelbody"
      >
        <ErrorBanner />
        <Suspense fallback={<SkeletonLoader lines={4} title />}>
          {activeTab === 'spots' && (
            <ErrorBoundary section="Spots Navegación">
              <SpotSelector />
            </ErrorBoundary>
          )}
          {activeTab === 'stations' && (
            <>
              {isCoastal && (
                <ErrorBoundary section="Boyas Marinas">
                  <BuoyPanel />
                </ErrorBoundary>
              )}
              <ErrorBoundary section="Estaciones">
                <StationTable />
              </ErrorBoundary>
            </>
          )}
          {activeTab === 'forecast' && (
            <ErrorBoundary section="Previsión">
              {/* Spot selector + Ampliar bar */}
              <div className="gc-forecastbar">
                <select
                  value={forecastSpotId ?? ''}
                  onChange={(e) => setForecastSpotId(e.target.value || null)}
                  className="gc-select"
                  aria-label="Seleccionar spot para previsión"
                >
                  <option value="">La zona (punto en {activeSectorId === 'embalse' ? 'Castrelo' : 'Cesantes'})</option>
                  {sectorSpots.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => useUIStore.getState().setForecastPanelOpen(true, forecastSpotId ?? undefined)}
                  className="gc-btn"
                  title="Ampliar a pantalla completa (P)"
                  aria-label="Ampliar previsión a pantalla completa"
                >
                  <WeatherIcon id="maximize" size={14} />
                  Ampliar
                </button>
              </div>
              <ForecastTimeline spotCoords={forecastSpotCoords} />
            </ErrorBoundary>
          )}
          {activeTab === 'history' && (
            <ErrorBoundary section="Historial">
              <HistoryDashboard />
            </ErrorBoundary>
          )}
        </Suspense>
      </div>

      {/* Guía, Opinión and, on a phone, this one too are in the header (desktop) and in "Más" (phone) */}
      {!isMobile && (
        <div className="gc-panelfoot">
          <a href="https://ko-fi.com/bateas" target="_blank" rel="noopener noreferrer" className="gc-btn gc-btn--plain" style={{ marginLeft: 'auto', textDecoration: 'none' }}>
            <WeatherIcon id="anchor" size={15} />
            Apoyar
          </a>
        </div>
      )}
    </div>
  );
}
