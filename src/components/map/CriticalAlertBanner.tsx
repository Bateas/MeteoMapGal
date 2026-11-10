import { memo } from 'react';
import { useAlertStore } from '../../store/alertStore';
import { useUIStore } from '../../store/uiStore';
import { WeatherIcon, type IconId } from '../icons/WeatherIcons';

/**
 * Top-of-screen banner for PELIGRO-level (critical) alerts.
 * Shows when the composite risk is 'critical' (from the alert system). Lightning reaches it
 * through its own measured alert («PELIGRO — Tormenta encima», strikes inside the danger ring).
 * The storm predictor's «TORMENTA INMINENTE · N % · ~N min» no longer does: checked against the
 * stored season, that percentage and those minutes did not hold up (services/lightningStatus.ts).
 */
export const CriticalAlertBanner = memo(function CriticalAlertBanner() {
  const risk = useAlertStore((s) => s.risk);
  const alerts = useAlertStore((s) => s.alerts);
  const isMobile = useUIStore((s) => s.isMobile);
  const togglePanel = useAlertStore((s) => s.togglePanel);

  const criticalAlerts = alerts.filter(a => a.severity === 'critical');
  const hasCriticalAlerts = risk.severity === 'critical' && criticalAlerts.length > 0;

  // Nothing to show
  if (!hasCriticalAlerts) return null;

  const topAlert = criticalAlerts[0];
  if (!topAlert) return null;

  // Measured lightning keeps the storm's purple; every other danger is red.
  const isStorm = topAlert.category === 'storm';
  // Some titles already start with «PELIGRO —» (storm overhead): no «PELIGRO · PELIGRO».
  const title = /^PELIGRO/.test(topAlert.title) ? topAlert.title : `PELIGRO · ${topAlert.title}`;
  const subtitle = criticalAlerts.length > 1
    ? `${criticalAlerts.length} alertas criticas activas`
    : topAlert.detail;
  const icon = topAlert.icon as IconId;
  const bgColor = isStorm ? 'rgba(147, 51, 234, 0.22)' : 'rgba(239, 68, 68, 0.18)';
  const borderColor = isStorm ? 'rgba(147, 51, 234, 0.6)' : 'rgba(239, 68, 68, 0.5)';
  const textColor = isStorm ? '#c084fc' : '#ef4444';
  const glowClass = isStorm ? 'animate-pulse' : 'animate-pulse alert-glow-critical';

  return (
    <div
      // Phone: placed by AppShell's top-of-map column, first in the stack.
      className={`${isMobile ? 'max-w-full' : 'absolute z-30 top-3 left-1/2 -translate-x-1/2'} pointer-events-auto`}
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
      </div>
    </div>
  );
});
