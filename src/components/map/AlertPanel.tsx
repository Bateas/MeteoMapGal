import { memo, useMemo } from 'react';
import { useAlertStore } from '../../store/alertStore';
import type { UnifiedAlert, AlertSeverity, CompositeRisk } from '../../services/alertService';

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
    label: 'ATENCIÓN',
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
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] shrink-0
        ${alert.urgent ? 'animate-pulse' : ''}`}
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
      }}
      title={alert.detail}
    >
      <span className="text-xs leading-none">{alert.icon}</span>
      <span
        className="font-bold tracking-wide truncate max-w-[140px]"
        style={{ color: colors.text }}
      >
        {alert.title}
      </span>
      <span className="text-slate-500 font-mono">{alert.score}</span>
    </div>
  );
}

// ── Alert detail row (expanded view) ─────────────────────────

function AlertRow({ alert }: { alert: UnifiedAlert }) {
  const colors = SEVERITY_COLORS[alert.severity];

  return (
    <div
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg
        ${alert.urgent ? 'animate-pulse' : ''}`}
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
      }}
    >
      <span className="text-sm leading-none shrink-0">{alert.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-bold tracking-wide"
            style={{ color: colors.text }}
          >
            {alert.title}
          </span>
          <span className="text-[9px] text-slate-500 font-mono">
            {alert.score}pts
          </span>
        </div>
        <div className="text-[10px] text-slate-400 truncate mt-0.5">
          {alert.detail}
        </div>
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
  const alerts = useAlertStore((s) => s.alerts);
  const risk = useAlertStore((s) => s.risk);
  const panelExpanded = useAlertStore((s) => s.panelExpanded);
  const togglePanel = useAlertStore((s) => s.togglePanel);

  // Separate alerts by importance
  const { topAlerts, otherAlerts } = useMemo(() => {
    const top = alerts.filter(a => a.severity !== 'info');
    const other = alerts.filter(a => a.severity === 'info');
    return { topAlerts: top, otherAlerts: other };
  }, [alerts]);

  const hasAlerts = alerts.length > 0;

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5 max-w-2xl w-full px-3">
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
              Alertas activas
            </span>
            <span className="text-[9px] text-slate-600 font-mono">
              Pulsa A para cerrar
            </span>
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
        </div>
      )}

      {/* Compact strip: semaphore + top alert chips (always visible) */}
      <div
        className="flex items-center gap-1.5 rounded-xl px-2 py-1.5 backdrop-blur-md cursor-pointer"
        style={{
          background: 'rgba(15, 23, 42, 0.85)',
          border: `1px solid rgba(100, 116, 139, 0.2)`,
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
        }}
        onClick={togglePanel}
      >
        <SemaphoreDot risk={risk} />

        {/* Top 3 alert chips in compact mode */}
        {!panelExpanded && topAlerts.slice(0, 3).map((a) => (
          <AlertChip key={a.id} alert={a} />
        ))}

        {/* Overflow indicator */}
        {!panelExpanded && topAlerts.length > 3 && (
          <span className="text-[9px] text-slate-500 font-mono shrink-0">
            +{topAlerts.length - 3}
          </span>
        )}

        {/* No alerts = show friendly message */}
        {!hasAlerts && (
          <span className="text-[10px] text-slate-500 px-1">
            Sin alertas · todo en orden
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
