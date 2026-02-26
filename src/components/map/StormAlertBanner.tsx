import { memo } from 'react';
import { useLightningStore } from '../../hooks/useLightningData';
import type { StormAlertLevel } from '../../types/lightning';

const ALERT_CONFIG: Record<
  Exclude<StormAlertLevel, 'none'>,
  { bg: string; border: string; text: string; icon: string; label: string }
> = {
  watch: {
    bg: 'bg-amber-950/80',
    border: 'border-amber-600',
    text: 'text-amber-300',
    icon: '⚡',
    label: 'VIGILANCIA',
  },
  warning: {
    bg: 'bg-orange-950/80',
    border: 'border-orange-500',
    text: 'text-orange-300',
    icon: '⛈️',
    label: 'AVISO',
  },
  danger: {
    bg: 'bg-red-950/90',
    border: 'border-red-500',
    text: 'text-red-300',
    icon: '🔴',
    label: 'PELIGRO',
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

  if (alert.level === 'none') return null;

  const config = ALERT_CONFIG[alert.level];
  const trendText = TREND_TEXT[alert.trend] || '';

  return (
    <div
      className={`absolute top-2 left-1/2 -translate-x-1/2 z-20
        ${config.bg} ${config.border} border rounded-lg px-4 py-2
        backdrop-blur-sm shadow-lg max-w-md
        ${alert.level === 'danger' ? 'animate-pulse' : ''}`}
    >
      <div className="flex items-center gap-3">
        <span className="text-xl">{config.icon}</span>
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-bold tracking-wider ${config.text}`}>
            {config.label} — TORMENTA
          </div>
          <div className="text-xs text-slate-300 mt-0.5">
            Rayo más cercano a{' '}
            <span className="font-semibold text-white">
              {alert.nearestKm} km
            </span>
            {' del embalse'}
            {trendText && (
              <span className={config.text}> · {trendText}</span>
            )}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            {alert.recentCount} rayo{alert.recentCount !== 1 ? 's' : ''} en
            30min · {strikes.length} total 24h
          </div>
        </div>
      </div>
    </div>
  );
});
