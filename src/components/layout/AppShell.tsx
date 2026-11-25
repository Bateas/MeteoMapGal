import { useState, useEffect, useRef, useCallback, lazy, Suspense, type ComponentProps } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { WeatherIcon } from '../icons/WeatherIcons';
const FieldDrawer = lazy(() => import('./FieldDrawer').then(m => ({ default: m.FieldDrawer })));
import { MobileBottomNav } from './MobileBottomNav';
import { WeatherMap } from '../map/WeatherMap';
import { useWeatherData } from '../../hooks/useWeatherData';
import { LoadingScreen } from '../common/LoadingScreen';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';
import { useLightningStore } from '../../hooks/useLightningData';
import { logPredictionSnapshot } from '../../services/stormPredictionLogger';
import { useStormPrediction, usePredictionInputsReady } from '../../hooks/useStormPrediction';
import { useTemperatureOverlayStore } from '../../store/temperatureOverlayStore';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { KeyboardShortcutHelp } from '../common/KeyboardShortcutHelp';
const MeteoGuide = lazy(() => import('../guide/MeteoGuide').then(m => ({ default: m.MeteoGuide })));
const FeedbackModal = lazy(() => import('../common/FeedbackModal').then(m => ({ default: m.FeedbackModal })));
import { ToastContainer } from '../common/ToastContainer';
// The first visit asks two or three questions instead of the old four-step tour (18-nov)
const WelcomeAssistant = lazy(() => import('../common/WelcomeAssistant').then(m => ({ default: m.WelcomeAssistant })));
// Daily summary handled by ingestor 24/7 (dailySummary.ts) — frontend service removed
// Geolocation disabled — browser permission popup scares first-visit users
const ConditionsTicker = lazy(() => import('../common/ConditionsTicker').then(m => ({ default: m.ConditionsTicker })));
const ForecastPanel = lazy(() => import('../charts/ForecastPanel').then(m => ({ default: m.ForecastPanel })));
import { SourceStatusBanner } from '../common/SourceStatusBanner';
import { PwaInstallBanner } from '../common/PwaInstallBanner';
import { NewVersionBanner } from '../common/NewVersionBanner';
import { SimulationBanner } from '../common/SimulationBanner';
import { useThemeStore } from '../../store/themeStore';
import { useSectorStore } from '../../store/sectorStore';
import { useUIStore } from '../../store/uiStore';
import { useToastStore } from '../../store/toastStore';
import { MobileSailingBanner } from '../dashboard/MobileSailingBanner';
import { CriticalAlertBanner } from '../map/CriticalAlertBanner';
import { LightningProximityBanner } from '../map/LightningProximityBanner';
import { useCssVarFromElement } from '../../hooks/useCssVarFromElement';
import { NARROW_DESKTOP_QUERY } from '../../config/narrowDesktop';
import type { TeleconnectionIndex } from '../../api/naoClient';
import { useUnifiedAlertPipeline } from '../../hooks/useUnifiedAlertPipeline';
import { useConditionsList } from '../../hooks/useConditionsList';
import { useDeepLink } from '../../hooks/useDeepLink';
import { bottomTabFor } from '../../config/bottomTab';
import { visibleSidebarTabs } from '../../config/simpleTabs';
import { clearAdvancedLayers } from '../../services/simpleModeLayers';
import '../../styles/v3tokens.css';
import '../../styles/chrome.css';
import '../../styles/archivoFonts.css';
import { useBackCloses } from '../../hooks/useBackCloses';
import { MobileSidePanel } from './MobileSidePanel';
const DeferredHooks = lazy(() => import('./DeferredHooks').then(m => ({ default: m.DeferredHooks })));

