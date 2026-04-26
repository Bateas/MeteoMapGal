/**
 * FieldDrawer — right-side tabbed drawer for weather alerts.
 * Four context tabs: Navegación, Campo, Dron, Meteo.
 * Overlays the map. Doesn't touch the sidebar.
 */

import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import type { FieldAlerts, AlertLevel } from '../../types/campo';
import type { HourlyForecast } from '../../types/forecast';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { checkFrost, checkRainHail } from '../../services/fieldAlertEngine';
import { useUIStore } from '../../store/uiStore';
import { useAirspaceStore } from '../../store/airspaceStore';
import { useAlertStore } from '../../store/alertStore';
import type { NotamSummary } from '../../services/airspaceService';
import { SkeletonLoader } from '../common/SkeletonLoader';
import { WeatherIcon } from '../icons/WeatherIcons';
import type { IconId } from '../icons/WeatherIcons';
import { useSectorStore } from '../../store/sectorStore';
import { useThermalStore } from '../../store/thermalStore';
import { getLunarPhase, getLunarCalendar } from '../../services/lunarService';
import { msToKnots } from '../../services/windUtils';
import { useStormPrediction } from '../../hooks/useStormPrediction';
import type { StormPrediction, StormSignal } from '../../services/stormPredictor';
import { useWarningsStore } from '../../hooks/useWarnings';
import { warningLevelColor, classifyWarningType } from '../../api/mgWarningsClient';

// Lazy-load heavy dashboard components (~400 lines each)
const TidePanel = lazy(() => import('../dashboard/TidePanel').then(m => ({ default: m.TidePanel })));
const AtmosphericProfile = lazy(() => import('../dashboard/AtmosphericProfile').then(m => ({ default: m.AtmosphericProfile })));

export type AlertTab = 'nav' | 'campo' | 'dron';

const TABS: { id: AlertTab; label: string; icon: IconId | null; shortcut: string }[] = [
  { id: 'nav', label: 'Condiciones', icon: 'activity', shortcut: '1' },
  { id: 'campo', label: 'Campo', icon: 'leaf', shortcut: '2' },
  { id: 'dron', label: 'Dron', icon: 'drone', shortcut: '3' },
];

interface FieldDrawerProps {
  open: boolean;
  onClose: () => void;
  alerts: FieldAlerts | null;
}

const LEVEL_COLORS: Record<AlertLevel, { bg: string; text: string; border: string }> = {
  none: { bg: 'rgba(100,116,139,0.1)', text: '#64748b', border: 'rgba(100,116,139,0.2)' },
  riesgo: { bg: 'rgba(59,130,246,0.1)', text: '#3b82f6', border: 'rgba(59,130,246,0.3)' },
  alto: { bg: 'rgba(245,158,11,0.1)', text: '#f59e0b', border: 'rgba(245,158,11,0.3)' },
  critico: { bg: 'rgba(239,68,68,0.15)', text: '#ef4444', border: 'rgba(239,68,68,0.3)' },
};

const LEVEL_LABELS: Record<AlertLevel, string> = {
  none: 'Sin alerta',
  riesgo: 'Riesgo',
  alto: 'Alto',
  critico: 'Critico',
};

function formatTimeRange(from: Date, to: Date): string {
  const fmt = (d: Date) => d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  return `${fmt(from)} - ${fmt(to)}`;
}

