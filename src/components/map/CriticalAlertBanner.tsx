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
  const openConditions = useUIStore((s) => s.setFieldDrawerOpen);

  const criticalAlerts = alerts.filter(a => a.severity === 'critical');
  const hasCriticalAlerts = risk.severity === 'critical' && criticalAlerts.length > 0;

  // Nothing to show
  if (!hasCriticalAlerts) return null;

  const topAlert = criticalAlerts[0];
  if (!topAlert) return null;

  // Measured lightning keeps the storm's purple; every other danger is red.
  const band = topAlert.category === 'storm' ? 'gc-band--storm' : 'gc-band--danger';
  // Some titles already start with «PELIGRO —» (storm overhead): no «PELIGRO · PELIGRO».
  const title = /^PELIGRO/.test(topAlert.title) ? topAlert.title : `PELIGRO · ${topAlert.title}`;
  const subtitle = criticalAlerts.length > 1
    ? `${criticalAlerts.length} alertas críticas activas`
    : topAlert.detail;
  const icon = topAlert.icon as IconId;

  return (
    <div
      // Placed by a column at the top of the map, first in the stack: AppShell's on a phone, WeatherMap's on a desktop.
      className="max-w-full pointer-events-auto"
      role="alert"
      aria-live="assertive"
    >
      <button type="button" className={`gc-band ${band}`} onClick={() => openConditions(true)} title="Ver los detalles">
        <WeatherIcon id={icon} size={isMobile ? 16 : 20} />
        <span>
          <b>{title}</b>
          <span>{subtitle}</span>
        </span>
      </button>
    </div>
  );
});
