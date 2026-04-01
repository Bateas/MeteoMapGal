import { useState, useMemo, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { WeatherIcon } from '../icons/WeatherIcons';
const FieldDrawer = lazy(() => import('./FieldDrawer').then(m => ({ default: m.FieldDrawer })));
import { WeatherMap } from '../map/WeatherMap';
import { useWeatherData } from '../../hooks/useWeatherData';
import { LoadingScreen } from '../common/LoadingScreen';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';
import { useThermalAnalysis } from '../../hooks/useThermalAnalysis';
import { useLightningData, useLightningStore } from '../../hooks/useLightningData';
import { useStormShadow, useStormShadowStore } from '../../hooks/useStormShadow';
import { useForecastTimeline, useForecastStore } from '../../hooks/useForecastTimeline';
import { checkAllFieldAlerts } from '../../services/fieldAlertEngine';
import { fetchSeasonGDD } from '../../services/gddService';
import { useTemperatureOverlayStore } from '../../store/temperatureOverlayStore';
import { useThermalStore } from '../../store/thermalStore';
import { useAlertStore } from '../../store/alertStore';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { KeyboardShortcutHelp } from '../common/KeyboardShortcutHelp';
const MeteoGuide = lazy(() => import('../guide/MeteoGuide').then(m => ({ default: m.MeteoGuide })));
const FeedbackModal = lazy(() => import('../common/FeedbackModal').then(m => ({ default: m.FeedbackModal })));
import { ToastContainer } from '../common/ToastContainer';
const OnboardingTour = lazy(() => import('../common/OnboardingTour').then(m => ({ default: m.OnboardingTour })));
// Daily summary DISABLED in frontend — moved to ingestor (24/7, no duplicate sends)
// import { shouldSendDailySummary, sendDailySummary } from '../../services/dailySummaryService';
import { tryAutoSector } from '../../services/geolocationService';
import { ConditionsTicker } from '../common/ConditionsTicker';
import { SourceStatusBanner } from '../common/SourceStatusBanner';
import { PwaInstallBanner } from '../common/PwaInstallBanner';
import { aggregateAllAlerts } from '../../services/alertService';
import { useThemeStore } from '../../store/themeStore';
import { processAlertNotifications } from '../../services/notificationService';
import { useNotificationStore } from '../../store/notificationStore';
import {
  extractStationTemps,
  analyzeThermalProfile,
} from '../../services/lapseRateService';
import { useSectorStore } from '../../store/sectorStore';
import { useBuoyStore } from '../../store/buoyStore';
import { useUIStore } from '../../store/uiStore';
import { useToastStore } from '../../store/toastStore';
import { useAirspace } from '../../hooks/useAirspace';
import { useBuoyData } from '../../hooks/useBuoyData';
import { useSpotScoring } from '../../hooks/useSpotScoring';
import { useSailingWindows } from '../../hooks/useSailingWindows';
import { useWebcamVision } from '../../hooks/useWebcamVision';
import { MobileSailingBanner } from '../dashboard/MobileSailingBanner';
import { fetchTeleconnections, type TeleconnectionIndex } from '../../api/naoClient';

/** Collapsed sidebar: vertical icon strip with tab shortcuts */
function CollapsedSidebar({ onExpand }: { onExpand: () => void }) {
  const TABS = [
    { icon: 'map-pin' as const, label: 'Estaciones', shortcut: '1' },
    { icon: 'activity' as const, label: 'Gráfica', shortcut: '2' },
    { icon: 'compass' as const, label: 'Previsión', shortcut: '3' },
    { icon: 'layers' as const, label: 'Rankings', shortcut: '4' },
    { icon: 'clock' as const, label: 'Historial', shortcut: '5' },
  ];
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
      {/* Tab icons */}
      {TABS.map((tab) => (
        <button
          key={tab.label}
          onClick={onExpand}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:text-sky-400 hover:bg-slate-800/60 transition-colors"
          title={`${tab.label} (${tab.shortcut})`}
          aria-label={tab.label}
        >
          <WeatherIcon id={tab.icon} size={16} />
        </button>
      ))}
      {/* Spacer */}
      <div className="flex-1" />
      {/* Guide + Feedback at bottom */}
      <button
        onClick={() => useUIStore.getState().toggleGuide()}
        className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:text-sky-400 hover:bg-slate-800/60 transition-colors"
        title="Guía (G)"
        aria-label="Guía"
      >
        <WeatherIcon id="book-open" size={14} />
      </button>
      <button
        onClick={() => useUIStore.getState().setFeedbackOpen(true)}
        className="w-9 h-9 flex items-center justify-center rounded-lg text-emerald-500/60 hover:text-emerald-400 hover:bg-emerald-900/30 transition-colors"
        title="Feedback"
        aria-label="Feedback"
      >
        <WeatherIcon id="message-square" size={14} />
      </button>
      <a
        href="https://ko-fi.com/meteomapgal"
        target="_blank"
        rel="noopener noreferrer"
        className="w-9 h-9 flex items-center justify-center rounded-lg text-amber-500/50 hover:text-amber-400 hover:bg-amber-900/20 transition-colors"
        title="Apoyar el proyecto"
        aria-label="Apoyar en Ko-fi"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" y1="2" x2="6" y2="4"/><line x1="10" y1="2" x2="10" y2="4"/><line x1="14" y1="2" x2="14" y2="4"/></svg>
      </a>
    </div>
  );
}

