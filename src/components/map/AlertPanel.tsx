import { memo, useMemo, useCallback, useState } from 'react';
import { useAlertStore } from '../../store/alertStore';
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';
import { NotificationControl } from './NotificationControl';
import { WeatherIcon } from '../icons/WeatherIcons';
import type { IconId } from '../icons/WeatherIcons';
import type { UnifiedAlert, AlertSeverity, CompositeRisk } from '../../services/alertService';

// Compact inline icon for validation buttons (smaller than WeatherIcon)
function MiniIcon({ id, size = 12, className = '' }: { id: IconId; size?: number; className?: string }) {
  return <WeatherIcon id={id} size={size} className={className} />;
}

// ── Severity color palette ───────────────────────────────────

const SEVERITY_COLORS: Record<AlertSeverity, {
  bg: string; border: string; text: string; glow: string;
}> = {
  critical: {
    bg: 'rgba(239, 68, 68, 0.15)',
    border: 'rgba(239, 68, 68, 0.5)',
    text: '#ef4444',
    glow: '0 0 20px rgba(239, 68, 68, 0.2)',
  },
  high: {
    bg: 'rgba(249, 115, 22, 0.12)',
    border: 'rgba(249, 115, 22, 0.4)',
    text: '#f97316',
    glow: '0 0 15px rgba(249, 115, 22, 0.15)',
  },
  moderate: {
    bg: 'rgba(234, 179, 8, 0.10)',
    border: 'rgba(234, 179, 8, 0.35)',
    text: '#eab308',
    glow: '0 0 10px rgba(234, 179, 8, 0.1)',
  },
  info: {
    bg: 'rgba(59, 130, 246, 0.08)',
    border: 'rgba(59, 130, 246, 0.25)',
    text: '#3b82f6',
    glow: 'none',
  },
};

const SEMAPHORE: Record<CompositeRisk['color'], {
  bg: string; border: string; text: string; label: string; glow: string;
}> = {
  green: {
    bg: 'rgba(34, 197, 94, 0.10)',
    border: 'rgba(34, 197, 94, 0.3)',
    text: '#22c55e',
    label: 'OK',
    glow: 'none',
  },
  yellow: {
    bg: 'rgba(234, 179, 8, 0.10)',
    border: 'rgba(234, 179, 8, 0.35)',
    text: '#eab308',
    label: 'AVISO',
    glow: '0 0 12px rgba(234, 179, 8, 0.12)',
  },
  orange: {
    bg: 'rgba(249, 115, 22, 0.12)',
    border: 'rgba(249, 115, 22, 0.4)',
    text: '#f97316',
    label: 'ALERTA',
    glow: '0 0 18px rgba(249, 115, 22, 0.18)',
  },
  red: {
    bg: 'rgba(239, 68, 68, 0.15)',
    border: 'rgba(239, 68, 68, 0.5)',
    text: '#ef4444',
    label: 'PELIGRO',
    glow: '0 0 25px rgba(239, 68, 68, 0.25)',
  },
};

// ── Alert chip (compact single alert) ────────────────────────

