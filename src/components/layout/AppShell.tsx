import { useState, useEffect, useRef, lazy, Suspense } from 'react';
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
import { useStormPrediction } from '../../hooks/useStormPrediction';
import { fetchSeasonGDD } from '../../services/gddService';
import { useTemperatureOverlayStore } from '../../store/temperatureOverlayStore';
import { useAlertStore } from '../../store/alertStore';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { KeyboardShortcutHelp } from '../common/KeyboardShortcutHelp';
const MeteoGuide = lazy(() => import('../guide/MeteoGuide').then(m => ({ default: m.MeteoGuide })));
const FeedbackModal = lazy(() => import('../common/FeedbackModal').then(m => ({ default: m.FeedbackModal })));
import { ToastContainer } from '../common/ToastContainer';
const OnboardingTour = lazy(() => import('../common/OnboardingTour').then(m => ({ default: m.OnboardingTour })));
// Daily summary handled by ingestor 24/7 (dailySummary.ts) — frontend service removed
// Geolocation disabled — browser permission popup scares first-visit users
const ConditionsTicker = lazy(() => import('../common/ConditionsTicker').then(m => ({ default: m.ConditionsTicker })));
const ForecastPanel = lazy(() => import('../charts/ForecastPanel').then(m => ({ default: m.ForecastPanel })));
import { SourceStatusBanner } from '../common/SourceStatusBanner';
import { MagicWindowBanner } from '../common/MagicWindowBanner';
import { PwaInstallBanner } from '../common/PwaInstallBanner';
import { useThemeStore } from '../../store/themeStore';
import { useSectorStore } from '../../store/sectorStore';
import { useUIStore } from '../../store/uiStore';
import { useToastStore } from '../../store/toastStore';
import { useAirspaceStore } from '../../store/airspaceStore';
import { MobileSailingBanner } from '../dashboard/MobileSailingBanner';
import type { TeleconnectionIndex } from '../../api/naoClient';
import { useUnifiedAlertPipeline } from '../../hooks/useUnifiedAlertPipeline';
import { useDeepLink } from '../../hooks/useDeepLink';
const DeferredHooks = lazy(() => import('./DeferredHooks').then(m => ({ default: m.DeferredHooks })));

/** Collapsed sidebar: vertical icon strip with tab shortcuts — sector-aware.
 *  In simpleMode, hides Gráfica/Rankings/Historial (per user
 *  feedback: "lo más limpio posible para no abrumar"). Keeps Estaciones +
 *  Previsión always, Térmico only in Embalse. */