export function FieldDrawer({ open, onClose, alerts }: FieldDrawerProps) {
  const drawerRef = useFocusTrap<HTMLDivElement>(open);
  const [activeTab, setActiveTab] = useState<AlertTab>('nav');
  const isMobile = useUIStore((s) => s.isMobile);
  const setDroneTabActive = useUIStore((s) => s.setDroneTabActive);
  const forecastHourly = useForecastStore((s) => s.hourly);
  const activeSectorId = useSectorStore((s) => s.activeSector.id);
  const isRias = activeSectorId === 'rias';
  const isEmbalse = activeSectorId === 'embalse';

  // Sync drone tab state to uiStore (controls AirspaceOverlay visibility)
  useEffect(() => {
    setDroneTabActive(open && activeTab === 'dron');
  }, [open, activeTab, setDroneTabActive]);

  // Close on click outside (but NOT on map interactions — user needs to pan/zoom while drawer is open)
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        // Don't close when clicking/dragging on the map — user may be panning or inspecting airspace
        const target = e.target as HTMLElement;
        if (target.closest('.maplibregl-map') || target.closest('.maplibregl-canvas-container')) {
          return;
        }
        onClose();
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [open, onClose]);

  // Tab switching via number keys when drawer is open (desktop only)
  const handleTabKey = useCallback((e: KeyboardEvent) => {
    if (!open || isMobile) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const idx = parseInt(e.key) - 1;
    if (idx >= 0 && idx < TABS.length) {
      setActiveTab(TABS[idx].id);
    }
  }, [open, isMobile]);

  useEffect(() => {
    if (isMobile) return;
    window.addEventListener('keydown', handleTabKey);
    return () => window.removeEventListener('keydown', handleTabKey);
  }, [isMobile, handleTabKey]);

  return (
    <div
      ref={drawerRef}
      role="dialog"
      aria-label="Condiciones, alertas y campo"
      className={`fixed bg-slate-900/95 backdrop-blur-sm transition-all duration-300 ease-in-out overflow-hidden ${
        isMobile
          ? `inset-x-0 z-50 rounded-t-2xl border-t border-slate-700 max-w-full ${open ? 'translate-y-0' : 'translate-y-full'}`
          : `right-0 top-0 h-full w-72 z-30 border-l border-slate-700 ${open ? 'translate-x-0' : 'translate-x-full'}`
      }`}
      style={isMobile ? { bottom: 'calc(48px + env(safe-area-inset-bottom, 0px))', maxHeight: '60dvh' } : undefined}
    >
      {/* Mobile drag handle */}
      {isMobile && (
        <div className="flex justify-center py-2">
          <div className="w-10 h-1 rounded-full bg-slate-600" />
        </div>
      )}

      {/* Header */}
      <div className={`flex items-center justify-between border-b border-slate-700 ${isMobile ? 'px-4 pb-2' : 'p-3'}`}>
        <div className="flex items-center gap-2">
          <span className={`font-bold text-white ${isMobile ? 'text-base' : 'text-sm'}`}>Condiciones</span>
          {alerts && (() => {
            const count = [alerts.frost, alerts.rain, alerts.fog, alerts.wind].filter(a => a?.level !== 'none').length;
            return count > 0 ? (
              <span className="bg-amber-500 text-slate-900 text-[11px] font-bold rounded-full px-1.5 py-0.5 leading-none">{count}</span>
            ) : null;
          })()}
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-200 text-lg leading-none min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg active:bg-slate-700"
          aria-label="Cerrar panel de alertas"
        >
          &times;
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-700/50">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 font-semibold transition-colors relative ${
              isMobile ? 'py-3 text-xs' : 'py-2 text-[11px]'
            } ${
              activeTab === tab.id
                ? 'text-blue-400'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {tab.icon && <WeatherIcon id={tab.icon} size={isMobile ? 16 : 12} />}
            <span>{tab.label}</span>
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-1 right-1 h-0.5 bg-blue-500 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {!alerts ? (
        <div className="p-4 text-xs text-slate-500 text-center">
          Cargando datos de previsión...
        </div>
      ) : (
        <div className={`space-y-3 overflow-y-auto ${isMobile ? 'p-4 max-h-[calc(60dvh-100px)]' : 'p-3 h-[calc(100%-92px)]'}`}>
          {/* ── Navegación tab: wind propagation + fog + tides (Rías) + atmospheric (Embalse) ── */}
          {activeTab === 'nav' && (
            <>
              <Suspense fallback={<SkeletonLoader lines={3} compact />}>
                {isRias && <TidePanel />}
                {isEmbalse && (
                  <AlertSection icon={<WeatherIcon id="cloud" size={14} />} title="Perfil Atmosférico" level="none" beta>
                    <AtmosphericProfile />
                  </AlertSection>
                )}
              </Suspense>
              {isEmbalse && (
                <AlertSection icon={<WeatherIcon id="wind" size={14} />} title="Viento en estaciones" level="none" beta>
                  <WindStatusSection alerts={alerts} />
                </AlertSection>
              )}
              <MGWarningsSection />
              <StormPredictionSection />
              <FogSection alerts={alerts} />
              <AlertHistorySection />
            </>
          )}

          {/* ── Campo tab: frost + rain/hail + fog + ET₀ + disease ── */}
          {activeTab === 'campo' && (
            <>
              <FrostSection alerts={alerts} />
              <RainSection alerts={alerts} />
              <FogSection alerts={alerts} />
              <ET0Section alerts={alerts} />
              <DiseaseSection alerts={alerts} />
              <GDDSection alerts={alerts} />
              <LunarSection />
            </>
          )}

          {/* ── Dron tab: drone conditions + airspace + wind + rain + fog ── */}
          {activeTab === 'dron' && (
            <>
              <DroneSection alerts={alerts} forecast={forecastHourly} />
              <AirspaceSection />
              {isEmbalse && <WindStatusSection alerts={alerts} />}
              <RainSection alerts={alerts} />
              <FogSection alerts={alerts} />
            </>
          )}

          {/* 48h timeline always visible */}
          {forecastHourly.length > 0 && (
            <AlertTimeline forecast={forecastHourly} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Per-module render components ──────────────────────────

function FrostSection({ alerts }: { alerts: FieldAlerts }) {
  return (
    <AlertSection icon={<WeatherIcon id="snowflake" size={14} />} title="Helada" level={alerts.frost.level}>
      {alerts.frost.level === 'none' ? (
        <p className="text-[11px] text-slate-500">Sin riesgo de helada en las próximas 48h</p>
      ) : (
        <div className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">Temp mínima</span>
            <span className="text-blue-300 font-bold">{alerts.frost.minTemp?.toFixed(1)}°C</span>
          </div>
          {alerts.frost.timeWindow && (
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">Ventana riesgo</span>
              <span className="text-slate-300 font-mono">
                {formatTimeRange(alerts.frost.timeWindow.from, alerts.frost.timeWindow.to)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">Nubes</span>
            <span className="text-slate-300">{alerts.frost.cloudCover?.toFixed(0) ?? '-'}%</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">Viento</span>
            <span className="text-slate-300">{alerts.frost.windSpeed != null ? msToKnots(alerts.frost.windSpeed).toFixed(0) : '-'} kt</span>
          </div>
        </div>
      )}
    </AlertSection>
  );
}

function RainSection({ alerts }: { alerts: FieldAlerts }) {
  return (
    <AlertSection
      icon={<WeatherIcon id={alerts.rain.hailRisk ? 'hail' : 'cloud-rain'} size={14} />}
      title={alerts.rain.hailRisk ? 'Granizo' : 'Lluvia'}
      level={alerts.rain.level}
    >
      {alerts.rain.level === 'none' ? (
        <p className="text-[11px] text-slate-500">Sin lluvia significativa prevista</p>
      ) : (
        <div className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">Precip máx/h</span>
            <span className="text-blue-300 font-bold">{alerts.rain.maxPrecip.toFixed(1)} mm</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">Probabilidad</span>
            <span className="text-slate-300">{alerts.rain.maxProbability}%</span>
          </div>
          {alerts.rain.rainAccum6h > 0 && (
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">Acum. 6h</span>
              <span className="text-blue-300 font-bold">{alerts.rain.rainAccum6h.toFixed(1)} mm</span>
            </div>
          )}
          {alerts.rain.hailRisk && (
            <div className="text-[11px] text-red-400 font-semibold mt-1">
              Riesgo de granizo detectado (CAPE alto + precipitación fuerte)
            </div>
          )}
        </div>
      )}
    </AlertSection>
  );
}

function MGWarningsSection() {
  const warnings = useWarningsStore((s) => s.sectorWarnings);
  const lastFetch = useWarningsStore((s) => s.lastFetch);

  if (warnings.length === 0) return null;

  const maxLevel = Math.max(...warnings.map((w) => w.maxLevel));
  const alertLevel: AlertLevel = maxLevel >= 3 ? 'critico' : maxLevel >= 2 ? 'alto' : maxLevel >= 1 ? 'riesgo' : 'none';

  const iconMap: Record<string, string> = {
    storm: 'zap',
    wave: 'waves',
    wind: 'wind',
    rain: 'cloud-rain',
    other: 'alert-triangle',
  };

  const ageMin = lastFetch ? Math.round((Date.now() - lastFetch.getTime()) / 60_000) : null;

  return (
    <AlertSection
      icon={<WeatherIcon id="alert-triangle" size={14} />}
      title="Avisos MeteoGalicia"
      level={alertLevel}
    >
      <div className="space-y-2">
        {warnings.map((w, i) => {
          const wType = classifyWarningType(w.type);
          const levelColor = warningLevelColor(w.maxLevel);
          const levelLabel = w.maxLevel === 3 ? 'ROJO' : w.maxLevel === 2 ? 'NARANJA' : 'AMARILLO';

          return (
            <div key={`mg-${i}`} className="rounded p-2" style={{ background: 'rgba(0,0,0,0.2)', border: `1px solid ${levelColor}33` }}>
              <div className="flex items-center gap-1.5 mb-1">
                <WeatherIcon id={(iconMap[wType] ?? 'alert-triangle') as import('../icons/WeatherIcons').IconId} size={12} />
                <span className="text-[11px] font-bold" style={{ color: levelColor }}>
                  {w.type} · {levelLabel}
                </span>
              </div>
              {w.zones.map((z, zi) => {
                const start = z.startTime.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
                const end = z.endTime.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
                return (
                  <div key={`z-${zi}`} className="text-[10px] text-slate-400 ml-3">
                    <span className="text-slate-300">{z.name}</span>
                    <span className="mx-1">·</span>
                    <span className="font-mono">{start}–{end}</span>
                    {z.comment && <span className="ml-1 italic text-slate-500">{z.comment}</span>}
                  </div>
                );
              })}
            </div>
          );
        })}
        {ageMin != null && (
          <p className="text-[10px] text-slate-600">Actualizado hace {ageMin}min · Fuente: MeteoGalicia</p>
        )}
      </div>
    </AlertSection>
  );
}

function StormPredictionSection() {
  const prediction = useStormPrediction();

  // Don't show section if prediction is negligible
  if (prediction.probability < 15) return null;

  const levelMap: Record<StormPrediction['horizon'], AlertLevel> = {
    imminent: 'critico',
    likely: 'alto',
    possible: 'riesgo',
    none: 'none',
  };
  const alertLevel = levelMap[prediction.horizon];

  const horizonLabel: Record<StormPrediction['horizon'], string> = {
    imminent: 'Inminente (<30min)',
    likely: 'Probable (30-60min)',
    possible: 'Posible (1-3h)',
    none: 'Baja',
  };

  const severityLabel: Record<StormPrediction['severity'], string> = {
    extreme: 'Extrema (granizo)',
    severe: 'Severa (eléctrica)',
    moderate: 'Moderada (lluvia+viento)',
    none: 'Sin severidad',
  };

  const severityColor: Record<StormPrediction['severity'], string> = {
    extreme: 'text-red-400',
    severe: 'text-purple-400',
    moderate: 'text-amber-400',
    none: 'text-slate-500',
  };

  return (
    <AlertSection icon={<WeatherIcon id="zap" size={14} />} title="Predicción Tormenta" level={alertLevel}>
      <div className="space-y-2">
        {/* Probability bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">Probabilidad</span>
            <span className={`font-bold ${prediction.probability >= 60 ? 'text-purple-400' : prediction.probability >= 40 ? 'text-amber-400' : 'text-slate-300'}`}>
              {prediction.probability}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-700/60 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${prediction.probability}%`,
                background: prediction.probability >= 60 ? '#a855f7' : prediction.probability >= 40 ? '#f59e0b' : '#64748b',
              }}
            />
          </div>
        </div>

        {/* Horizon + Severity */}
        <div className="flex justify-between text-[11px]">
          <span className="text-slate-400">Horizonte</span>
          <span className="text-slate-300 font-medium">{horizonLabel[prediction.horizon]}</span>
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-slate-400">Severidad</span>
          <span className={`font-medium ${severityColor[prediction.severity]}`}>{severityLabel[prediction.severity]}</span>
        </div>

        {/* ETA */}
        {prediction.etaMinutes != null && prediction.etaMinutes < 120 && (
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">ETA</span>
            <span className="text-purple-300 font-bold">~{prediction.etaMinutes} min</span>
          </div>
        )}

        {/* Signal breakdown */}
        <div className="mt-1.5 pt-1.5 border-t border-slate-700/40">
          <p className="text-[10px] text-slate-500 mb-1">Señales activas:</p>
          <div className="space-y-0.5">
            {prediction.signals.filter((s: StormSignal) => s.active).map((s: StormSignal) => (
              <div key={s.name} className="flex justify-between text-[10px]">
                <span className="text-slate-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400/60" />
                  {s.name}
                </span>
                <span className="text-slate-300 font-mono">{s.value}</span>
              </div>
            ))}
            {prediction.signals.filter((s: StormSignal) => !s.active).length > 0 && (
              <p className="text-[10px] text-slate-600 mt-0.5">
                {prediction.signals.filter((s: StormSignal) => !s.active).length} señales inactivas
              </p>
            )}
          </div>
        </div>

        {/* Action */}
        {prediction.horizon !== 'none' && (
          <div className="mt-1.5 p-1.5 rounded bg-slate-800/60 border border-slate-600/30">
            <p className={`text-[11px] font-medium ${prediction.horizon === 'imminent' ? 'text-red-400' : 'text-amber-300'}`}>
              {prediction.action}
            </p>
          </div>
        )}
      </div>
    </AlertSection>
  );
}

function FogSection({ alerts }: { alerts: FieldAlerts }) {
  if (!alerts.fog) return null;
  return (
    <AlertSection icon={<WeatherIcon id="fog" size={14} />} title="Niebla / Rocío" level={alerts.fog.level} beta>
      {alerts.fog.dewPoint !== null ? (
        <div className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">Punto de rocío</span>
            <span className="text-cyan-300 font-bold">{alerts.fog.dewPoint.toFixed(1)}°C</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">Spread (T - Td)</span>
            <span
              className="font-bold"
              style={{ color: (alerts.fog.spread ?? 99) <= 2 ? '#ef4444' : (alerts.fog.spread ?? 99) <= 4 ? '#f59e0b' : '#94a3b8' }}
            >
              {alerts.fog.spread?.toFixed(1) ?? '-'}°C
            </span>
          </div>
          {alerts.fog.spreadTrend !== null && (
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">Tendencia</span>
              <span
                className="font-semibold"
                style={{ color: alerts.fog.spreadTrend < -0.3 ? '#ef4444' : alerts.fog.spreadTrend < 0 ? '#f59e0b' : '#22c55e' }}
              >
                {alerts.fog.spreadTrend > 0 ? '+' : ''}{alerts.fog.spreadTrend.toFixed(1)}°C/h
                {alerts.fog.spreadTrend < -0.3 ? ' ↘' : alerts.fog.spreadTrend > 0.3 ? ' ↗' : ' →'}
              </span>
            </div>
          )}
          {alerts.fog.fogEta && (
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">ETA niebla</span>
              <span className="text-amber-300 font-bold font-mono">
                ~{alerts.fog.fogEta.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          )}
          {alerts.fog.humidity !== null && (
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">HR actual</span>
              <span className="text-slate-300">{alerts.fog.humidity.toFixed(0)}%</span>
            </div>
          )}
          {alerts.fog.windSpeed !== null && (
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">Viento</span>
              <span className="text-slate-300">{msToKnots(alerts.fog.windSpeed).toFixed(0)} kt</span>
            </div>
          )}
          <div className="mt-1.5 text-[11px] text-slate-400 italic leading-snug border-t border-slate-700/50 pt-1.5">
            {alerts.fog.hypothesis}
          </div>
          <ConfidenceBar value={alerts.fog.confidence} />
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">
          Recogiendo datos reales... (necesita ~30 min de lecturas)
        </p>
      )}
    </AlertSection>
  );
}

function WindStatusSection({ alerts }: { alerts: FieldAlerts }) {
  const windStatus = useThermalStore((s) => s.windStatus);

  const consensus = windStatus?.consensus ?? null;
  const trend = windStatus?.trend ?? null;
  const spreadDeg = windStatus?.spreadDeg ?? null;
  const zoneSummaries = windStatus?.zoneSummaries ?? [];

  // Consensus color
  const consensusColor =
    consensus && consensus.stationCount >= 5 && consensus.avgSpeedKt >= 5
      ? '#22c55e'
      : consensus && consensus.stationCount >= 3 && consensus.avgSpeedKt >= 3
        ? '#f59e0b'
        : '#64748b';

  // Determine alert level for section header
  const sectionLevel: AlertLevel =
    alerts.wind.active ? 'riesgo' :
    consensus && consensus.stationCount >= 3 ? 'none' : 'none';

  return (
    <AlertSection icon={<WeatherIcon id="radar" size={14} />} title="Viento en estaciones" level={sectionLevel} beta>
      <div className="space-y-1.5">
        {/* A. Consensus */}
        {consensus ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold font-mono" style={{ color: consensusColor }}>
                {consensus.dominantDir}
              </span>
              <span className="text-[11px] font-bold text-slate-300">
                {consensus.avgSpeedKt.toFixed(0)} kt
              </span>
            </div>
            <span className="text-[11px] text-slate-500">
              {consensus.stationCount} estaciones
            </span>
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">Sin consenso de viento</p>
        )}

        {/* B. Trend */}
        {trend && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-500">Tendencia</span>
            <span
              className="font-semibold"
              style={{
                color: trend.direction === 'rising' ? '#22c55e'
                  : trend.direction === 'falling' ? '#f59e0b' : '#94a3b8',
              }}
            >
              {trend.direction === 'rising' ? '↑' : trend.direction === 'falling' ? '↓' : '→'}
              {' '}{trend.direction === 'rising' ? 'Subiendo' : trend.direction === 'falling' ? 'Bajando' : 'Estable'}
              <span className="text-[11px] text-slate-600 ml-1">
                ({trend.rateKtPerHour > 0 ? '+' : ''}{trend.rateKtPerHour.toFixed(1)} kt/h)
              </span>
            </span>
          </div>
        )}

        {/* C. Direction spread */}
        {spreadDeg !== null && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-500">Dispersión</span>
            <span className="text-slate-400">
              {spreadDeg < 25 ? 'Muy consistente' : spreadDeg < 45 ? 'Consistente' : 'Variable'}
              <span className="text-[11px] text-slate-600 ml-1">({Math.round(spreadDeg)}°)</span>
            </span>
          </div>
        )}

        {/* D. Zone coherence — compact dots */}
        {zoneSummaries.length > 0 && consensus && (
          <div className="flex items-center gap-1 flex-wrap text-[11px] pt-0.5">
            {zoneSummaries.map((z) => (
              <span
                key={z.zoneId}
                className="inline-flex items-center gap-0.5"
                title={`${z.zoneName}: ${z.dominantDir ?? 'sin viento'} ${z.avgSpeedKt.toFixed(0)}kt`}
              >
                <span style={{
                  color: z.agrees ? '#22c55e' : z.stationCount === 0 ? '#475569' : '#f59e0b',
                }}>
                  {z.agrees ? '✓' : z.stationCount === 0 ? '○' : '✗'}
                </span>
                <span className="text-slate-600">{z.zoneName.slice(0, 4)}</span>
              </span>
            ))}
          </div>
        )}

        {/* E. Stability duration */}
        {windStatus?.stableHours !== null && windStatus?.stableHours !== undefined && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-500">Estabilidad</span>
            <span className="text-emerald-400/70 font-semibold">
              ~{windStatus.stableHours}h sostenido
            </span>
          </div>
        )}
        {windStatus?.consensusDurationMin !== null && windStatus?.consensusDurationMin !== undefined && !windStatus?.stableHours && (
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-500">Consenso</span>
            <span className="text-slate-400">~{windStatus.consensusDurationMin} min</span>
          </div>
        )}

        {/* F. Active propagation (conditional — original data) */}
        {alerts.wind.active && (
          <div className="mt-1.5 pt-1.5 border-t border-slate-700/50 space-y-1">
            <div className="flex items-center gap-2">
              <span
                className="text-[11px] font-bold px-2 py-0.5 rounded"
                style={{
                  background: 'rgba(245,158,11,0.15)',
                  color: '#f59e0b',
                  border: '1px solid rgba(245,158,11,0.3)',
                }}
              >
                INTENSIFICÁNDOSE
              </span>
              <span className="text-[11px] text-slate-400">
                {alerts.wind.directionLabel}
              </span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">Subida media</span>
              <span className="text-amber-300 font-bold">+{alerts.wind.avgIncreaseKt.toFixed(1)} kt/10min</span>
            </div>
          </div>
        )}
      </div>
    </AlertSection>
  );
}

function DroneSection({ alerts, forecast }: { alerts: FieldAlerts; forecast?: HourlyForecast[] }) {
  const d = alerts.drone;

  // Pre-flight checklist items
  const windOk = d.windKt <= 15;
  const gustOk = d.gustKt <= 18;
  const rainOk = !d.rain;
  const stormOk = !d.storms;

  // Visibility from forecast (if available)
  const now = Date.now();
  const current = forecast?.reduce((c, p) =>
    Math.abs(p.time.getTime() - now) < Math.abs(c.time.getTime() - now) ? p : c
  , forecast[0]);
  const temp = current?.temperature ?? null;
  const humidity = current?.humidity ?? null;
  const tempOk = temp === null || (temp > 0 && temp < 40);
  const humidityOk = humidity === null || humidity < 90;

  // Golden hour calculation
  const nowH = new Date().getHours();
  const isGoldenMorning = nowH >= 6 && nowH <= 8;
  const isGoldenEvening = nowH >= 19 && nowH <= 21;
  const isGolden = isGoldenMorning || isGoldenEvening;

  return (
    <AlertSection icon={<WeatherIcon id="drone" size={14} />} title="Vuelo Dron" level={d.flyable ? 'none' : 'alto'} beta>
      <div className="space-y-2">
        {/* Main verdict */}
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-bold px-2 py-0.5 rounded"
            style={{
              background: d.flyable ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)',
              color: d.flyable ? '#22c55e' : '#f59e0b',
              border: `1px solid ${d.flyable ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}`,
            }}
          >
            {d.flyable ? 'APTO PARA VOLAR' : 'NO RECOMENDADO'}
          </span>
        </div>

        {/* Pre-flight checklist */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
          <CheckItem label={`Viento ${d.windKt.toFixed(0)} kt`} ok={windOk} limit="max 15kt" />
          <CheckItem label={`Rachas ${d.gustKt.toFixed(0)} kt`} ok={gustOk} limit="max 18kt" />
          <CheckItem label={rainOk ? 'Sin lluvia' : 'Lluvia prevista'} ok={rainOk} />
          <CheckItem label={stormOk ? 'Sin tormentas' : 'Riesgo tormenta'} ok={stormOk} />
          {temp !== null && <CheckItem label={`${temp.toFixed(0)}\u00b0C`} ok={tempOk} limit={temp <= 0 ? 'bateria -50%' : undefined} />}
          {humidity !== null && <CheckItem label={`HR ${humidity.toFixed(0)}%`} ok={humidityOk} limit={humidity >= 90 ? 'condensacion' : undefined} />}
        </div>

        {/* Battery temperature warning */}
        {temp !== null && temp < 5 && (
          <div className="text-[10px] text-amber-400 bg-amber-500/10 rounded px-2 py-1 border border-amber-500/20">
            Temperatura baja ({temp.toFixed(0)}\u00b0C) — la bateria pierde hasta un 30% de autonomia. Precalienta antes de volar.
          </div>
        )}

        {/* Golden hour badge */}
        {isGolden && (
          <div className="text-[10px] text-amber-300 bg-amber-500/10 rounded px-2 py-1 border border-amber-500/20 flex items-center gap-1">
            <WeatherIcon id="sun" size={10} />
            Hora dorada — luz ideal para fotografia y video aereo
          </div>
        )}

        {/* Reasons for no-fly */}
        {d.reasons.length > 0 && (
          <ul className="text-[11px] text-slate-400 space-y-0.5">
            {d.reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-1">
                <span className="text-amber-400 mt-0.5">\u2022</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AlertSection>
  );
}

function CheckItem({ label, ok, limit }: { label: string; ok: boolean; limit?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span style={{ color: ok ? '#22c55e' : '#ef4444', fontSize: 12 }}>{ok ? '\u2713' : '\u2717'}</span>
      <span className={ok ? 'text-slate-300' : 'text-amber-400 font-semibold'}>{label}</span>
      {!ok && limit && <span className="text-slate-600 text-[10px]">({limit})</span>}
    </div>
  );
}

function NotamItem({ notam }: { notam: NotamSummary }) {
  const [expanded, setExpanded] = useState(false);

  const sevColor =
    notam.severity === 'prohibited' ? '#ef4444' :
    notam.severity === 'caution' ? '#f59e0b' : '#3b82f6';

  const sevLabel =
    notam.severity === 'prohibited' ? 'PROHIBIDO' :
    notam.severity === 'caution' ? 'PRECAUCIÓN' : 'INFO';

  const shortDesc = notam.description.length > 60
    ? notam.description.slice(0, 57) + '…'
    : notam.description;

  const fmtDate = (d: Date) =>
    d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div
      className="rounded transition-colors cursor-pointer"
      style={{
        background: expanded ? 'rgba(30,41,59,0.5)' : 'transparent',
        border: expanded ? '1px solid rgba(100,116,139,0.15)' : '1px solid transparent',
      }}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Collapsed row */}
      <div className="text-[11px] text-slate-400 flex items-start gap-1 px-1 py-0.5">
        <span className="mt-0.5 flex-shrink-0" style={{ color: sevColor }}>
          {expanded ? '▾' : '▸'}
        </span>
        <div className="min-w-0">
          <span className="font-mono text-slate-500">{notam.id}</span>
          {!expanded && <span className="text-slate-400"> — {shortDesc}</span>}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-1.5 space-y-0.5">
          {/* Severity badge + location */}
          <div className="flex items-center gap-1.5">
            <span
              className="text-[11px] font-bold px-1.5 py-px rounded"
              style={{ background: `${sevColor}20`, color: sevColor, border: `1px solid ${sevColor}40` }}
            >
              {sevLabel}
            </span>
            {notam.location && (
              <span className="text-[11px] font-mono text-slate-500">{notam.location}</span>
            )}
          </div>

          {/* Full description */}
          <p className="text-[11px] text-slate-300 leading-relaxed">{notam.description}</p>

          {/* Altitude */}
          {(notam.lowerAltFt > 0 || notam.upperAltFt > 0) && (
            <div className="text-[11px] text-slate-500">
              Alt: {notam.lowerAltFt > 0 ? `${notam.lowerAltFt} ft` : 'SFC'} → {notam.upperAltFt > 0 ? `${notam.upperAltFt} ft` : '—'}
            </div>
          )}

          {/* Validity period */}
          <div className="text-[11px] text-slate-600">
            {fmtDate(notam.validFrom)} → {fmtDate(notam.validUntil)}
          </div>
        </div>
      )}
    </div>
  );
}

/** Compute centroid of a GeoJSON polygon (average of exterior ring). */
function polygonCentroid(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] {
  const ring =
    geom.type === 'MultiPolygon'
      ? geom.coordinates[0][0]
      : geom.coordinates[0];
  let lonSum = 0, latSum = 0;
  for (const coord of ring) {
    lonSum += coord[0];
    latSum += coord[1];
  }
  return [lonSum / ring.length, latSum / ring.length];
}

function AirspaceSection() {
  const airspaceCheck = useAirspaceStore((s) => s.check);
  const rawZones = useAirspaceStore((s) => s.zones);
  const loading = useAirspaceStore((s) => s.loading);
  const setFlyToTarget = useUIStore((s) => s.setFlyToTarget);

  if (loading && !airspaceCheck) {
    return (
      <AlertSection icon={<WeatherIcon id="drone" size={14} />} title="Espacio Aéreo" level="none">
        <p className="text-[11px] text-slate-500">Consultando ENAIRE...</p>
      </AlertSection>
    );
  }

  if (!airspaceCheck) {
    return (
      <AlertSection icon={<WeatherIcon id="drone" size={14} />} title="Espacio Aéreo" level="none">
        <p className="text-[11px] text-slate-500">Sin datos de espacio aéreo</p>
      </AlertSection>
    );
  }

  const level: AlertLevel =
    airspaceCheck.severity === 'prohibited' ? 'critico' :
    airspaceCheck.severity === 'caution' ? 'alto' : 'none';

  const statusLabel =
    airspaceCheck.severity === 'prohibited' ? 'ZONA PROHIBIDA' :
    airspaceCheck.severity === 'caution' ? 'REQUIERE AUTORIZACIÓN' :
    'SIN RESTRICCIONES';

  const statusColor =
    airspaceCheck.severity === 'prohibited' ? '#ef4444' :
    airspaceCheck.severity === 'caution' ? '#f59e0b' :
    '#22c55e';

  const statusBg =
    airspaceCheck.severity === 'prohibited' ? 'rgba(239,68,68,0.15)' :
    airspaceCheck.severity === 'caution' ? 'rgba(245,158,11,0.15)' :
    'rgba(34,197,94,0.15)';

  const statusBorder =
    airspaceCheck.severity === 'prohibited' ? 'rgba(239,68,68,0.3)' :
    airspaceCheck.severity === 'caution' ? 'rgba(245,158,11,0.3)' :
    'rgba(34,197,94,0.3)';

  return (
    <AlertSection icon={<WeatherIcon id="drone" size={14} />} title="Espacio Aéreo" level={level}>
      <div className="space-y-1.5">
        {/* Status badge */}
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-bold px-2 py-0.5 rounded"
            style={{ background: statusBg, color: statusColor, border: `1px solid ${statusBorder}` }}
          >
            {statusLabel}
          </span>
          {airspaceCheck.notams.length > 0 && (
            <span
              className="text-[11px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: 'rgba(59,130,246,0.15)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.3)' }}
            >
              {airspaceCheck.notams.length} NOTAM{airspaceCheck.notams.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* UAS Zones affecting the sector */}
        {airspaceCheck.zones.length > 0 && (
          <div className="space-y-1 mt-1">
            <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">Zonas UAS</span>
            {airspaceCheck.zones.map((zone, i) => {
              // Find matching raw zone for geometry centroid
              const raw = rawZones.find((z) => z.name === zone.name && z.type === zone.type);
              const handleClick = raw ? () => {
                const [lon, lat] = polygonCentroid(raw.geometry);
                setFlyToTarget({ lon, lat, zoom: 11 });
              } : undefined;

              return (
                <div
                  key={i}
                  className={`text-[11px] text-slate-400 flex items-start gap-1 ${raw ? 'cursor-pointer hover:bg-slate-700/30 rounded px-1 -mx-1 py-0.5 transition-colors' : ''}`}
                  onClick={handleClick}
                  title={raw ? 'Clic para centrar en el mapa' : undefined}
                >
                  <span className="mt-0.5" style={{ color: zone.type.toUpperCase().includes('PROHIB') ? '#ef4444' : '#f59e0b' }}>•</span>
                  <div>
                    <span className="font-semibold text-slate-300">{zone.name}</span>
                    <span className="text-slate-500"> · {zone.type} · {zone.maxAltitudeM > 0 ? `≤${zone.maxAltitudeM}m` : 'sin límite alt.'}</span>
                    {zone.contact && (
                      <span className="text-slate-600 block">{zone.contact}</span>
                    )}
                    {raw && <span className="text-blue-500/50 text-[11px] ml-1">&#x2197;</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Active NOTAMs — clickable expand/collapse */}
        {airspaceCheck.notams.length > 0 && (
          <div className="space-y-1 mt-1">
            <span className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider">NOTAMs activos</span>
            {airspaceCheck.notams.map((notam, i) => (
              <NotamItem key={notam.id || i} notam={notam} />
            ))}
          </div>
        )}

        {/* No restrictions */}
        {airspaceCheck.zones.length === 0 && airspaceCheck.notams.length === 0 && (
          <p className="text-[11px] text-slate-500">
            No hay restricciones de espacio aéreo en esta zona
          </p>
        )}
      </div>
    </AlertSection>
  );
}

function ET0Section({ alerts }: { alerts: FieldAlerts }) {
  return (
    <AlertSection icon={<WeatherIcon id="thermometer" size={14} />} title="ET₀ Evapotranspiración" level={alerts.et0.level} beta>
      {alerts.et0.et0Daily !== null ? (
        <div className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">ET₀ diaria</span>
            <span
              className="font-bold"
              style={{ color: alerts.et0.level === 'critico' ? '#ef4444' : alerts.et0.level === 'alto' ? '#f59e0b' : '#22c55e' }}
            >
              {alerts.et0.et0Daily.toFixed(1)} mm/día
            </span>
          </div>
          <div className="text-[11px] text-slate-400 leading-snug mt-1">
            {alerts.et0.irrigationAdvice}
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">Sin datos de previsión para cálculo ET₀</p>
      )}
    </AlertSection>
  );
}

function DiseaseSection({ alerts }: { alerts: FieldAlerts }) {
  const maxLevel: AlertLevel =
    ({ none: 0, riesgo: 1, alto: 2, critico: 3 }[alerts.disease.mildiu.level] ?? 0) >=
    ({ none: 0, riesgo: 1, alto: 2, critico: 3 }[alerts.disease.oidio.level] ?? 0)
      ? alerts.disease.mildiu.level
      : alerts.disease.oidio.level;

  return (
    <AlertSection icon={<WeatherIcon id="leaf" size={14} />} title="Riesgo Fitosanitario" level={maxLevel} beta>
      <div className="space-y-2">
        {/* Mildiu */}
        <div>
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[11px] font-semibold text-slate-300">Mildiu</span>
            <span
              className="text-[11px] font-bold px-1.5 py-0.5 rounded"
              style={alerts.disease.mildiu.level !== 'none' ? {
                color: LEVEL_COLORS[alerts.disease.mildiu.level].text,
                background: LEVEL_COLORS[alerts.disease.mildiu.level].bg,
              } : { color: '#22c55e', background: 'rgba(34,197,94,0.1)' }}
            >
              {alerts.disease.mildiu.level !== 'none' ? `${alerts.disease.mildiu.hours}h favorables` : 'Sin riesgo'}
            </span>
          </div>
          <p className="text-[11px] text-slate-400">{alerts.disease.mildiu.detail}</p>
        </div>
        {/* Oidio */}
        <div>
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[11px] font-semibold text-slate-300">Oidio</span>
            <span
              className="text-[11px] font-bold px-1.5 py-0.5 rounded"
              style={alerts.disease.oidio.level !== 'none' ? {
                color: LEVEL_COLORS[alerts.disease.oidio.level].text,
                background: LEVEL_COLORS[alerts.disease.oidio.level].bg,
              } : { color: '#22c55e', background: 'rgba(34,197,94,0.1)' }}
            >
              {alerts.disease.oidio.level !== 'none' ? `${alerts.disease.oidio.hours}h favorables` : 'Sin riesgo'}
            </span>
          </div>
          <p className="text-[11px] text-slate-400">{alerts.disease.oidio.detail}</p>
        </div>
        <p className="text-[11px] text-slate-600 italic border-t border-slate-700/30 pt-1">
          Referencia: viñedo Ribeiro (Ourense). No sustituye asesoramiento técnico.
        </p>
      </div>
    </AlertSection>
  );
}

function GDDSection({ alerts }: { alerts: FieldAlerts }) {
  const { gdd } = alerts;

  // Color for accumulated GDD value
  const gddColor = gdd.level === 'alto' ? '#f59e0b' : gdd.level === 'riesgo' ? '#3b82f6' : '#22c55e';

  return (
    <AlertSection icon={<WeatherIcon id="sprout" size={14} />} title="Grados-Día (GDD)" level={gdd.level}>
      {gdd.accumulated !== null || gdd.todayGDD !== null ? (
        <div className="space-y-1.5">
          {/* Main GDD values */}
          <div className="flex justify-between text-[11px]">
            <span className="text-slate-400">GDD acumulados</span>
            <span className="font-bold" style={{ color: gddColor }}>
              {gdd.accumulated !== null ? `${gdd.accumulated.toFixed(0)} °C·d` : '—'}
            </span>
          </div>
          {gdd.todayGDD !== null && (
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-400">Hoy</span>
              <span className="text-slate-300">+{gdd.todayGDD.toFixed(1)} °C·d</span>
            </div>
          )}

          {/* Growth stage with progress bar */}
          <div className="mt-1">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[11px] font-semibold text-slate-300">
                🌱 {gdd.growthStage}
              </span>
              <span className="text-[11px] text-slate-500">{gdd.stageProgress}%</span>
            </div>
            <div className="h-1 bg-slate-700/50 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${gdd.stageProgress}%`,
                  background: `linear-gradient(90deg, #22c55e, ${gddColor})`,
                }}
              />
            </div>
          </div>

          {/* Next milestone */}
          {gdd.nextMilestone && gdd.nextMilestone.gddNeeded > 0 && (
            <div className="flex justify-between text-[11px] text-slate-500">
              <span>→ {gdd.nextMilestone.name}</span>
              <span>faltan ~{gdd.nextMilestone.gddNeeded} °C·d</span>
            </div>
          )}

          {/* Advice */}
          <div className="text-[11px] text-slate-400 leading-snug border-t border-slate-700/30 pt-1 mt-1">
            {gdd.advice}
          </div>

          {/* Footer */}
          <p className="text-[11px] text-slate-600 italic">
            Base 10°C (Vitis vinifera). Temporada desde 1 marzo. Día {gdd.daysSinceStart}.
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">
          {gdd.growthStage === 'Fuera de temporada'
            ? 'La temporada de crecimiento comienza en marzo.'
            : 'Sin datos suficientes para cálculo GDD'}
        </p>
      )}
    </AlertSection>
  );
}

function LunarSection() {
  const isMobile = useUIStore((s) => s.isMobile);
  const [collapsed, setCollapsed] = useState(isMobile);
  const lunar = useMemo(() => getLunarPhase(), []);

  return (
    <div
      className="rounded-lg p-2.5 relative overflow-hidden"
      style={{
        background: 'rgba(124,93,250,0.08)',
        border: '1px solid rgba(124,93,250,0.2)',
      }}
    >
      <button
        onClick={() => isMobile && setCollapsed((p) => !p)}
        className={`flex items-center gap-2 w-full text-left ${collapsed ? '' : 'mb-2'}`}
      >
        <span className="text-sm">{lunar.emoji}</span>
        <span className="text-[11px] font-bold text-slate-200">Fase Lunar</span>
        <span
          className="text-[11px] font-bold px-1.5 py-0.5 rounded ml-auto"
          style={{ color: '#a78bfa', background: 'rgba(167,139,250,0.12)' }}
        >
          {lunar.label}
        </span>
        {isMobile && (
          <WeatherIcon
            id={collapsed ? 'info' : 'x'}
            size={12}
            className="text-slate-500"
          />
        )}
      </button>
      {!collapsed && (
        <div className="space-y-2">
          {/* Phase + illumination row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-2xl">{lunar.emoji}</span>
              <div>
                <div className="text-[11px] font-semibold text-slate-200">{lunar.label}</div>
                <div className="text-[11px] text-slate-400">
                  Día {lunar.ageDays} · {lunar.illumination}% iluminada
                  {lunar.isWaxing ? ' · ↑ creciendo' : ' · ↓ menguando'}
                </div>
              </div>
            </div>
          </div>

          {/* Next phase */}
          <div className="flex justify-between text-[11px] border-t border-slate-700/30 pt-1.5">
            <span className="text-slate-400">Próxima fase</span>
            <span className="text-violet-400 font-medium">
              {lunar.nextPhase.name} · {lunar.nextPhase.daysUntil}d
            </span>
          </div>

          {/* Agriculture advice */}
          <div className="space-y-1 border-t border-slate-700/30 pt-1.5">
            <p className="text-[11px] text-violet-300 font-medium">{lunar.agriculture.summary}</p>
            <div className="grid grid-cols-1 gap-1">
              <div className="text-[11px]">
                <span className="text-emerald-400 font-medium">Siembra: </span>
                <span className="text-slate-400">{lunar.agriculture.sowing}</span>
              </div>
              <div className="text-[11px]">
                <span className="text-amber-400 font-medium">Poda: </span>
                <span className="text-slate-400">{lunar.agriculture.pruning}</span>
              </div>
              <div className="text-[11px]">
                <span className="text-blue-400 font-medium">Tratamientos: </span>
                <span className="text-slate-400">{lunar.agriculture.treatments}</span>
              </div>
            </div>
          </div>

          {/* Collapsible monthly calendar */}
          <LunarCalendarDropdown />

          <p className="text-[11px] text-slate-600 italic border-t border-slate-700/30 pt-1">
            Calendario agrícola tradicional gallego. Orientativo.
          </p>
        </div>
      )}
    </div>
  );
}

/** Mini lunar calendar — 30 days from today in a compact grid. Collapsed by default. */
function LunarCalendarDropdown() {
  const [open, setOpen] = useState(false);
  const calendar = useMemo(() => (open ? getLunarCalendar(new Date(), 30) : []), [open]);

  // Group by week rows (7 cols)
  const today = new Date();
  const startDow = today.getDay(); // 0=Sun

  return (
    <div className="border-t border-slate-700/30 pt-1.5">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-1.5 w-full text-left group"
      >
        <span className="text-[11px]">📅</span>
        <span className="text-[11px] text-violet-400 font-medium group-hover:text-violet-300">
          Calendario lunar 30 días
        </span>
        <span className="text-[11px] text-slate-500 ml-auto">{open ? '▲' : '▼'}</span>
      </button>

      {open && calendar.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {/* Day-of-week header */}
          <div className="grid grid-cols-7 gap-px">
            {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => (
              <div key={d} className="text-[11px] text-slate-500 text-center font-bold">{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-px">
            {/* Empty cells for days before start (Mon-based: Mon=0) */}
            {Array.from({ length: (startDow + 6) % 7 }, (_, i) => (
              <div key={`pad-${i}`} className="h-7" />
            ))}

            {calendar.map((day, i) => {
              const isToday = i === 0;
              const dayNum = day.date.getDate();
              return (
                <div
                  key={i}
                  className={`h-7 flex flex-col items-center justify-center rounded ${
                    isToday ? 'ring-1 ring-violet-500/50 bg-violet-500/10' : 'hover:bg-slate-700/20'
                  }`}
                  title={`${dayNum}/${day.date.getMonth() + 1} — ${day.name} (${day.illumination}%)`}
                >
                  <span className="text-[11px] leading-none">{day.emoji}</span>
                  <span className={`text-[11px] leading-none mt-0.5 ${isToday ? 'text-violet-400 font-bold' : 'text-slate-500'}`}>
                    {dayNum}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Key phases legend */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-1">
            {calendar
              .filter((d) => ['nueva', 'llena', 'cuarto-creciente', 'cuarto-menguante'].includes(d.name))
              .reduce((acc, d) => {
                // Dedup: only first occurrence of each phase
                if (!acc.find((x) => x.name === d.name)) acc.push(d);
                return acc;
              }, [] as typeof calendar)
              .slice(0, 4)
              .map((d, i) => (
                <div key={i} className="text-[11px] text-slate-400">
                  <span>{d.emoji}</span>{' '}
                  <span className="text-slate-500">
                    {d.date.getDate()}/{d.date.getMonth() + 1}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AlertHistorySection() {
  const history = useAlertStore((s) => s.alertHistory);

  const SEVERITY_DOT: Record<string, string> = {
    critical: '#ef4444',
    high: '#f59e0b',
    moderate: '#3b82f6',
  };

  if (history.length === 0) {
    return (
      <AlertSection icon={<WeatherIcon id="clock" size={14} />} title="Historial Alertas" level="none">
        <p className="text-[11px] text-slate-500">Sin alertas recientes registradas</p>
      </AlertSection>
    );
  }

  return (
    <AlertSection icon={<WeatherIcon id="clock" size={14} />} title="Historial Alertas" level="none">
      <div className="max-h-48 overflow-y-auto space-y-1">
        {history.slice(0, 20).map((entry, i) => {
          const dt = new Date(entry.timestamp);
          const timeStr = dt.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
          const dateStr = dt.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
          return (
            <div key={`${entry.id}-${i}`} className="flex items-start gap-1.5 text-[11px]">
              <span
                className="w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0"
                style={{ background: SEVERITY_DOT[entry.severity] ?? '#64748b' }}
              />
              <span className="text-slate-500 font-mono flex-shrink-0 w-16">{dateStr} {timeStr}</span>
              <span className="text-slate-300 truncate">{entry.title}</span>
            </div>
          );
        })}
      </div>
    </AlertSection>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-1 mt-1">
      <span className="text-[11px] text-slate-600">Confianza:</span>
      <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: `${value}%`,
            background: value >= 60 ? '#22c55e' : value >= 30 ? '#f59e0b' : '#64748b',
          }}
        />
      </div>
      <span className="text-[11px] text-slate-500 tabular-nums">{value}%</span>
    </div>
  );
}

// ── Alert section wrapper ────────────────────────────────

function AlertSection({
  icon,
  title,
  level,
  children,
  beta,
}: {
  icon: React.ReactNode;
  title: string;
  level: AlertLevel;
  children: React.ReactNode;
  beta?: boolean;
}) {
  const isMobile = useUIStore((s) => s.isMobile);
  // On mobile, start collapsed if no alert; expanded if there's an active alert
  const [collapsed, setCollapsed] = useState(isMobile && level === 'none');
  const colors = LEVEL_COLORS[level];

  return (
    <div
      className="rounded-lg p-2.5 relative overflow-hidden"
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        paddingLeft: level !== 'none' ? '20px' : undefined,
      }}
    >
      {/* Severity bar on the left edge */}
      {level !== 'none' && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
          style={{ background: colors.text }}
        />
      )}
      <button
        onClick={() => isMobile && setCollapsed((p) => !p)}
        className={`flex items-center gap-2 w-full text-left ${collapsed ? '' : 'mb-2'}`}
      >
        <span className="text-sm inline-flex">{icon}</span>
        <span className="text-[11px] font-bold text-slate-200">{title}</span>
        {beta && <span className="badge-beta">Beta</span>}
        {level !== 'none' && (
          <span
            className="text-[11px] font-bold px-1.5 py-0.5 rounded ml-auto"
            style={{ color: colors.text, background: `${colors.text}15` }}
          >
            {LEVEL_LABELS[level]}
          </span>
        )}
        {isMobile && (
          <WeatherIcon
            id={collapsed ? 'info' : 'x'}
            size={12}
            className={`text-slate-500 ${level !== 'none' ? '' : 'ml-auto'}`}
          />
        )}
      </button>
      {!collapsed && children}
    </div>
  );
}

// ── 48h Alert mini-timeline ──────────────────────────────

function AlertTimeline({ forecast }: { forecast: import('../../types/forecast').HourlyForecast[] }) {
  // Group forecast into 3-hour buckets for compact display
  const buckets = useMemo(() => {
    const now = Date.now();
    const result: Array<{
      time: Date;
      label: string;
      frostLevel: AlertLevel;
      rainLevel: AlertLevel;
      hasStorm: boolean;
    }> = [];

    for (let i = 0; i < forecast.length; i += 3) {
      const chunk = forecast.slice(i, i + 3);
      if (chunk.length === 0) continue;
      if (chunk[0].time.getTime() < now - 3600000) continue; // skip past hours

      const frost = checkFrost(chunk);
      const rain = checkRainHail(chunk);
      const hasStorm = chunk.some(p => (p.cape ?? 0) > 500);

      result.push({
        time: chunk[0].time,
        label: chunk[0].time.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
        frostLevel: frost.level,
        rainLevel: rain.level,
        hasStorm,
      });
    }

    return result.slice(0, 16); // max 16 buckets = 48h
  }, [forecast]);

  if (buckets.length === 0) return null;

  const levelToColor = (level: AlertLevel): string => {
    switch (level) {
      case 'critico': return '#ef4444';
      case 'alto': return '#f59e0b';
      case 'riesgo': return '#3b82f6';
      default: return '#1e293b';
    }
  };

  return (
    <div className="rounded-lg p-2.5 bg-slate-800/30 border border-slate-700/50">
      <div className="flex items-center gap-2 mb-2">
        <WeatherIcon id="info" size={14} />
        <span className="text-[11px] font-bold text-slate-200">Timeline 48h</span>
      </div>

      {/* Frost row */}
      <div className="flex items-center gap-0.5 mb-1">
        <span className="text-slate-500 w-8 shrink-0 inline-flex"><WeatherIcon id="snowflake" size={10} /></span>
        <div className="flex gap-px flex-1">
          {buckets.map((b, i) => (
            <div
              key={`frost-${i}`}
              className="flex-1 h-2.5 rounded-sm transition-colors"
              style={{ background: levelToColor(b.frostLevel) }}
              title={`${b.label} — Helada: ${b.frostLevel}`}
            />
          ))}
        </div>
      </div>

      {/* Rain row */}
      <div className="flex items-center gap-0.5 mb-1">
        <span className="text-slate-500 w-8 shrink-0 inline-flex"><WeatherIcon id="cloud-rain" size={10} /></span>
        <div className="flex gap-px flex-1">
          {buckets.map((b, i) => (
            <div
              key={`rain-${i}`}
              className="flex-1 h-2.5 rounded-sm transition-colors"
              style={{ background: levelToColor(b.rainLevel) }}
              title={`${b.label} — Lluvia: ${b.rainLevel}`}
            />
          ))}
        </div>
      </div>

      {/* Storm row */}
      <div className="flex items-center gap-0.5 mb-1.5">
        <span className="text-slate-500 w-8 shrink-0 inline-flex"><WeatherIcon id="zap" size={10} /></span>
        <div className="flex gap-px flex-1">
          {buckets.map((b, i) => (
            <div
              key={`storm-${i}`}
              className="flex-1 h-2.5 rounded-sm transition-colors"
              style={{ background: b.hasStorm ? '#a855f7' : '#1e293b' }}
              title={`${b.label} — ${b.hasStorm ? 'Riesgo tormenta' : 'Sin tormenta'}`}
            />
          ))}
        </div>
      </div>

      {/* Time labels */}
      <div className="flex gap-px">
        <span className="w-8 shrink-0" />
        {buckets.map((b, i) => (
          <div
            key={`time-${i}`}
            className="flex-1 text-center"
          >
            {i % 4 === 0 && (
              <span className="text-[11px] text-slate-600 font-mono">{b.label}</span>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-slate-700/30">
        <div className="flex items-center gap-0.5">
          <div className="w-2 h-2 rounded-sm" style={{ background: '#3b82f6' }} />
          <span className="text-[11px] text-slate-500">Riesgo</span>
        </div>
        <div className="flex items-center gap-0.5">
          <div className="w-2 h-2 rounded-sm" style={{ background: '#f59e0b' }} />
          <span className="text-[11px] text-slate-500">Alto</span>
        </div>
        <div className="flex items-center gap-0.5">
          <div className="w-2 h-2 rounded-sm" style={{ background: '#ef4444' }} />
          <span className="text-[11px] text-slate-500">Crítico</span>
        </div>
        <div className="flex items-center gap-0.5">
          <div className="w-2 h-2 rounded-sm" style={{ background: '#a855f7' }} />
          <span className="text-[11px] text-slate-500">Tormenta</span>
        </div>
      </div>
    </div>
  );
}