function AlertChip({ alert }: { alert: UnifiedAlert }) {
  const colors = SEVERITY_COLORS[alert.severity];

  return (
    <div
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] shrink-0
        ${alert.urgent ? 'animate-pulse' : ''}`}
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
      }}
      title={alert.detail}
    >
      <span className="text-xs leading-none"><WeatherIcon id={alert.icon as IconId} size={12} /></span>
      <span
        className="font-bold tracking-wide truncate max-w-[100px] md:max-w-[140px]"
        style={{ color: colors.text }}
      >
        {alert.title}
      </span>
      {/* Score hidden from UI — internal metric only */}
    </div>
  );
}

// ── Alert detail row (expanded view) ─────────────────────────

function AlertRow({ alert }: { alert: UnifiedAlert }) {
  const colors = SEVERITY_COLORS[alert.severity];
  const validateAlert = useAlertStore((s) => s.validateAlert);
  const validations = useAlertStore((s) => s.validations);
  const activeSectorId = useSectorStore((s) => s.activeSector.id);
  const [justValidated, setJustValidated] = useState<boolean | null>(null);

  // Check if this alert was recently validated (within last 30min) — sector-specific
  const recentValidation = useMemo(() => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    return validations.find(
      (v) => v.alertId === alert.id && v.validatedAt > cutoff &&
        (!v.sectorId || v.sectorId === activeSectorId),
    );
  }, [validations, alert.id, activeSectorId]);

  const handleValidate = useCallback((valid: boolean, e: React.MouseEvent) => {
    e.stopPropagation(); // Don't toggle panel
    validateAlert(alert.id, valid);
    setJustValidated(valid);
    // Reset feedback after 3s
    setTimeout(() => setJustValidated(null), 3000);
  }, [alert.id, validateAlert]);

  const showValidation = recentValidation || justValidated !== null;
  const validValue = justValidated ?? recentValidation?.valid;

  return (
    <div
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg
        ${alert.urgent ? 'animate-pulse' : ''}
        ${alert.severity === 'critical' ? 'alert-glow-critical' : alert.severity === 'high' ? 'alert-glow-amber' : ''}`}
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
      }}
    >
      <span className="text-sm leading-none shrink-0"><WeatherIcon id={alert.icon as IconId} size={14} /></span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-bold tracking-wide"
            style={{ color: colors.text }}
          >
            {alert.title}
          </span>
        </div>
        <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
          <span className="truncate">{alert.detail}</span>
          {alert.confidence != null && (
            <span
              className="shrink-0 text-[9px] font-mono px-1 rounded"
              style={{
                background: alert.confidence >= 70 ? 'rgba(34,197,94,0.15)' : alert.confidence >= 40 ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.15)',
                color: alert.confidence >= 70 ? '#22c55e' : alert.confidence >= 40 ? '#eab308' : '#ef4444',
              }}
              title={`Confianza: ${alert.confidence}%`}
            >
              {alert.confidence}%
            </span>
          )}
        </div>
      </div>

      {/* Validation buttons */}
      <div className="flex items-center gap-0.5 shrink-0 ml-1">
        {showValidation ? (
          <span
            className="text-xs px-1.5 py-0.5 rounded"
            style={{
              background: validValue ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
              color: validValue ? '#22c55e' : '#ef4444',
            }}
          >
            {validValue ? '✓' : '✗'}
          </span>
        ) : (
          <>
            <button
              onClick={(e) => handleValidate(true, e)}
              className="px-1 py-0.5 rounded opacity-50 hover:opacity-100 transition-opacity"
              style={{ color: '#22c55e' }}
              title="Alerta correcta"
            >
              <MiniIcon id="thumbs-up" size={13} />
            </button>
            <button
              onClick={(e) => handleValidate(false, e)}
              className="px-1 py-0.5 rounded opacity-50 hover:opacity-100 transition-opacity"
              style={{ color: '#ef4444' }}
              title="Falso positivo"
            >
              <MiniIcon id="thumbs-down" size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Semaphore dot ────────────────────────────────────────────

function SemaphoreDot({ risk }: { risk: CompositeRisk }) {
  const config = SEMAPHORE[risk.color];

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer shrink-0"
      style={{
        background: config.bg,
        border: `1px solid ${config.border}`,
        boxShadow: config.glow,
      }}
    >
      <div
        className={`w-2.5 h-2.5 rounded-full ${
          risk.severity === 'critical' ? 'animate-pulse' : ''
        }`}
        style={{ backgroundColor: config.text }}
      />
      <span
        className="text-[10px] font-black tracking-[0.1em]"
        style={{ color: config.text }}
      >
        {config.label}
      </span>
      {risk.activeCount > 0 && (
        <span className="text-[9px] text-slate-500 font-mono">
          {risk.activeCount}
        </span>
      )}
    </div>
  );
}

// ── Main AlertPanel ──────────────────────────────────────────

export const AlertPanel = memo(function AlertPanel() {
  const isMobile = useUIStore((s) => s.isMobile);
  const alerts = useAlertStore((s) => s.alerts);
  const risk = useAlertStore((s) => s.risk);
  const panelExpanded = useAlertStore((s) => s.panelExpanded);
  const togglePanel = useAlertStore((s) => s.togglePanel);
  const validationCount = useAlertStore((s) => s.validations.length);

  // Separate alerts by importance
  const { topAlerts, otherAlerts } = useMemo(() => {
    const top = alerts.filter(a => a.severity !== 'info');
    const other = alerts.filter(a => a.severity === 'info');
    return { topAlerts: top, otherAlerts: other };
  }, [alerts]);

  const hasAlerts = alerts.length > 0;

  return (
    <div className="flex flex-col items-center gap-1.5 w-full">
      {/* Expanded panel: full alert list */}
      {panelExpanded && hasAlerts && (
        <div
          className="w-full rounded-xl px-3 py-2.5 backdrop-blur-md space-y-1.5"
          style={{
            background: 'rgba(15, 23, 42, 0.92)',
            border: '1px solid rgba(100, 116, 139, 0.25)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase">
              Alertas activas <span className="badge-beta ml-1">Beta</span>
              {validationCount > 0 && (
                <span className="ml-2 text-[9px] font-normal text-slate-600" title="Alertas validadas (30 días)">
                  {validationCount} validadas
                </span>
              )}
            </span>
            {!isMobile && (
              <span className="text-[9px] text-slate-600 font-mono flex items-center gap-0.5">
                <MiniIcon id="thumbs-up" size={9} /><MiniIcon id="thumbs-down" size={9} /> para validar · A para cerrar
              </span>
            )}
          </div>

          {/* Alert rows */}
          {topAlerts.map((a) => (
            <AlertRow key={a.id} alert={a} />
          ))}
          {otherAlerts.map((a) => (
            <AlertRow key={a.id} alert={a} />
          ))}

          {alerts.length === 0 && (
            <div className="text-[10px] text-slate-600 text-center py-2">
              Sin alertas activas
            </div>
          )}

          {/* Notification settings */}
          <NotificationControl />
        </div>
      )}

      {/* Compact strip: semaphore + top alert chips (always visible) */}
      <div
        className={`flex items-center gap-1.5 rounded-xl px-2 py-1.5 backdrop-blur-md cursor-pointer
          ${isMobile ? 'max-w-[calc(100vw-1rem)] overflow-x-auto scroll-hint-right' : ''}`}
        style={{
          background: 'rgba(15, 23, 42, 0.85)',
          border: `1px solid rgba(100, 116, 139, 0.2)`,
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
        }}
        onClick={togglePanel}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePanel(); } }}
        tabIndex={0}
        role="button"
        aria-label="Ver panel de alertas"
      >
        <SemaphoreDot risk={risk} />

        {/* Top alert chips in compact mode — fewer on mobile */}
        {!panelExpanded && topAlerts.slice(0, isMobile ? 2 : 3).map((a) => (
          <AlertChip key={a.id} alert={a} />
        ))}

        {/* Overflow indicator */}
        {!panelExpanded && topAlerts.length > (isMobile ? 2 : 3) && (
          <span className="text-[9px] text-slate-500 font-mono shrink-0">
            +{topAlerts.length - (isMobile ? 2 : 3)}
          </span>
        )}

        {/* No alerts = show friendly message */}
        {!hasAlerts && (
          <span className="text-[10px] text-slate-500 px-1">
            {isMobile ? 'Sin alertas' : 'Sin alertas · todo en orden'}
          </span>
        )}

        {/* Expand/collapse indicator */}
        <span className="text-[9px] text-slate-600 ml-auto shrink-0">
          {panelExpanded ? '▼' : '▲'}
        </span>
      </div>
    </div>
  );
});
