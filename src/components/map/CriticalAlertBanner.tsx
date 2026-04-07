import { memo } from 'react';
import { useAlertStore } from '../../store/alertStore';
import { useUIStore } from '../../store/uiStore';
import { useStormPrediction } from '../../hooks/useStormPrediction';
import { WeatherIcon, type IconId } from '../icons/WeatherIcons';

/**
 * Top-of-screen banner for PELIGRO-level (critical) alerts.
 * Shows when:
 * 1. Composite risk is 'critical' (from alert system), OR
 * 2. Storm predictor says 'imminent' with high probability
 *
 * If both, storm takes visual priority but shows counter for other alerts.
 */
export const CriticalAlertBanner = memo(function CriticalAlertBanner() {
  const risk = useAlertStore((s) => s.risk);
  const alerts = useAlertStore((s) => s.alerts);
  const isMobile = useUIStore((s) => s.isMobile);
  const togglePanel = useAlertStore((s) => s.togglePanel);
  const prediction = useStormPrediction();

  const criticalAlerts = alerts.filter(a => a.severity === 'critical');
  const hasCriticalAlerts = risk.severity === 'critical' && criticalAlerts.length > 0;
  const hasImminentStorm = prediction.horizon === 'imminent' && prediction.probability >= 60;

  // Nothing to show
  if (!hasCriticalAlerts && !hasImminentStorm) return null;

  // Determine what to display
  let title: string;
  let subtitle: string;
  let icon: IconId;
  let bgColor: string;
  let borderColor: string;
  let textColor: string;
  let glowClass: string;
  let otherAlertCount = 0;

  if (hasImminentStorm) {
    // Storm predictor takes priority when imminent
    title = `TORMENTA INMINENTE · ${prediction.probability}%`;
    subtitle = prediction.action;
    icon = 'zap';
    bgColor = 'rgba(147, 51, 234, 0.22)';
    borderColor = 'rgba(147, 51, 234, 0.6)';
    textColor = '#c084fc';
    glowClass = 'animate-pulse';
    // Count concurrent non-storm critical alerts
    otherAlertCount = criticalAlerts.filter(a => a.category !== 'storm').length;
  } else {
    // Standard critical alert
    const topAlert = criticalAlerts[0];
    if (!topAlert) return null;

    title = `PELIGRO · ${topAlert.title}`;
    subtitle = criticalAlerts.length > 1
      ? `${criticalAlerts.length} alertas criticas activas`
      : topAlert.detail;
    icon = topAlert.icon as IconId;
    bgColor = 'rgba(239, 68, 68, 0.18)';
    borderColor = 'rgba(239, 68, 68, 0.5)';
    textColor = '#ef4444';
    glowClass = 'animate-pulse alert-glow-critical';
  }

  return (
    <div
      className={`${isMobile ? 'fixed z-30 top-[4.25rem]' : 'absolute z-30 top-3'} left-1/2 -translate-x-1/2 pointer-events-auto`}
      role="alert"
      aria-live="assertive"
    >
      <div
        className={`flex items-center rounded-lg font-semibold shadow-lg cursor-pointer
          ${glowClass}
          ${isMobile ? 'gap-1.5 px-3 py-1.5 text-[11px] max-w-[calc(100vw-2rem)]' : 'gap-2.5 px-4 py-2 text-xs'}`}
        style={{
          background: bgColor,
          border: `1px solid ${borderColor}`,
          color: textColor,
          boxShadow: `0 0 25px ${borderColor}, 0 4px 20px rgba(0, 0, 0, 0.4)`,
        }}
        onClick={togglePanel}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePanel(); } }}
        tabIndex={0}
        role="button"
        title="Click para ver detalles"
      >
        <WeatherIcon id={icon} size={isMobile ? 14 : 18} />
        <div className="flex flex-col min-w-0">
          <span className={`font-black tracking-wide truncate ${isMobile ? 'text-xs' : 'text-sm'}`}>
            {title}
          </span>
          <span className={`font-normal opacity-80 truncate ${isMobile ? 'text-[10px]' : 'text-[11px]'}`}>
            {subtitle}
          </span>
        </div>
        {hasImminentStorm && prediction.etaMinutes != null && prediction.etaMinutes < 60 && (
          <span className={`font-black ${isMobile ? 'text-xs' : 'text-sm'} ml-1 shrink-0`}>
            ~{prediction.etaMinutes}min
          </span>
        )}
      </div>
      {/* Concurrent alert counter below main banner */}
      {otherAlertCount > 0 && (
        <div
          className="mt-1 mx-auto w-fit px-2 py-0.5 rounded text-[10px] font-medium cursor-pointer"
          style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#fca5a5',
          }}
          onClick={togglePanel}
        >
          + {otherAlertCount} alerta{otherAlertCount > 1 ? 's' : ''} critica{otherAlertCount > 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
});
