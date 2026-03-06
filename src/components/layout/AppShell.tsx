import { useState, useMemo, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { FieldDrawer } from './FieldDrawer';
import { WeatherMap } from '../map/WeatherMap';
import { useWeatherData } from '../../hooks/useWeatherData';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { useWeatherStore } from '../../store/weatherStore';
import { useThermalAnalysis } from '../../hooks/useThermalAnalysis';
import { useLightningData, useLightningStore } from '../../hooks/useLightningData';
import { useStormShadow, useStormShadowStore } from '../../hooks/useStormShadow';
import { useForecastTimeline, useForecastStore } from '../../hooks/useForecastTimeline';
import { checkAllFieldAlerts } from '../../services/fieldAlertEngine';
import { useTemperatureOverlayStore } from '../../store/temperatureOverlayStore';
import { useThermalStore } from '../../store/thermalStore';
import { useAlertStore } from '../../store/alertStore';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { KeyboardShortcutHelp } from '../common/KeyboardShortcutHelp';
import { BigWindDisplay } from '../map/BigWindDisplay';
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
import { useUIStore } from '../../store/uiStore';
import { useToastStore } from '../../store/toastStore';
import { useAirspace } from '../../hooks/useAirspace';
import { MobileSailingBanner } from '../dashboard/MobileSailingBanner';

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
  const fieldAlerts = useMemo(
    () => (forecastHourly.length > 0 || readingHistory.size > 0
      ? checkAllFieldAlerts(forecastHourly, readingHistory, stations, currentReadings, activeSector.center, airspaceCheck)
      : null),
    [forecastHourly, readingHistory, stations, currentReadings, activeSector.center, airspaceCheck],
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
  // Use fetchedAt as stable trigger instead of the array (avoids React deps size warning)
  const forecastFetchedAt = useForecastStore((s) => s.fetchedAt);
  const forecastRef = useRef(forecastHourly);
  forecastRef.current = forecastHourly;

  useEffect(() => {
    const { alerts, risk } = aggregateAllAlerts({
      stormAlert,
      thermalProfile,
      zoneAlerts,
      fieldAlerts,
      forecast: forecastRef.current,
      stormShadow,
    });
    setUnifiedAlerts(alerts, risk);
    // Trigger notifications for new/escalated alerts
    processAlertNotifications(alerts, risk, notifConfig);
  }, [stormAlert, stormShadow, thermalProfile, zoneAlerts, fieldAlerts, forecastFetchedAt, setUnifiedAlerts, notifConfig]);

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
    <div className="h-screen w-full flex flex-col bg-slate-950 text-white overflow-hidden">
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

        <main className="flex-1 relative">
          <ErrorBoundary section="Mapa">
            <WeatherMap />
          </ErrorBoundary>

          {/* Mobile sailing banner: floating pill above the map */}
          {isMobile && activeSector.id === 'embalse' && !sidebarOpen && (
            <MobileSailingBanner />
          )}

          {/* Loading / error overlay (only when no stations yet) */}
          {stations.length === 0 && (isLoading || error) && (
            <div className="absolute inset-0 bg-slate-950/80 flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-3">
                {isLoading ? (
                  <>
                    <LoadingSpinner size={40} />
                    <span className="text-sm text-slate-400">
                      Descubriendo estaciones en {activeSector.name}...
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-sm text-red-400">{error}</span>
                    <button
                      onClick={retryDiscovery}
                      className="px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                    >
                      Reintentar
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Campo (field alerts) drawer */}
          <FieldDrawer
            open={fieldDrawerOpen}
            onClose={() => setFieldDrawerOpen(false)}
            alerts={fieldAlerts}
          />
        </main>
      </div>
      <BigWindDisplay />
      <Suspense fallback={null}><MeteoGuide /></Suspense>
      {!isMobile && <KeyboardShortcutHelp />}
      <ToastContainer />
    </div>
  );
}