export function AppShell() {
  const { forceRefresh, retryDiscovery } = useWeatherData();
  const isLoading = useWeatherStore((s) => s.isLoading);
  const error = useWeatherStore((s) => s.error);
  const stations = useWeatherStore((s) => s.stations);
  const activeSector = useSectorStore((s) => s.activeSector);

  // ── Responsive state ──────────────────────────────────
  const isMobile = useUIStore((s) => s.isMobile);
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
  }, [sidebarOpen, isMobile]);

  // Thermal wind analysis: scores rules, detects propagation, fetches forecast
  useThermalAnalysis();

  // Lightning detection: polls every 2 min, computes storm proximity alerts
  useLightningData();

  // Storm shadow detection: cross-references solar radiation drops + lightning
  useStormShadow();

  // Hourly forecast timeline: 48h Open-Meteo for reservoir, polls every 30 min
  useForecastTimeline();

  // Airspace restrictions: ENAIRE UAS zones + NOTAMs (polls every 30 min)
  const airspaceCheck = useAirspace();

  // Marine buoy data: PORTUS + Observatorio Costeiro (10 min refresh, only active for Rías)
  useBuoyData();

  // Spot-based sailing scores: re-scores when station/buoy data changes (only for Rías)
  useSpotScoring();

  // Best Sailing Windows: 48h forecast → per-spot window detection (polls every 30 min)
  useSailingWindows();

  // Webcam Vision: Beaufort estimation via LLM (dev only, VITE_VISION_ENABLED=true)
  useWebcamVision();

  // NAO/AO teleconnection indices — deferred 15s to avoid startup congestion (also fetched in useSpotScoring with 6h cache)
  const teleconnectionsRef = useRef<TeleconnectionIndex[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      fetchTeleconnections()
        .then((data) => { teleconnectionsRef.current = data; })
        .catch(() => { /* graceful degradation — alerts work without */ });
    }, 15_000);
    return () => clearTimeout(t);
  }, []);

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
  }, [activeSector.id]);

  // Reveal map after readings arrive — with a slight delay for crossfade
  useEffect(() => {
    if (readingsCount === 0) {
      setMapRevealed(false);
      return;
    }
    // Delay map reveal so the loading screen starts fading first
    const t = setTimeout(() => setMapRevealed(true), 500);
    return () => clearTimeout(t);
  }, [readingsCount > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hide LoadingScreen after min display + data ready
  useEffect(() => {
    if (readingsCount === 0) return;
    const elapsed = Date.now() - loadingStartRef.current;
    const remaining = Math.max(0, 3200 - elapsed); // match LoadingScreen min (2500) + fade (700)
    const t = setTimeout(() => setShowLoading(false), remaining);
    return () => clearTimeout(t);
  }, [readingsCount > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Geolocation auto-sector (runs once per device, first visit only)
  useEffect(() => { tryAutoSector(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Prune stale reading history every 30 min (entries > 24h old) + daily summary check
  const pruneHistory = useWeatherStore((s) => s.pruneHistory);
  const pruneAlertHistory = useAlertStore((s) => s.pruneAlertHistory);
  useEffect(() => {
    const id = setInterval(() => {
      pruneHistory();
      pruneAlertHistory();
      // Daily summary moved to ingestor (24/7, single source, no visitor duplicates)
    }, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, [pruneHistory, pruneAlertHistory]);

  // Campo (agricultural alerts) drawer
  const [fieldDrawerOpen, setFieldDrawerOpen] = useState(false);
  const forecastHourly = useForecastStore((s) => s.hourly);
  const readingHistory = useWeatherStore((s) => s.readingHistory);
  const historyEpoch = useWeatherStore((s) => s.historyEpoch);
  const currentReadings = useWeatherStore((s) => s.currentReadings);

  // GDD season accumulation — deferred 20s to avoid Open-Meteo queue congestion at startup
  const [seasonGDD, setSeasonGDD] = useState<{ accumulated: number; days: number } | null>(null);
  const gddFetchedRef = useRef(false);
  useEffect(() => {
    if (gddFetchedRef.current) return;
    const [lon, lat] = activeSector.center;
    const t = setTimeout(() => {
      gddFetchedRef.current = true;
      fetchSeasonGDD(lat, lon).then((result) => {
        if (result) setSeasonGDD(result);
      });
    }, 20_000);
    return () => clearTimeout(t);
  }, [activeSector.center]);

  const fieldAlerts = useMemo(
    () => (forecastHourly.length > 0 || readingHistory.size > 0
      ? checkAllFieldAlerts(forecastHourly, readingHistory, stations, currentReadings, activeSector.center, airspaceCheck, seasonGDD)
      : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- historyEpoch is a stable proxy for readingHistory changes
    [forecastHourly, historyEpoch, stations, currentReadings, activeSector.center, airspaceCheck, seasonGDD],
  );
  const toggleFieldDrawer = useCallback(() => {
    setFieldDrawerOpen((o) => {
      // On mobile: close sidebar when opening field drawer (mutual exclusion)
      if (!o && useUIStore.getState().isMobile) {
        useUIStore.getState().setSidebarOpen(false);
      }
      return !o;
    });
  }, []);

  // ── Temperature gradient: compute lapse rate on every reading update ──
  const setThermalProfile = useTemperatureOverlayStore((s) => s.setThermalProfile);
  useEffect(() => {
    if (stations.length === 0 || currentReadings.size === 0) return;
    const temps = extractStationTemps(stations, currentReadings);
    if (temps.length < 2) return;
    const profile = analyzeThermalProfile(temps);
    setThermalProfile(profile);
  }, [stations, currentReadings, setThermalProfile]);

  // ── Unified alert aggregation + notifications ──────────
  const stormAlert = useLightningStore((s) => s.stormAlert);
  const stormShadow = useStormShadowStore((s) => s.stormShadow);
  const zoneAlerts = useThermalStore((s) => s.zoneAlerts);
  const thermalProfile = useTemperatureOverlayStore((s) => s.thermalProfile);
  const setUnifiedAlerts = useAlertStore((s) => s.setAlerts);
  const notifConfig = useNotificationStore((s) => s.config);
  const buoys = useBuoyStore((s) => s.buoys);
  const sstHistory = useBuoyStore((s) => s.sstHistory);
  // Use fetchedAt as stable trigger instead of the array (avoids React deps size warning)
  const forecastFetchedAt = useForecastStore((s) => s.fetchedAt);
  const forecastRef = useRef(forecastHourly);
  forecastRef.current = forecastHourly;

  useEffect(() => {
    // Station geo for maritime fog (nearby station lookup)
    const stationsGeo = stations.map((s) => ({ id: s.id, lat: s.lat, lon: s.lon }));
    const { alerts, risk } = aggregateAllAlerts({
      stormAlert,
      thermalProfile,
      zoneAlerts,
      fieldAlerts,
      forecast: forecastRef.current,
      stormShadow,
      currentReadings,
      readingHistory,
      // Maritime alerts (cross-sea, fog, upwelling) only apply to coastal Rías sector
      buoys: activeSector.id === 'rias' && buoys.length > 0 ? buoys : undefined,
      sstHistory: activeSector.id === 'rias' && sstHistory.size > 0 ? sstHistory : undefined,
      stationsGeo: stationsGeo.length > 0 ? stationsGeo : undefined,
      teleconnections: teleconnectionsRef.current.length > 0 ? teleconnectionsRef.current : undefined,
    });
    setUnifiedAlerts(alerts, risk);
    // Trigger notifications for new/escalated alerts
    processAlertNotifications(alerts, risk, notifConfig);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- historyEpoch is a stable proxy for readingHistory
  }, [stormAlert, stormShadow, thermalProfile, zoneAlerts, fieldAlerts, forecastFetchedAt, setUnifiedAlerts, notifConfig, currentReadings, historyEpoch, buoys, sstHistory, stations, activeSector.id]);

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
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobile, toggleFieldDrawer, forceRefresh]);

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

      <ErrorBoundary section="Ticker"><ConditionsTicker /></ErrorBoundary>
      <SourceStatusBanner />

      <div className="flex-1 flex overflow-hidden relative">
        {/* Desktop sidebar: collapsible (icon strip ↔ full panel) */}
        {!isMobile && (
          <ErrorBoundary section="Sidebar">
            <aside
              className={`bg-slate-900 border-r border-slate-700 flex flex-col overflow-hidden transition-all duration-300 ${
                sidebarCollapsed ? 'w-12' : 'w-80'
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
            sectorName={activeSector.name}
            error={error}
            onRetry={retryDiscovery}
          />
        )}
      </div>
      <Suspense fallback={null}><MeteoGuide /></Suspense>
      <Suspense fallback={null}><FeedbackModal /></Suspense>
      {!isMobile && <KeyboardShortcutHelp />}
      <Suspense fallback={null}><OnboardingTour /></Suspense>
      <ToastContainer />
      <PwaInstallBanner />

      {/* Ko-fi link moved to MeteoGuide (below Aviso Legal) + Sidebar */}
    </div>
  );
}
