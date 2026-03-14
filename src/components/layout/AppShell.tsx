import { useState, useMemo, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { FieldDrawer } from './FieldDrawer';
import { WeatherMap } from '../map/WeatherMap';
import { useWeatherData } from '../../hooks/useWeatherData';
import { LoadingScreen } from '../common/LoadingScreen';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { useWeatherStore } from '../../store/weatherStore';
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
import { ToastContainer } from '../common/ToastContainer';
import { aggregateAllAlerts } from '../../services/alertService';
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
import { MobileSailingBanner } from '../dashboard/MobileSailingBanner';
import { fetchTeleconnections, type TeleconnectionIndex } from '../../api/naoClient';

export function AppShell() {
  const { forceRefresh, retryDiscovery } = useWeatherData();
  const isLoading = useWeatherStore((s) => s.isLoading);
  const error = useWeatherStore((s) => s.error);
  const stations = useWeatherStore((s) => s.stations);
  const activeSector = useSectorStore((s) => s.activeSector);

  // ── Responsive state ──────────────────────────────────
  const isMobile = useUIStore((s) => s.isMobile);
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
  const selectedStationId = useWeatherStore((s) => s.selectedStationId);
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

  // NAO/AO teleconnection indices — fetched once, cached 6h in naoClient
  const teleconnectionsRef = useRef<TeleconnectionIndex[]>([]);
  useEffect(() => {
    fetchTeleconnections()
      .then((data) => { teleconnectionsRef.current = data; })
      .catch(() => { /* graceful degradation — alerts work without */ });
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

  // Prune stale reading history every 30 min (entries > 24h old)
  const pruneHistory = useWeatherStore((s) => s.pruneHistory);
  const pruneAlertHistory = useAlertStore((s) => s.pruneAlertHistory);
  useEffect(() => {
    const id = setInterval(() => {
      pruneHistory();
      pruneAlertHistory();
    }, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, [pruneHistory, pruneAlertHistory]);

  // Campo (agricultural alerts) drawer
  const [fieldDrawerOpen, setFieldDrawerOpen] = useState(false);
  const forecastHourly = useForecastStore((s) => s.hourly);
  const readingHistory = useWeatherStore((s) => s.readingHistory);
  const currentReadings = useWeatherStore((s) => s.currentReadings);

  // GDD season accumulation (fetched once per session, cached 1h)
  const [seasonGDD, setSeasonGDD] = useState<{ accumulated: number; days: number } | null>(null);
  const gddFetchedRef = useRef(false);
  useEffect(() => {
    if (gddFetchedRef.current) return;
    gddFetchedRef.current = true;
    const [lon, lat] = activeSector.center;
    fetchSeasonGDD(lat, lon).then((result) => {
      if (result) setSeasonGDD(result);
    });
  }, [activeSector.center]);

  const fieldAlerts = useMemo(
    () => (forecastHourly.length > 0 || readingHistory.size > 0
      ? checkAllFieldAlerts(forecastHourly, readingHistory, stations, currentReadings, activeSector.center, airspaceCheck, seasonGDD)
      : null),
    [forecastHourly, readingHistory, stations, currentReadings, activeSector.center, airspaceCheck, seasonGDD],
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
  }, [stormAlert, stormShadow, thermalProfile, zoneAlerts, fieldAlerts, forecastFetchedAt, setUnifiedAlerts, notifConfig, currentReadings, readingHistory, buoys, sstHistory, stations, activeSector.id]);

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

      <div className="flex-1 flex overflow-hidden relative">
        {/* Desktop sidebar: always visible */}
        {!isMobile && (
          <ErrorBoundary section="Sidebar">
            <aside className="w-80 bg-slate-900 border-r border-slate-700 flex flex-col overflow-hidden">
              <Sidebar />
            </aside>
          </ErrorBoundary>
        )}

        {/* Mobile sidebar: slide-over panel */}
        {isMobile && sidebarOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/60 z-30 transition-opacity"
              onClick={() => setSidebarOpen(false)}
            />
            <aside className="fixed inset-y-0 left-0 z-40 w-72 bg-slate-900 shadow-2xl flex flex-col overflow-hidden animate-slide-in-left">
              {/* Close button */}
              <button
                onClick={() => setSidebarOpen(false)}
                className="absolute top-2 right-2 z-50 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                aria-label="Cerrar panel"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <Sidebar />
            </aside>
          </>
        )}

        <main className={`flex-1 relative transition-opacity duration-1000 ${mapRevealed ? 'opacity-100' : 'opacity-0'}`}>
          <ErrorBoundary section="Mapa">
            <WeatherMap />
          </ErrorBoundary>

          {/* Mobile sailing banner: floating pill above the map (both sectors) */}
          {isMobile && !sidebarOpen && (
            <MobileSailingBanner />
          )}

          {/* Campo (field alerts) drawer */}
          <FieldDrawer
            open={fieldDrawerOpen}
            onClose={() => setFieldDrawerOpen(false)}
            alerts={fieldAlerts}
          />
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
      {!isMobile && <KeyboardShortcutHelp />}
      <ToastContainer />
    </div>
  );
}
