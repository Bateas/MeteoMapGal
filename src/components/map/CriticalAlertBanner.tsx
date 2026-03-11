import { memo } from 'react';
import { useAlertStore } from '../../store/alertStore';
import { useUIStore } from '../../store/uiStore';
import { WeatherIcon, type IconId } from '../icons/WeatherIcons';

/**
 * Top-of-screen banner for PELIGRO-level (critical) alerts.
 * Shows only when composite risk is 'critical'.
 * Both sectors (Embalse + Rías).
 */
export const CriticalAlertBanner = memo(function CriticalAlertBanner() {
  const risk = useAlertStore((s) => s.risk);
  const alerts = useAlertStore((s) => s.alerts);
  const isMobile = useUIStore((s) => s.isMobile);
  const togglePanel = useAlertStore((s) => s.togglePanel);

  // Only show for critical severity
  if (risk.severity !== 'critical') return null;

  // Find the highest-scoring critical alert for display
  const criticalAlerts = alerts.filter(a => a.severity === 'critical');
  const topAlert = criticalAlerts[0]; // Already sorted by score

  if (!topAlert) return null;

  const subtitle = criticalAlerts.length > 1
    ? `${criticalAlerts.length} alertas críticas activas`
    : topAlert.detail;

  return (
    <div
      className={`${isMobile ? 'fixed z-30 top-[4.25rem]' : 'absolute z-30 top-3'} left-1/2 -translate-x-1/2 pointer-events-auto`}
    >
      <div
        className={`flex items-center rounded-lg backdrop-blur-md font-semibold shadow-lg cursor-pointer
          animate-pulse alert-glow-critical
          ${isMobile ? 'gap-1.5 px-3 py-1.5 text-[11px] max-w-[calc(100vw-2rem)]' : 'gap-2.5 px-4 py-2 text-xs'}`}
        style={{
          background: 'rgba(239, 68, 68, 0.18)',
          border: '1px solid rgba(239, 68, 68, 0.5)',
          color: '#ef4444',
          boxShadow: '0 0 25px rgba(239, 68, 68, 0.25), 0 4px 20px rgba(0, 0, 0, 0.4)',
        }}
        onClick={togglePanel}
        title="Click para ver todas las alertas"
      >
        <WeatherIcon id={topAlert.icon as IconId} size={isMobile ? 14 : 18} />
        <div className="flex flex-col min-w-0">
          <span className={`font-black tracking-wide truncate ${isMobile ? 'text-xs' : 'text-sm'}`}>
            PELIGRO · {topAlert.title}
          </span>
          {!isMobile && (
            <span className="text-[10px] font-normal opacity-70 truncate">
              {subtitle}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});