function CollapsedSidebar({ onExpand }: { onExpand: () => void }) {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const simpleMode = useUIStore((s) => s.simpleMode);
  const allTabs = [
    { icon: 'map-pin' as const, label: 'Estaciones', shortcut: '1', tab: 'stations' },
    { icon: 'activity' as const, label: 'Gráfica', shortcut: '2', tab: 'chart', hideInSimple: true },
    { icon: 'compass' as const, label: 'Previsión', shortcut: '3', tab: 'forecast' },
    // Térmico only in Embalse — dynamic, not hardcoded
    ...(sectorId === 'embalse' ? [{ icon: 'flame' as const, label: 'Térmico', shortcut: '4', tab: 'thermal' }] : []),
    { icon: 'layers' as const, label: 'Rankings', shortcut: sectorId === 'embalse' ? '5' : '4', tab: 'rankings', hideInSimple: true },
    { icon: 'clock' as const, label: 'Historial', shortcut: sectorId === 'embalse' ? '6' : '5', tab: 'history', hideInSimple: true },
  ];
  const TABS = allTabs.filter((t) => !simpleMode || !('hideInSimple' in t && t.hideInSimple));
  return (
    <div className="flex flex-col items-center py-2 gap-1 h-full">
      {/* Expand button */}
      <button
        onClick={onExpand}
        className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors mb-2"
        aria-label="Expandir panel"
        title="Expandir panel"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M9 5l7 7-7 7" /></svg>
      </button>
      {/* Tab icons — click navigates directly to that tab */}
      {TABS.map((tab) => (
        <button
          key={tab.label}
          onClick={() => { useUIStore.getState().setRequestedTab(tab.tab); onExpand(); }}
          className="w-11 flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-lg text-slate-500 hover:text-sky-400 hover:bg-slate-800/60 transition-colors"
          title={`${tab.label} (${tab.shortcut})`}
          aria-label={tab.label}
        >
          <WeatherIcon id={tab.icon} size={14} />
          <span className="text-[8px] font-medium leading-none truncate w-full text-center">{tab.label}</span>
        </button>
      ))}
      {/* Spacer */}
      <div className="flex-1" />
      {/* Guide + Feedback at bottom */}
      <button
        onClick={() => useUIStore.getState().toggleGuide()}
        className="w-11 flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-lg text-slate-500 hover:text-sky-400 hover:bg-slate-800/60 transition-colors"
        title="Guía (G)"
        aria-label="Guía"
      >
        <WeatherIcon id="book-open" size={14} />
        <span className="text-[8px] font-medium leading-none">Guía</span>
      </button>
      <button
        onClick={() => useUIStore.getState().setFeedbackOpen(true)}
        className="w-11 flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-lg text-emerald-500/60 hover:text-emerald-400 hover:bg-emerald-900/30 transition-colors"
        title="Feedback"
        aria-label="Feedback"
      >
        <WeatherIcon id="message-square" size={14} />
        <span className="text-[8px] font-medium leading-none">Feedback</span>
      </button>
      <a
        href="https://ko-fi.com/bateas"
        target="_blank"
        rel="noopener noreferrer"
        className="w-11 flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-lg text-amber-500/50 hover:text-amber-400 hover:bg-amber-900/20 transition-colors"
        title="Apoyar el proyecto"
        aria-label="Apoyar en Ko-fi"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>
        <span className="text-[8px] font-medium leading-none">Apoyar</span>
      </a>
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
  const activeSectorCenter = useSectorStore((s) => s.activeSector.center);
  const activeSectorName = useSectorStore((s) => s.activeSector.name);

  // ── Responsive state ──────────────────────────────────
  const isMobile = useUIStore((s) => s.isMobile);
  const simpleMode = useUIStore((s) => s.simpleMode);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useUIStore((s) => s.toggleSidebarCollapsed);
  const theme = useThemeStore((s) => s.theme);

  // Apply theme to <html> element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#ffffff' : '#0f172a');
  }, [theme]);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setIsMobile = useUIStore((s) => s.setIsMobile);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const fieldDrawerOpen = useUIStore((s) => s.fieldDrawerOpen);
  const setFieldDrawerOpen = useUIStore((s) => s.setFieldDrawerOpen);
  const toggleFieldDrawer = useUIStore((s) => s.toggleFieldDrawer);

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

  // Auto-close sidebar when a station is selected on mobile
  const selectedStationId = useWeatherSelectionStore((s) => s.selectedStationId);
  useEffect(() => {
    if (isMobile && selectedStationId) setSidebarOpen(false);
  }, [selectedStationId, isMobile, setSidebarOpen]);

  // Mutual exclusion: close FieldDrawer when sidebar opens on mobile
  useEffect(() => {
    if (isMobile && sidebarOpen) setFieldDrawerOpen(false);
  }, [sidebarOpen, isMobile, setFieldDrawerOpen]);

  // Sync bottom nav tab when panels close externally (station select, close button, etc.)
  useEffect(() => {
    if (isMobile && !sidebarOpen && !fieldDrawerOpen) {
      useUIStore.getState().setActiveBottomTab('map');
    }
  }, [isMobile, sidebarOpen, fieldDrawerOpen]);

  // React to external tab switch requests (e.g. popup "Ver historial" button).
  // MUST live here (not in Sidebar) because Sidebar is not mounted when collapsed/closed.
  const requestedTab = useUIStore((s) => s.requestedTab);
  useEffect(() => {
    if (!requestedTab) return;
    const ui = useUIStore.getState();
    // Expand sidebar so <Sidebar/> mounts and picks up the requestedTab
    if (!isMobile && ui.sidebarCollapsed) ui.setSidebarCollapsed(false);
    if (isMobile && !ui.sidebarOpen) ui.setSidebarOpen(true);
  }, [requestedTab, isMobile]);

  // useForecastTimeline moved to DeferredHooks (audit S136+3 #8) — not on
  // critical path for first paint; consumers read from useForecastStore.

  // ── Deferred hooks — mount after 3s to unblock first paint ──
  const [deferredReady, setDeferredReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDeferredReady(true), 3000);
    return () => clearTimeout(t);
  }, []);

  // Read airspaceCheck from store (populated by useAirspace inside DeferredHooks)
  const airspaceCheck = useAirspaceStore((s) => s.check);

  // NAO/AO teleconnection indices — ref shared with DeferredHooks
  const teleconnectionsRef = useRef<TeleconnectionIndex[]>([]);

  // ── Map reveal crossfade — smooth transition as loading screen fades out ──
  const readingsCount = useWeatherStore((s) => s.currentReadings.size);
  const [mapRevealed, setMapRevealed] = useState(false);
  // showLoading tracks whether LoadingScreen should be mounted —
  // true on initial load AND on sector switch, false after data arrives + min time
  const [showLoading, setShowLoading] = useState(true);
  const loadingStartRef = useRef(Date.now());

  // Reset loading state on sector switch
  useEffect(() => {
    setShowLoading(true);
    setMapRevealed(false);
    loadingStartRef.current = Date.now();
  }, [activeSectorId]);

  // Reveal map immediately — tiles load fast, data overlays appear as they arrive.
  // This improves FCP: user sees the map base within ~2s instead of waiting ~12s.
  useEffect(() => {
    // Show map after 1.5s regardless of data — tiles are already loading
    const t = setTimeout(() => setMapRevealed(true), 1500);
    return () => clearTimeout(t);
  }, [activeSectorId]);

  // Hide LoadingScreen after min display time OR data ready (whichever is later)
  // activeSectorId in deps ensures timer resets on sector switch (prevents stale dismiss)
  useEffect(() => {
    const elapsed = Date.now() - loadingStartRef.current;
    // If data arrived, dismiss quickly. If not, dismiss after 5s max (map visible underneath)
    const maxWait = readingsCount > 0 ? Math.max(0, 2500 - elapsed) : 5000;
    const t = setTimeout(() => setShowLoading(false), maxWait);
    return () => clearTimeout(t);
  }, [readingsCount > 0, activeSectorId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Geolocation auto-sector removed (permission popup scared users)

  // Prune stale history moved to DeferredHooks (off critical path).
  // Daily summary moved to ingestor (24/7, single source, no visitor duplicates).

  // GDD season accumulation — deferred 20s to avoid Open-Meteo queue congestion at startup
  const [seasonGDD, setSeasonGDD] = useState<{ accumulated: number; days: number } | null>(null);
  const gddFetchedRef = useRef(false);
  useEffect(() => {
    if (gddFetchedRef.current) return;
    const [lon, lat] = activeSectorCenter;
    const t = setTimeout(() => {
      gddFetchedRef.current = true;
      fetchSeasonGDD(lat, lon).then((result) => {
        if (result) setSeasonGDD(result);
      });
    }, 20_000);
    return () => clearTimeout(t);
  }, [activeSectorCenter]);

  // ── Unified alert pipeline (extracted S136+3+2 TIER 2 A2-5) ──────
  // The 3-effect chain (lapseRate → fieldAlerts → unified aggregation)
  // lives in useUnifiedAlertPipeline now. AppShell only consumes
  // fieldAlerts (for Header). The 12+ store subscriptions stay isolated
  // in the hook so re-renders are scoped to the hook's internal state.
  const fieldAlerts = useUnifiedAlertPipeline({
    stations,
    airspaceCheck,
    seasonGDD,
    teleconnectionsRef,
  });

  // ── Keyboard shortcuts (desktop only) ───────────────────
  useEffect(() => {
    if (isMobile) return; // no keyboard shortcuts on mobile

    const LAYER_LABELS: Record<string, string> = {
      'none': 'Ninguna',
      'wind-particles': 'Viento',
      'humidity': 'Humedad',
      'satellite': 'Satélite',
      'radar': 'Radar',
    };

    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const toast = useToastStore.getState().addToast;

      switch (e.key.toLowerCase()) {
        case 'c':
          toggleFieldDrawer();
          toast('Panel de campo', 'info');
          break;
        case 'r':
          if (!e.ctrlKey && !e.metaKey) {
            forceRefresh();
            toast('Datos refrescados', 'success');
          }
          break;
        case 't':
          useTemperatureOverlayStore.getState().toggleOverlay();
          toast('Gradiente térmico', 'info');
          break;
        case 'a':
          useAlertStore.getState().togglePanel();
          toast('Panel de alertas', 'info');
          break;
        case 'w': {
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
  useEffect(() => {
    logPredictionSnapshot(stormPrediction, stormAlertLevel !== 'none', activeSectorId);
  }, [stormPrediction, stormAlertLevel, activeSectorId]);

  return (
    <div className="h-screen-safe w-full flex flex-col bg-slate-950 text-white overflow-hidden">
      {/* Skip to content — visible only on keyboard focus */}
      <a
        href="#main-map"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[9999] focus:px-4 focus:py-2 focus:bg-blue-700 focus:text-white focus:rounded-lg focus:text-sm focus:font-bold focus:shadow-lg focus:ring-2 focus:ring-blue-400 focus:outline-none"
      >
        Saltar al mapa
      </a>
      <Header
        onRefresh={forceRefresh}
        fieldDrawerOpen={fieldDrawerOpen}
        onToggleFieldDrawer={toggleFieldDrawer}
        fieldAlertLevel={fieldAlerts?.maxLevel ?? 'none'}
        windFront={fieldAlerts?.wind ? {
          active: fieldAlerts.wind.active,
          etaMin: fieldAlerts.wind.estimatedArrivalMin,
          directionLabel: fieldAlerts.wind.directionLabel,
          frontSpeedKt: fieldAlerts.wind.frontSpeedKt,
        } : null}
      />

      {/* Deferred hooks — mount after 3s to unblock first paint (LCP) */}
      {deferredReady && <DeferredHooks teleconnectionsRef={teleconnectionsRef} />}

      {/* Visual confirmation of simpleMode + escape hatch. Without this the
          user may toggle simpleMode by accident and not understand why content
          disappeared. Clickable → toggles back to advanced. */}
      {simpleMode && (
        <button
          onClick={() => useUIStore.getState().toggleSimpleMode()}
          className="w-full bg-amber-500/10 hover:bg-amber-500/20 border-b border-amber-500/30 px-3 py-1 text-[11px] text-amber-300 hover:text-amber-200 font-medium transition-colors flex items-center justify-center gap-2 min-h-[28px]"
          aria-label="Modo simple activo, pulsa para volver al modo avanzado"
          title="Pulsa para volver al modo avanzado"
        >
          <WeatherIcon id="eye-off" size={12} />
          <span>Modo simple activo · pulsa para ver todo</span>
        </button>
      )}

      {/* Ticker mounts ALWAYS — in simpleMode it self-filters to critical
          items only (official MG warnings + beach headline + safety). Hiding
          it entirely made simple-mode users miss official NARANJA warnings. */}
      <ErrorBoundary section="Ticker"><Suspense fallback={null}><ConditionsTicker simple={simpleMode} /></Suspense></ErrorBoundary>
      <SourceStatusBanner />
      {/* Magic Window banner (T2-2) — appears only when backend detector confirms
          a rare optimal-sailing convergence in Rías. Self-hides when not active. */}
      <MagicWindowBanner />

      <div className="flex-1 flex overflow-hidden relative">
        {/* Desktop sidebar: collapsible (icon strip ↔ full panel) */}
        {!isMobile && (
          <ErrorBoundary section="Sidebar">
            <aside
              className={`bg-slate-900 border-r border-slate-700 flex flex-col overflow-hidden transition-all duration-300 ${
                sidebarCollapsed ? 'w-14' : 'w-80'
              }`}
            >
              {sidebarCollapsed ? (
                <CollapsedSidebar onExpand={toggleSidebarCollapsed} />
              ) : (
                <>
                  <button
                    onClick={toggleSidebarCollapsed}
                    className="shrink-0 flex items-center justify-center h-8 text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors border-b border-slate-700/50"
                    aria-label="Colapsar panel"
                    title="Colapsar panel"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M15 19l-7-7 7-7" /></svg>
                  </button>
                  <Sidebar />
                </>
              )}
            </aside>
          </ErrorBoundary>
        )}

        {/* Mobile sidebar: slide-over panel */}
        {isMobile && sidebarOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/60 z-30 transition-opacity"
              onClick={() => setSidebarOpen(false)}
              onKeyDown={(e) => { if (e.key === 'Escape') setSidebarOpen(false); }}
              role="presentation"
            />
            <aside className="fixed inset-y-0 left-0 z-40 w-72 bg-slate-900 shadow-2xl flex flex-col overflow-hidden animate-slide-in-left">
              {/* Close button */}
              <button
                onClick={() => setSidebarOpen(false)}
                className="absolute top-2 right-2 z-50 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors active:bg-slate-600"
                aria-label="Cerrar panel"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <Sidebar />
            </aside>
          </>
        )}

        <main id="main-map" className={`flex-1 relative isolate transition-opacity duration-1000 map-dark-scope ${mapRevealed ? 'opacity-100' : 'opacity-0'}`}>
          <ErrorBoundary section="Mapa">
            <WeatherMap />
          </ErrorBoundary>

          {/* Mobile sailing banner: floating pill above the map (both sectors) */}
          {isMobile && !sidebarOpen && (
            <MobileSailingBanner />
          )}

          {/* Campo (field alerts) drawer — lazy loaded */}
          <Suspense fallback={null}>
            <FieldDrawer
              open={fieldDrawerOpen}
              onClose={() => setFieldDrawerOpen(false)}
              alerts={fieldAlerts}
            />
          </Suspense>
        </main>

        {/* Loading screen: OUTSIDE <main> so it's not affected by map opacity transition.
            Mounted on initial load & sector switch. Handles its own fade-out. */}
        {showLoading && (
          <LoadingScreen
            sectorName={activeSectorName}
            error={error}
            onRetry={retryDiscovery}
          />
        )}
      </div>
      <Suspense fallback={null}><ForecastPanel /></Suspense>
      <Suspense fallback={null}><MeteoGuide /></Suspense>
      <Suspense fallback={null}><FeedbackModal /></Suspense>
      {!isMobile && <KeyboardShortcutHelp />}
      <Suspense fallback={null}><OnboardingTour /></Suspense>
      <ToastContainer />
      <PwaInstallBanner />
      {isMobile && <MobileBottomNav />}
    </div>
  );
}