/** Collapsed sidebar: the same tabs as the open panel, as a column of icons with their names. */
function CollapsedSidebar({ onExpand }: { onExpand: () => void }) {
  const simpleMode = useUIStore((s) => s.simpleMode);
  const tabs = visibleSidebarTabs(simpleMode);
  return (
    <div className="gc-rail" data-tour="sidebar">
      <button type="button" onClick={onExpand} className="gc-railbtn gc-railbtn--icon" aria-label="Expandir panel" title="Expandir panel">
        <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" d="M9 5l7 7-7 7" /></svg>
      </button>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => { useUIStore.getState().setRequestedTab(tab.id); onExpand(); }}
          // Simple mode: the forecast is the one place to go besides the map, so it leads
          className={simpleMode && tab.id === 'forecast' ? 'gc-railbtn gc-railbtn--lead' : 'gc-railbtn'}
          title={tab.label}
        >
          <WeatherIcon id={tab.icon} size={18} />
          <span>{tab.label}</span>
        </button>
      ))}
      <div style={{ flex: 1 }} />
      <a href="https://ko-fi.com/bateas" target="_blank" rel="noopener noreferrer" className="gc-railbtn" title="Apoyar el proyecto">
        <WeatherIcon id="anchor" size={18} />
        <span>Apoyar</span>
      </a>
    </div>
  );
}

/**
 * Nothing on screen and nothing on the way. It has to be worked out here: when every network fails, the
 * discovery returns an empty list, with no error at all, and the map would just stay empty. The wait
 * rides over the moment between the end of the discovery and the start of the first reading.
 */
/**
 * The dot of Condiciones (the worst colour of its list, official warnings and lightning included) read here
 * and not in AppShell: its eleven store slices re-rendered the whole map tree; measured on 19-nov, about
 * 7 extra renders of the map during start-up. Now only the header or the bottom bar repaints.
 */
function HeaderWithConditions(props: Omit<ComponentProps<typeof Header>, 'fieldAlertLevel'>) {
  return <Header {...props} fieldAlertLevel={useConditionsList().level} />;
}
function BottomNavWithConditions() {
  return <MobileBottomNav fieldAlertLevel={useConditionsList().level} />;
}

function NoDataNotice({ onRetry }: { onRetry: () => void }) {
  const error = useWeatherStore((s) => s.error);
  const nothingComing = useWeatherStore((s) => s.currentReadings.size === 0 && !s.isLoading);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!nothingComing) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), 1500);
    return () => clearTimeout(t);
  }, [nothingComing]);
  if (!show && !(error && nothingComing)) return null;
  return (
    <div className="g-theme gc-notice" role="alert">
      <span className="gc-dot gc-t-critico" />
      <span className="gc-notice-text"><b>No se han podido cargar los datos.</b></span>
      <button type="button" className="gc-btn gc-btn--plain" onClick={onRetry}>Reintentar</button>
    </div>
  );
}

