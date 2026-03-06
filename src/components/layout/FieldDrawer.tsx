/**
 * FieldDrawer — right-side tabbed drawer for weather alerts.
 * Four context tabs: Navegación, Campo, Dron, Meteo.
 * Overlays the map. Doesn't touch the sidebar.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { FieldAlerts, AlertLevel } from '../../types/campo';
import { useForecastStore } from '../../hooks/useForecastTimeline';
import { checkFrost, checkRainHail } from '../../services/fieldAlertEngine';
import { useUIStore } from '../../store/uiStore';
import { useAirspaceStore } from '../../store/airspaceStore';
import { useAlertStore } from '../../store/alertStore';
import type { AlertHistoryEntry } from '../../store/alertStore';
import type { NotamSummary } from '../../services/airspaceService';
import { WeatherIcon } from '../icons/WeatherIcons';
import type { IconId } from '../icons/WeatherIcons';
import { useSectorStore } from '../../store/sectorStore';
import { TidePanel } from '../dashboard/TidePanel';

export type AlertTab = 'nav' | 'campo' | 'dron' | 'meteo';

const TABS: { id: AlertTab; label: string; icon: IconId | null; shortcut: string }[] = [
  { id: 'nav', label: 'Naveg.', icon: 'sailboat', shortcut: '1' },
  { id: 'campo', label: 'Campo', icon: null, shortcut: '2' },
  { id: 'dron', label: 'Dron', icon: 'drone', shortcut: '3' },
  { id: 'meteo', label: 'Meteo', icon: null, shortcut: '4' },
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
  const drawerRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<AlertTab>('nav');
  const isMobile = useUIStore((s) => s.isMobile);
  const setDroneTabActive = useUIStore((s) => s.setDroneTabActive);
  const forecastHourly = useForecastStore((s) => s.hourly);
  const isRias = useSectorStore((s) => s.activeSector.id === 'rias');

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
      className={`fixed z-30 bg-slate-900/95 backdrop-blur-sm transition-all duration-300 ease-in-out overflow-hidden ${
        isMobile
          ? `inset-x-0 bottom-0 rounded-t-2xl border-t border-slate-700 max-w-full ${open ? 'translate-y-0' : 'translate-y-full'}`
          : `right-0 top-0 h-full w-72 border-l border-slate-700 ${open ? 'translate-x-0' : 'translate-x-full'}`
      }`}
      style={isMobile ? { maxHeight: '70vh' } : undefined}
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
          <span className={`font-bold text-white ${isMobile ? 'text-base' : 'text-sm'}`}>Alertas</span>
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
              isMobile ? 'py-3 text-xs' : 'py-2 text-[10px]'
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
        <div className={`space-y-3 overflow-y-auto ${isMobile ? 'p-4 max-h-[calc(70vh-120px)]' : 'p-3 h-[calc(100%-92px)]'}`}>
          {/* ── Navegación tab: wind propagation + fog + tides (Rías) ── */}
          {activeTab === 'nav' && (
            <>
              {isRias && <TidePanel />}
              <WindPropagationSection alerts={alerts} />
              <FogSection alerts={alerts} />
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
            </>
          )}

          {/* ── Dron tab: drone conditions + airspace + wind + rain + fog ── */}
          {activeTab === 'dron' && (
            <>
              <DroneSection alerts={alerts} />
              <AirspaceSection />
              <WindPropagationSection alerts={alerts} />
              <RainSection alerts={alerts} />
              <FogSection alerts={alerts} />
            </>
          )}

          {/* ── Meteo tab: all alerts + history ── */}
          {activeTab === 'meteo' && (
            <>
              <FrostSection alerts={alerts} />
              <RainSection alerts={alerts} />
              <FogSection alerts={alerts} />
              <WindPropagationSection alerts={alerts} />
              <DroneSection alerts={alerts} />
              <AlertHistorySection />
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
        <p className="text-[10px] text-slate-500">Sin riesgo de helada en las próximas 48h</p>
      ) : (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-400">Temp mínima</span>
            <span className="text-blue-300 font-bold">{alerts.frost.minTemp?.toFixed(1)}°C</span>
          </div>
          {alerts.frost.timeWindow && (
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-400">Ventana riesgo</span>
              <span className="text-slate-300 font-mono">
                {formatTimeRange(alerts.frost.timeWindow.from, alerts.frost.timeWindow.to)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-400">Nubes</span>
            <span className="text-slate-300">{alerts.frost.cloudCover?.toFixed(0) ?? '-'}%</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-400">Viento</span>
            <span className="text-slate-300">{alerts.frost.windSpeed?.toFixed(1) ?? '-'} m/s</span>
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
        <p className="text-[10px] text-slate-500">Sin lluvia significativa prevista</p>
      ) : (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-400">Precip máx/h</span>
            <span className="text-blue-300 font-bold">{alerts.rain.maxPrecip.toFixed(1)} mm</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-400">Probabilidad</span>
            <span className="text-slate-300">{alerts.rain.maxProbability}%</span>
          </div>
          {alerts.rain.rainAccum6h > 0 && (
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-400">Acum. 6h</span>
              <span className="text-blue-300 font-bold">{alerts.rain.rainAccum6h.toFixed(1)} mm</span>
            </div>
          )}
          {alerts.rain.hailRisk && (
            <div className="text-[10px] text-red-400 font-semibold mt-1">
              Riesgo de granizo detectado (CAPE alto + precipitación fuerte)
            </div>
          )}
        </div>
      )}
    </AlertSection>
  );
}

function FogSection({ alerts }: { alerts: FieldAlerts }) {
  return (
    <AlertSection icon={<WeatherIcon id="fog" size={14} />} title="Niebla / Rocío" level={alerts.fog.level}>
      {alerts.fog.dewPoint !== null ? (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-400">Punto de rocío</span>
            <span className="text-cyan-300 font-bold">{alerts.fog.dewPoint.toFixed(1)}°C</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-400">Spread (T - Td)</span>
            <span
              className="font-bold"
              style={{ color: (alerts.fog.spread ?? 99) <= 2 ? '#ef4444' : (alerts.fog.spread ?? 99) <= 4 ? '#f59e0b' : '#94a3b8' }}
            >
              {alerts.fog.spread?.toFixed(1) ?? '-'}°C
            </span>
          </div>
          {alerts.fog.spreadTrend !== null && (
            <div className="flex justify-between text-[10px]">
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
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-400">ETA niebla</span>
              <span className="text-amber-300 font-bold font-mono">
                ~{alerts.fog.fogEta.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          )}
          {alerts.fog.humidity !== null && (
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-400">HR actual</span>
              <span className="text-slate-300">{alerts.fog.humidity.toFixed(0)}%</span>
            </div>
          )}
          {alerts.fog.windSpeed !== null && (
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-400">Viento</span>
              <span className="text-slate-300">{alerts.fog.windSpeed.toFixed(1)} m/s</span>
            </div>
          )}
          <div className="mt-1.5 text-[9px] text-slate-400 italic leading-snug border-t border-slate-700/50 pt-1.5">
            {alerts.fog.hypothesis}
          </div>
          <ConfidenceBar value={alerts.fog.confidence} />
        </div>
      ) : (
        <p className="text-[10px] text-slate-500">
          Recogiendo datos reales... (necesita ~30 min de lecturas)
        </p>
      )}
    </AlertSection>
  );
}

function WindPropagationSection({ alerts }: { alerts: FieldAlerts }) {
  return (
    <AlertSection icon={<WeatherIcon id="radar" size={14} />} title="Propagación Viento" level={alerts.wind.active ? 'riesgo' : 'none'}>
      {alerts.wind.active ? (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded"
              style={{
                background: 'rgba(245,158,11,0.15)',
                color: '#f59e0b',
                border: '1px solid rgba(245,158,11,0.3)',
              }}
            >
              INTENSIFICÁNDOSE
            </span>
            <span className="text-[10px] text-slate-400">
              {alerts.wind.directionLabel}
            </span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-400">Estaciones barlovento</span>
            <span className="text-amber-300 font-bold">{alerts.wind.upwindCount}</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-400">Subida media</span>
            <span className="text-amber-300 font-bold">+{alerts.wind.avgIncreaseKt.toFixed(1)} kt/10min</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-400">Frente actual</span>
            <span className="text-amber-300 font-bold">{alerts.wind.frontSpeedKt.toFixed(0)} kt</span>
          </div>
          {alerts.wind.estimatedArrivalMin !== null && (
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-400">Llegada estimada</span>
              <span className="text-amber-300 font-bold font-mono">~{alerts.wind.estimatedArrivalMin} min</span>
            </div>
          )}
          <div className="mt-1.5 text-[9px] text-slate-400 italic leading-snug border-t border-slate-700/50 pt-1.5">
            {alerts.wind.summary}
          </div>
          <ConfidenceBar value={alerts.wind.confidence} />
        </div>
      ) : (
        <p className="text-[10px] text-slate-500">
          {alerts.wind.summary}
        </p>
      )}
    </AlertSection>
  );
}

function DroneSection({ alerts }: { alerts: FieldAlerts }) {
  return (
    <AlertSection icon={<WeatherIcon id="drone" size={14} />} title="Vuelo Dron" level={alerts.drone.flyable ? 'none' : 'alto'}>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded"
            style={{
              background: alerts.drone.flyable ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)',
              color: alerts.drone.flyable ? '#22c55e' : '#f59e0b',
              border: `1px solid ${alerts.drone.flyable ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}`,
            }}
          >
            {alerts.drone.flyable ? 'APTO' : 'PRECAUCIÓN'}
          </span>
          <span className="text-[10px] text-slate-400">
            Viento: {alerts.drone.windKt.toFixed(0)} kt
            {alerts.drone.gustKt > 0 && ` · Racha: ${alerts.drone.gustKt.toFixed(0)} kt`}
          </span>
        </div>
        {alerts.drone.reasons.length > 0 && (
          <ul className="text-[9px] text-slate-400 space-y-0.5 mt-1">
            {alerts.drone.reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-1">
                <span className="text-amber-400 mt-0.5">•</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AlertSection>
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
      <div className="text-[9px] text-slate-400 flex items-start gap-1 px-1 py-0.5">
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
              className="text-[8px] font-bold px-1.5 py-px rounded"
              style={{ background: `${sevColor}20`, color: sevColor, border: `1px solid ${sevColor}40` }}
            >
              {sevLabel}
            </span>
            {notam.location && (
              <span className="text-[9px] font-mono text-slate-500">{notam.location}</span>
            )}
          </div>

          {/* Full description */}
          <p className="text-[9px] text-slate-300 leading-relaxed">{notam.description}</p>

          {/* Altitude */}
          {(notam.lowerAltFt > 0 || notam.upperAltFt > 0) && (
            <div className="text-[9px] text-slate-500">
              Alt: {notam.lowerAltFt > 0 ? `${notam.lowerAltFt} ft` : 'SFC'} → {notam.upperAltFt > 0 ? `${notam.upperAltFt} ft` : '—'}
            </div>
          )}

          {/* Validity period */}
          <div className="text-[9px] text-slate-600">
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
        <p className="text-[10px] text-slate-500">Consultando ENAIRE...</p>
      </AlertSection>
    );
  }

  if (!airspaceCheck) {
    return (
      <AlertSection icon={<WeatherIcon id="drone" size={14} />} title="Espacio Aéreo" level="none">
        <p className="text-[10px] text-slate-500">Sin datos de espacio aéreo</p>
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
            className="text-[10px] font-bold px-2 py-0.5 rounded"
            style={{ background: statusBg, color: statusColor, border: `1px solid ${statusBorder}` }}
          >
            {statusLabel}
          </span>
          {airspaceCheck.notams.length > 0 && (
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: 'rgba(59,130,246,0.15)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.3)' }}
            >
              {airspaceCheck.notams.length} NOTAM{airspaceCheck.notams.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* UAS Zones affecting the sector */}
        {airspaceCheck.zones.length > 0 && (
          <div className="space-y-1 mt-1">
            <span className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider">Zonas UAS</span>
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
                  className={`text-[9px] text-slate-400 flex items-start gap-1 ${raw ? 'cursor-pointer hover:bg-slate-700/30 rounded px-1 -mx-1 py-0.5 transition-colors' : ''}`}
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
                    {raw && <span className="text-blue-500/50 text-[8px] ml-1">&#x2197;</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Active NOTAMs — clickable expand/collapse */}
        {airspaceCheck.notams.length > 0 && (
          <div className="space-y-1 mt-1">
            <span className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider">NOTAMs activos</span>
            {airspaceCheck.notams.map((notam, i) => (
              <NotamItem key={notam.id || i} notam={notam} />
            ))}
          </div>
        )}

        {/* No restrictions */}
        {airspaceCheck.zones.length === 0 && airspaceCheck.notams.length === 0 && (
          <p className="text-[10px] text-slate-500">
            No hay restricciones de espacio aéreo en esta zona
          </p>
        )}
      </div>
    </AlertSection>
  );
}

function ET0Section({ alerts }: { alerts: FieldAlerts }) {
  return (
    <AlertSection icon={<WeatherIcon id="thermometer" size={14} />} title="ET₀ Evapotranspiración" level={alerts.et0.level}>
      {alerts.et0.et0Daily !== null ? (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-400">ET₀ diaria</span>
            <span
              className="font-bold"
              style={{ color: alerts.et0.level === 'critico' ? '#ef4444' : alerts.et0.level === 'alto' ? '#f59e0b' : '#22c55e' }}
            >
              {alerts.et0.et0Daily.toFixed(1)} mm/día
            </span>
          </div>
          <div className="text-[9px] text-slate-400 leading-snug mt-1">
            {alerts.et0.irrigationAdvice}
          </div>
        </div>
      ) : (
        <p className="text-[10px] text-slate-500">Sin datos de previsión para cálculo ET₀</p>
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
    <AlertSection icon={<WeatherIcon id="leaf" size={14} />} title="Riesgo Fitosanitario" level={maxLevel}>
      <div className="space-y-2">
        {/* Mildiu */}
        <div>
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[10px] font-semibold text-slate-300">Mildiu</span>
            {alerts.disease.mildiu.level !== 'none' && (
              <span
                className="text-[8px] font-bold px-1 py-0.5 rounded"
                style={{
                  color: LEVEL_COLORS[alerts.disease.mildiu.level].text,
                  background: LEVEL_COLORS[alerts.disease.mildiu.level].bg,
                }}
              >
                {alerts.disease.mildiu.hours}h favorables
              </span>
            )}
          </div>
          <p className="text-[9px] text-slate-400">{alerts.disease.mildiu.detail}</p>
        </div>
        {/* Oídio */}
        <div>
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[10px] font-semibold text-slate-300">Oídio</span>
            {alerts.disease.oidio.level !== 'none' && (
              <span
                className="text-[8px] font-bold px-1 py-0.5 rounded"
                style={{
                  color: LEVEL_COLORS[alerts.disease.oidio.level].text,
                  background: LEVEL_COLORS[alerts.disease.oidio.level].bg,
                }}
              >
                {alerts.disease.oidio.hours}h favorables
              </span>
            )}
          </div>
          <p className="text-[9px] text-slate-400">{alerts.disease.oidio.detail}</p>
        </div>
        <p className="text-[8px] text-slate-600 italic border-t border-slate-700/30 pt-1">
          Referencia: viñedo Ribeiro (Ourense). No sustituye asesoramiento técnico.
        </p>
      </div>
    </AlertSection>
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
        <p className="text-[10px] text-slate-500">Sin alertas recientes registradas</p>
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
            <div key={`${entry.id}-${i}`} className="flex items-start gap-1.5 text-[9px]">
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
      <span className="text-[8px] text-slate-600">Confianza:</span>
      <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: `${value}%`,
            background: value >= 60 ? '#22c55e' : value >= 30 ? '#f59e0b' : '#64748b',
          }}
        />
      </div>
      <span className="text-[8px] text-slate-500 tabular-nums">{value}%</span>
    </div>
  );
}

// ── Alert section wrapper ────────────────────────────────

function AlertSection({
  icon,
  title,
  level,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  level: AlertLevel;
  children: React.ReactNode;
}) {
  const colors = LEVEL_COLORS[level];

  return (
    <div
      className="rounded-lg p-2.5 relative overflow-hidden"
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
      }}
    >
      {/* Severity bar on the left edge */}
      {level !== 'none' && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1 rounded-l-lg"
          style={{ background: colors.text }}
        />
      )}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm inline-flex">{icon}</span>
        <span className="text-[11px] font-bold text-slate-200">{title}</span>
        {level !== 'none' && (
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded ml-auto"
            style={{ color: colors.text, background: `${colors.text}15` }}
          >
            {LEVEL_LABELS[level]}
          </span>
        )}
      </div>
      {children}
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
              <span className="text-[7px] text-slate-600 font-mono">{b.label}</span>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-slate-700/30">
        <div className="flex items-center gap-0.5">
          <div className="w-2 h-2 rounded-sm" style={{ background: '#3b82f6' }} />
          <span className="text-[7px] text-slate-500">Riesgo</span>
        </div>
        <div className="flex items-center gap-0.5">
          <div className="w-2 h-2 rounded-sm" style={{ background: '#f59e0b' }} />
          <span className="text-[7px] text-slate-500">Alto</span>
        </div>
        <div className="flex items-center gap-0.5">
          <div className="w-2 h-2 rounded-sm" style={{ background: '#ef4444' }} />
          <span className="text-[7px] text-slate-500">Crítico</span>
        </div>
        <div className="flex items-center gap-0.5">
          <div className="w-2 h-2 rounded-sm" style={{ background: '#a855f7' }} />
          <span className="text-[7px] text-slate-500">Tormenta</span>
        </div>
      </div>
    </div>
  );
}
