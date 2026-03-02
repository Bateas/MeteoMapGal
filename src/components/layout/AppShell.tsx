import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
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
import { useForecastTimeline, useForecastStore } from '../../hooks/useForecastTimeline';
import { checkAllFieldAlerts } from '../../services/fieldAlertEngine';
import { useTemperatureOverlayStore } from '../../store/temperatureOverlayStore';
import { useThermalStore } from '../../store/thermalStore';
import { useAlertStore } from '../../store/alertStore';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { KeyboardShortcutHelp } from '../common/KeyboardShortcutHelp';
import { aggregateAllAlerts } from '../../services/alertService';
import { processAlertNotifications } from '../../services/notificationService';
import { useNotificationStore } from '../../store/notificationStore';
import {
  extractStationTemps,
  analyzeThermalProfile,
} from '../../services/lapseRateService';

export function AppShell() {
  const { forceRefresh, retryDiscovery } = useWeatherData();
  const isLoading = useWeatherStore((s) => s.isLoading);
  const error = useWeatherStore((s) => s.error);
  const stations = useWeatherStore((s) => s.stations);

  // Thermal wind analysis: scores rules, detects propagation, fetches forecast
  useThermalAnalysis();

  // Lightning detection: polls every 2 min, computes storm proximity alerts
  useLightningData();

  // Hourly forecast timeline: 48h Open-Meteo for reservoir, polls every 30 min
  useForecastTimeline();

  // Campo (agricultural alerts) drawer
  const [fieldDrawerOpen, setFieldDrawerOpen] = useState(false);
  const forecastHourly = useForecastStore((s) => s.hourly);
  const readingHistory = useWeatherStore((s) => s.readingHistory);
  const currentReadings = useWeatherStore((s) => s.currentReadings);
  const fieldAlerts = useMemo(
    () => (forecastHourly.length > 0 || readingHistory.size > 0
      ? checkAllFieldAlerts(forecastHourly, readingHistory, stations, currentReadings)
      : null),
    [forecastHourly, readingHistory, stations, currentReadings],
  );
  const toggleFieldDrawer = useCallback(() => setFieldDrawerOpen((o) => !o), []);

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
    });
    setUnifiedAlerts(alerts, risk);
    // Trigger notifications for new/escalated alerts
    processAlertNotifications(alerts, risk, notifConfig);
  }, [stormAlert, thermalProfile, zoneAlerts, fieldAlerts, forecastFetchedAt, setUnifiedAlerts, notifConfig]);

  // ── Keyboard shortcuts ──────────────────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key.toLowerCase()) {
        case 'c':
          toggleFieldDrawer();
          break;
        case 'r':
          if (!e.ctrlKey && !e.metaKey) forceRefresh();
          break;
        case 't':
          useTemperatureOverlayStore.getState().toggleOverlay();
          break;
        case 'a':
          useAlertStore.getState().togglePanel();
          break;
        case 'w':
          useWeatherLayerStore.getState().cycleLayer();
          break;
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleFieldDrawer, forceRefresh]);

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950 text-white">
      <Header
        onRefresh={forceRefresh}
        fieldDrawerOpen={fieldDrawerOpen}
        onToggleFieldDrawer={toggleFieldDrawer}
        fieldAlertLevel={fieldAlerts?.maxLevel ?? 'none'}
      />

      <div className="flex-1 flex overflow-hidden relative">
        <ErrorBoundary section="Sidebar">
          <Sidebar />
        </ErrorBoundary>

        <main className="flex-1 relative">
          <ErrorBoundary section="Mapa">
            <WeatherMap />
          </ErrorBoundary>

          {/* Loading / error overlay (only when no stations yet) */}
          {stations.length === 0 && (isLoading || error) && (
            <div className="absolute inset-0 bg-slate-950/80 flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-3">
                {isLoading ? (
                  <>
                    <LoadingSpinner size={40} />
                    <span className="text-sm text-slate-400">
                      Descubriendo estaciones en Ourense...
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
      <KeyboardShortcutHelp />
    </div>
  );
}
