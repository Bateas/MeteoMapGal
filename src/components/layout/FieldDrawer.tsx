/**
 * FieldDrawer — right-side drawer for agricultural alerts ("Campo").
 * Overlays the map. Doesn't touch the sidebar.
 */

import { useEffect, useRef } from 'react';
import type { FieldAlerts, AlertLevel } from '../../types/campo';

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

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Delay to avoid closing immediately on the toggle click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [open, onClose]);

  return (
    <div
      ref={drawerRef}
      className={`fixed right-0 top-0 h-full w-72 z-30 bg-slate-900/95 backdrop-blur-sm border-l border-slate-700 transition-transform duration-300 ease-in-out ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-sm">🌾</span>
          <span className="text-sm font-bold text-white">Campo</span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-200 text-lg leading-none px-1"
        >
          &times;
        </button>
      </div>

      {!alerts ? (
        <div className="p-4 text-xs text-slate-500 text-center">
          Cargando datos de previsión...
        </div>
      ) : (
        <div className="p-3 space-y-3 overflow-y-auto h-[calc(100%-52px)]">
          {/* ── Frost section ── */}
          <AlertSection
            icon="❄️"
            title="Helada"
            level={alerts.frost.level}
          >
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

          {/* ── Rain / hail section ── */}
          <AlertSection
            icon={alerts.rain.hailRisk ? '🌨️' : '🌧️'}
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
                {alerts.rain.hailRisk && (
                  <div className="text-[10px] text-red-400 font-semibold mt-1">
                    ⚠ Riesgo de granizo detectado (CAPE alto + precipitación fuerte)
                  </div>
                )}
              </div>
            )}
          </AlertSection>

          {/* ── Fog / dew point section (based on REAL data) ── */}
          <AlertSection
            icon="🌫️"
            title="Niebla / Rocío"
            level={alerts.fog.level}
          >
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
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-[8px] text-slate-600">Confianza:</span>
                  <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${alerts.fog.confidence}%`,
                        background: alerts.fog.confidence >= 60 ? '#22c55e' : alerts.fog.confidence >= 30 ? '#f59e0b' : '#64748b',
                      }}
                    />
                  </div>
                  <span className="text-[8px] text-slate-500 tabular-nums">{alerts.fog.confidence}%</span>
                </div>
              </div>
            ) : (
              <p className="text-[10px] text-slate-500">
                Recogiendo datos reales... (necesita ~30 min de lecturas)
              </p>
            )}
          </AlertSection>

          {/* ── Wind propagation section ── */}
          <AlertSection
            icon="📡"
            title="Propagación Viento"
            level={alerts.wind.active ? 'riesgo' : 'none'}
          >
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
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-[8px] text-slate-600">Confianza:</span>
                  <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${alerts.wind.confidence}%`,
                        background: alerts.wind.confidence >= 60 ? '#22c55e' : alerts.wind.confidence >= 30 ? '#f59e0b' : '#64748b',
                      }}
                    />
                  </div>
                  <span className="text-[8px] text-slate-500 tabular-nums">{alerts.wind.confidence}%</span>
                </div>
              </div>
            ) : (
              <p className="text-[10px] text-slate-500">
                {alerts.wind.summary}
              </p>
            )}
          </AlertSection>

          {/* ── Drone section ── */}
          <AlertSection
            icon="🛩️"
            title="Vuelo Dron"
            level={alerts.drone.flyable ? 'none' : 'riesgo'}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded"
                  style={{
                    background: alerts.drone.flyable ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                    color: alerts.drone.flyable ? '#22c55e' : '#ef4444',
                    border: `1px solid ${alerts.drone.flyable ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                  }}
                >
                  {alerts.drone.flyable ? 'APTO' : 'NO VOLAR'}
                </span>
                <span className="text-[10px] text-slate-400">
                  Viento: {alerts.drone.windKt.toFixed(0)} kt
                </span>
              </div>
              {alerts.drone.reasons.length > 0 && (
                <ul className="text-[9px] text-slate-400 space-y-0.5 mt-1">
                  {alerts.drone.reasons.map((r, i) => (
                    <li key={i} className="flex items-start gap-1">
                      <span className="text-red-400 mt-0.5">•</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </AlertSection>
        </div>
      )}
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
  icon: string;
  title: string;
  level: AlertLevel;
  children: React.ReactNode;
}) {
  const colors = LEVEL_COLORS[level];

  return (
    <div
      className="rounded-lg p-2.5"
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">{icon}</span>
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
