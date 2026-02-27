import { memo } from 'react';
import { useLightningStore } from '../../hooks/useLightningData';
import type { StormAlertLevel } from '../../types/lightning';
import { degreesToCardinal } from '../../services/windUtils';

/**
 * Alert level colors — unified scheme:
 *   none:    hidden
 *   watch:   yellow/amber — activity detected, monitoring
 *   warning: orange — storm approaching
 *   danger:  red — storm overhead or imminent
 */
const ALERT_CONFIG: Record<
  Exclude<StormAlertLevel, 'none'>,
  { bg: string; border: string; text: string; icon: string; label: string; glow: string }
> = {
  watch: {
    bg: 'rgba(234, 179, 8, 0.12)',
    border: 'rgba(234, 179, 8, 0.4)',
    text: '#eab308',
    icon: '⚡',
    label: 'VIGILANCIA',
    glow: '0 0 20px rgba(234, 179, 8, 0.15)',
  },
  warning: {
    bg: 'rgba(249, 115, 22, 0.14)',
    border: 'rgba(249, 115, 22, 0.5)',
    text: '#f97316',
    icon: '⛈️',
    label: 'AVISO',
    glow: '0 0 25px rgba(249, 115, 22, 0.2)',
  },
  danger: {
    bg: 'rgba(239, 68, 68, 0.18)',
    border: 'rgba(239, 68, 68, 0.6)',
    text: '#ef4444',
    icon: '🔴',
    label: 'PELIGRO',
    glow: '0 0 30px rgba(239, 68, 68, 0.3)',
  },
};

const TREND_TEXT: Record<string, string> = {
  approaching: 'acercándose',
  receding: 'alejándose',
  stationary: 'estacionaria',
};

/**
 * Storm alert banner displayed over the map when lightning
 * is detected within the watch radius (50km of reservoir).
 */
export const StormAlertBanner = memo(function StormAlertBanner() {
  const alert = useLightningStore((s) => s.stormAlert);
  const strikes = useLightningStore((s) => s.strikes);
  const simulationActive = useLightningStore((s) => s.simulationActive);

  if (alert.level === 'none') return null;

  const config = ALERT_CONFIG[alert.level];
  const trendText = TREND_TEXT[alert.trend] || '';

  // Direction label from bearing
  const dirLabel = alert.bearingDeg !== null
    ? `desde ${degreesToCardinal(alert.bearingDeg)}`
    : '';

  return (
    <div
      className={`absolute top-2 left-1/2 -translate-x-1/2 z-20
        rounded-lg px-4 py-2.5 backdrop-blur-md max-w-lg
        ${alert.level === 'danger' ? 'animate-pulse' : ''}`}
      style={{
        background: config.bg,
        border: `1px solid ${config.border}`,
        boxShadow: config.glow,
      }}
    >
      <div className="flex items-center gap-3">
        <span className="text-xl">{config.icon}</span>

        <div className="flex-1 min-w-0">
          {/* Top row: level + label */}
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] font-black tracking-[0.15em]"
              style={{ color: config.text }}
            >
              {config.label}
            </span>
            {simulationActive && (
              <span className="text-[8px] bg-purple-500/30 text-purple-300 px-1.5 py-0.5 rounded font-mono">
                SIM
              </span>
            )}
          </div>

          {/* Middle row: distance + trend + ETA */}
          <div className="text-xs text-slate-300 mt-1 flex items-center gap-1.5 flex-wrap">
            <span>
              Rayo más cercano a{' '}
              <span className="font-bold text-white">{alert.nearestKm} km</span>
            </span>
            {trendText && (
              <span
                className="font-semibold"
                style={{ color: config.text }}
              >
                · {trendText}
              </span>
            )}
            {alert.etaMinutes !== null && alert.trend === 'approaching' && (
              <span className="font-bold text-white bg-red-500/20 px-1.5 py-0.5 rounded text-[10px]">
                ETA ~{alert.etaMinutes} min
              </span>
            )}
          </div>

          {/* Bottom row: count + velocity */}
          <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-2">
            <span>
              {alert.recentCount} rayo{alert.recentCount !== 1 ? 's' : ''}/30min
            </span>
            <span className="text-slate-600">·</span>
            <span>{strikes.length} total 24h</span>
            {alert.speedKmh !== null && (
              <>
                <span className="text-slate-600">·</span>
                <span className="font-mono">
                  {alert.speedKmh} km/h {dirLabel}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