export function AppShell() {
  // Deep-link: when arriving via a shared URL ?sector=X&spot=Y, pre-select
  // sector + open the spot popup. Runs ONCE on mount.
  useDeepLink();

  const { forceRefresh, retryDiscovery } = useWeatherData();
  const error = useWeatherStore((s) => s.error);
  const stations = useWeatherStore((s) => s.stations);
  const activeSectorId = useSectorStore((s) => s.activeSector.id);

  // ── Responsive state ──────────────────────────────────
  const isMobile = useUIStore((s) => s.isMobile);
  const simpleMode = useUIStore((s) => s.simpleMode);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useUIStore((s) => s.toggleSidebarCollapsed);
  const theme = useThemeStore((s) => s.theme);

  // Apply theme to <html> element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f5f3' : '#141618');
  }, [theme]);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  // Where the map really starts, and how tall the phone's top-of-map column
  // is: fixed notices read them as --map-top / --map-stack-h.
  const mainRef = useRef<HTMLElement>(null);
  const mapTopStackRef = useRef<HTMLDivElement>(null);
  useCssVarFromElement(mainRef, '--map-top', 'top');
  useCssVarFromElement(mapTopStackRef, '--map-stack-h', 'height', isMobile);
  // The warnings strip floats over the top of the map; what sits there moves down by its height (--ticker-h).
  const tickerRef = useRef<HTMLDivElement>(null);
  useCssVarFromElement(tickerRef, '--ticker-h', 'height');
  const setIsMobile = useUIStore((s) => s.setIsMobile);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const fieldDrawerOpen = useUIStore((s) => s.fieldDrawerOpen);
  const setFieldDrawerOpen = useUIStore((s) => s.setFieldDrawerOpen);
  const toggleFieldDrawer = useUIStore((s) => s.toggleFieldDrawer);
  const closeFieldDrawer = useCallback(() => setFieldDrawerOpen(false), [setFieldDrawerOpen]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const handler = (e: MediaQueryListEvent) => {
      setIsMobile(!e.matches);
      if (e.matches) setSidebarOpen(false); // close mobile panel when resizing to desktop
    };
    setIsMobile(!mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [setIsMobile, setSidebarOpen]);

  // A narrow desktop window (a tablet, half a screen): the open panel leaves the map no room, so it
  // folds when the window gets there. The reader can still open it; it is not locked.
  useEffect(() => {
    const mq = window.matchMedia(NARROW_DESKTOP_QUERY);
    const fold = (e: { matches: boolean }) => { if (e.matches) useUIStore.getState().setSidebarCollapsed(true); };
    fold(mq);
    mq.addEventListener('change', fold);
    return () => mq.removeEventListener('change', fold);
  }, []);

  // Auto-close sidebar when a station is selected on mobile
  const selectedStationId = useWeatherSelectionStore((s) => s.selectedStationId);
  useEffect(() => {
    if (isMobile && selectedStationId) setSidebarOpen(false);
  }, [selectedStationId, isMobile, setSidebarOpen]);

  // Mutual exclusion: close FieldDrawer when sidebar opens on mobile
  useEffect(() => {
    if (isMobile && sidebarOpen) setFieldDrawerOpen(false);
  }, [sidebarOpen, isMobile, setFieldDrawerOpen]);

  // Sync bottom nav tab with what is actually on screen: panels closed
  // externally (station select, close button), the forecast opened from outside
  // the bar (sidebar "Ampliar", spot popup, timeline) and closed by its own
  // "Volver al mapa"/Escape. The tab drives aria-current, so it must not point
  // at Mapa or Spots while the full-screen forecast covers them.
  const forecastPanelOpen = useUIStore((s) => s.forecastPanelOpen);
  useEffect(() => {
    if (!isMobile) return;
    const ui = useUIStore.getState();
    const tab = bottomTabFor({ forecastPanelOpen, fieldDrawerOpen, sidebarOpen, current: ui.activeBottomTab });
    if (tab) ui.setActiveBottomTab(tab);
  }, [isMobile, sidebarOpen, fieldDrawerOpen, forecastPanelOpen]);

  // On a phone the panels cover the map: the back button closes whichever is open and goes back to it.
  // One slot for the three, so moving between tabs is still a single step back.
  useBackCloses(isMobile && (sidebarOpen || fieldDrawerOpen || forecastPanelOpen), () => {
    const ui = useUIStore.getState();
    ui.setSidebarOpen(false);
    ui.setFieldDrawerOpen(false);
    ui.setForecastPanelOpen(false);
  }, 'panel');

  // React to external tab switch requests (e.g. popup "Ver historial" button).
  // MUST live here (not in Sidebar) because Sidebar is not mounted when collapsed/closed.
  const requestedTab = useUIStore((s) => s.requestedTab);
  useEffect(() => {
    if (!requestedTab) return;
    const ui = useUIStore.getState();
    // Expand sidebar so <Sidebar/> mounts and picks up the requestedTab
    if (!isMobile && ui.sidebarCollapsed) ui.setSidebarCollapsed(false);
    if (isMobile && !ui.sidebarOpen) ui.setSidebarOpen(true);
    // «Ver historial» on a card: Estaciones and Historial live under Más, not under Spots
    if (isMobile && requestedTab !== 'spots') ui.setActiveBottomTab('mas');
  }, [requestedTab, isMobile]);

  // useForecastTimeline moved to DeferredHooks — not on
  // critical path for first paint; consumers read from useForecastStore.

  // ── Deferred hooks — mount after 3s to unblock first paint ──
  const [deferredReady, setDeferredReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDeferredReady(true), 3000);
    return () => clearTimeout(t);
  }, []);

  // NAO/AO teleconnection indices — ref shared with DeferredHooks
  const teleconnectionsRef = useRef<TeleconnectionIndex[]>([]);

  // LoadingScreen decides when it leaves, with its fade; this only says it is gone
  const [showLoading, setShowLoading] = useState(true);
  const hideLoading = useCallback(() => setShowLoading(false), []);

  // Simple mode has no layer switches, so what stays on could not be turned off
  useEffect(() => {
    if (simpleMode) clearAdvancedLayers();
  }, [simpleMode]);

  // Geolocation auto-sector removed (permission popup scared users)

  // Prune stale history moved to DeferredHooks (off critical path).
  // Daily summary moved to ingestor (24/7, single source, no visitor duplicates).

  // ── Unified alert pipeline (its own hook) ──────────────────
  // The 3-effect chain (lapseRate → fieldAlerts → unified aggregation)
  // lives in useUnifiedAlertPipeline now and writes to the stores. Its store subscriptions still
  // re-render AppShell (a hook's subscriptions belong to its caller): about once a minute once settled
  // (measured 19-nov), so it stays here for now.
  useUnifiedAlertPipeline({
    stations,
    teleconnectionsRef,
  });

  // ── Keyboard shortcuts (desktop only) ───────────────────
  useEffect(() => {
    if (isMobile) return; // no keyboard shortcuts on mobile

    const LAYER_LABELS: Record<string, string> = {
      'none': 'Ninguna',
      'wind-particles': 'Viento',
      'radar': 'Radar',
    };

    function handleKeyDown(e: KeyboardEvent) {
      // Not while typing, not Ctrl+C and the like, and not under a dialog that owns the keyboard
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // (P is the forecast panel's own key: it opened it, it closes it)
      const closesForecast = e.key.toLowerCase() === 'p' && useUIStore.getState().forecastPanelOpen;
      if (!closesForecast && document.querySelector('[aria-modal="true"]')) return;
      const toast = useToastStore.getState().addToast;

      switch (e.key.toLowerCase()) {
        case 'c':
          toggleFieldDrawer();
          toast('Condiciones', 'info');
          break;
        case 'r':
          forceRefresh();
          toast('Datos refrescados', 'success');
          break;
        case 't':
          // Simple mode has no layer buttons to turn it off again
          if (useUIStore.getState().simpleMode) break;
          useTemperatureOverlayStore.getState().toggleOverlay();
          toast('Temperatura', 'info');
          break;
        case 'w': {
          // Simple mode has no layer buttons to turn it off again
          if (useUIStore.getState().simpleMode) break;
          useWeatherLayerStore.getState().cycleLayer();
          const layer = useWeatherLayerStore.getState().activeLayer;
          toast(`Capa: ${LAYER_LABELS[layer] ?? layer}`, 'info');
          break;
        }
        case 'p': {
          const ui = useUIStore.getState();
          ui.setForecastPanelOpen(!ui.forecastPanelOpen);
          toast(ui.forecastPanelOpen ? 'Previsión cerrada' : 'Previsión ampliada', 'info');
          break;
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobile, toggleFieldDrawer, forceRefresh]);

  // ── Storm prediction logging (for future ML calibration) ──
  const stormPrediction = useStormPrediction();
  const stormAlertLevel = useLightningStore((s) => s.stormAlert.level);
  // Not before the lightning, the forecast and the warnings have answered: a visitor who had just
  // opened the map logged «10 %, none» or «30 %» in the middle of the 6-oct storms, and those rows
  // are what the predictor is scored against.
  const predictionReady = usePredictionInputsReady();
  useEffect(() => {
    if (!predictionReady) return;
    logPredictionSnapshot(stormPrediction, stormAlertLevel !== 'none', activeSectorId);
  }, [stormPrediction, stormAlertLevel, activeSectorId, predictionReady]);

  return (
    <div className="h-screen-safe w-full flex flex-col bg-slate-950 text-white overflow-hidden">
      {/* Skip to content — visible only on keyboard focus */}
      <a
        href="#main-map"
        // In the type of the rest of the page: it was the one text on the first screen that made the browser
        // download DM Sans, and it is not even seen.
        style={{ fontFamily: 'var(--g-font)' }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:px-4 focus:py-2 focus:bg-blue-700 focus:text-white focus:rounded-lg focus:text-sm focus:font-bold focus:shadow-lg focus:ring-2 focus:ring-blue-400 focus:outline-none"
      >
        Saltar al mapa
      </a>
      <SimulationBanner />
      <HeaderWithConditions
        onRefresh={forceRefresh}
        fieldDrawerOpen={fieldDrawerOpen}
        onToggleFieldDrawer={toggleFieldDrawer}
      />

      {/* Deferred hooks — mount after 3s to unblock first paint (LCP) */}
      {deferredReady && <DeferredHooks teleconnectionsRef={teleconnectionsRef} />}

      {/* No «Estás en modo simple» line: it took a row of every screen. The way to the rest is the
          «Avanzado» button of the header and, on the phone, of the «Más» menu. */}

      <SourceStatusBanner />
      {!showLoading && <NoDataNotice onRetry={retryDiscovery} />}

      <div className="flex-1 flex overflow-hidden relative">
        {/* Desktop sidebar: collapsible (icon strip ↔ full panel) */}
        {!isMobile && (
          <ErrorBoundary section="Sidebar">
            <aside className={`g-theme gc-aside gc-aside--dock ${sidebarCollapsed ? 'w-[68px]' : 'w-80'}`}>
              {sidebarCollapsed ? (
                <CollapsedSidebar onExpand={toggleSidebarCollapsed} />
              ) : (
                <>
                  <button type="button" onClick={toggleSidebarCollapsed} className="gc-collapse" aria-label="Colapsar panel" title="Colapsar panel">
                    <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" d="M15 19l-7-7 7-7" /></svg>
                    Plegar
                  </button>
                  <Sidebar />
                </>
              )}
            </aside>
          </ErrorBoundary>
        )}

        {/* Mobile sidebar: slide-over panel */}
        {isMobile && sidebarOpen && (
          <MobileSidePanel onClose={() => setSidebarOpen(false)}>
            <Sidebar />
          </MobileSidePanel>
        )}

        <main ref={mainRef} id="main-map" className="flex-1 relative isolate map-dark-scope">
          <ErrorBoundary section="Mapa">
            <WeatherMap />
          </ErrorBoundary>

          {/* The warnings strip mounts ALWAYS (in simple mode it keeps only the essential items: official
              warnings, safety). It floats over the top of the map: in the page flow it arrived ~4 s after the
              map and pushed it down 50 px (CLS 0,10; over the map since 19-nov). */}
          <div ref={tickerRef} className="gc-mapticker">
            <ErrorBoundary section="Ticker"><Suspense fallback={null}><ConditionsTicker simple={simpleMode} /></Suspense></ErrorBoundary>
          </div>

          {/* Phone: the notices at the top of the map share ONE column, pinned
              where the map really starts (--map-top, measured) and stacked by
              importance. Each used to sit at its own fixed distance from the top
              of the SCREEN, so they landed on the official warnings and the
              ticker above the map, and on each other. */}
          {isMobile && (
            <div
              ref={mapTopStackRef}
              className="fixed left-0 right-0 z-30 px-2 flex flex-col items-center gap-1.5 pointer-events-none"
              style={{ top: 'calc(var(--map-top, 4.5rem) + var(--ticker-h, 0px) + 0.5rem)' }}
            >
              <CriticalAlertBanner />
              <LightningProximityBanner />
              {!sidebarOpen && <MobileSailingBanner />}
            </div>
          )}

          {/* Condiciones: not mounted while closed, so no polling and nothing to tab into */}
          {fieldDrawerOpen && (
            <Suspense fallback={null}>
              <FieldDrawer onClose={closeFieldDrawer} />
            </Suspense>
          )}
        </main>

        {/* The whole window, on the first load only. It leaves with its own fade. */}
        {showLoading && <LoadingScreen error={error} onDone={hideLoading} />}
      </div>
      <Suspense fallback={null}><ForecastPanel /></Suspense>
      <Suspense fallback={null}><MeteoGuide /></Suspense>
      <Suspense fallback={null}><FeedbackModal /></Suspense>
      {!isMobile && <KeyboardShortcutHelp />}
      <Suspense fallback={null}><WelcomeAssistant /></Suspense>
      <ToastContainer />
      {/* Bottom notices share one slot and stack instead of covering each other. On a phone they
          live in the map's bottom column instead (WeatherMap), above the toolbar. */}
      {!isMobile && (
        <div className="fixed bottom-16 left-2 right-2 sm:left-auto sm:right-4 sm:bottom-4 sm:w-80 z-50 flex flex-col gap-2 pointer-events-none">
          <NewVersionBanner />
          <PwaInstallBanner />
        </div>
      )}
      {isMobile && <BottomNavWithConditions />}
    </div>
  );
}
