import { memo, type ReactNode } from 'react';
import { useTemperatureOverlayStore } from '../../store/temperatureOverlayStore';
import { useUIStore } from '../../store/uiStore';
import { WeatherIcon } from '../icons/WeatherIcons';

/**
 * Floating button on the map to toggle the temperature gradient overlay.
 * Shows "T°" when off, "T° ON" when active, and a red "INV" badge whenever
 * a thermal inversion is detected (even when the overlay is off).
 * When overlay is active, also displays a gradient info badge.
 * Icon-only on mobile.
 */
export const TemperatureToggle = memo(function TemperatureToggle() {
  const isMobile = useUIStore((s) => s.isMobile);
  const showOverlay = useTemperatureOverlayStore((s) => s.showOverlay);
  const toggleOverlay = useTemperatureOverlayStore((s) => s.toggleOverlay);
  const thermalProfile = useTemperatureOverlayStore((s) => s.thermalProfile);

  const hasInversion = thermalProfile?.hasInversion ?? false;
  const isStrongInversion = thermalProfile?.status === 'strong-inversion';
  const regression = thermalProfile?.regression;

  // Determine button style based on overlay state + inversion
  let btnClasses: string;
  if (showOverlay) {
    btnClasses = hasInversion
      ? 'bg-red-500/25 border border-red-400/50 text-red-300 shadow-[0_0_15px_rgba(239,68,68,0.3)]'
      : 'bg-cyan-500/25 border border-cyan-400/50 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.3)]';
  } else {
    btnClasses = hasInversion
      ? `bg-slate-800/60 border border-red-600/40 text-red-400 hover:bg-red-900/30${isStrongInversion ? ' animate-pulse' : ''}`
      : 'bg-slate-800/60 border border-slate-600/40 text-slate-400 hover:bg-slate-700/60 hover:text-slate-300 hover:shadow-[0_0_12px_rgba(6,182,212,0.2)] hover:border-cyan-500/30';
  }

  // Build gradient info text when overlay is active
  let gradientInfo: ReactNode | null = null;
  let gradientColor = 'text-slate-400';
  if (showOverlay && regression) {
    const { slopePerKm, rSquared, stationCount } = regression;
    const rateStr = `${slopePerKm > 0 ? '+' : ''}${slopePerKm.toFixed(1)}°C/km`;
    if (hasInversion) {
      gradientInfo = <><WeatherIcon id="alert-triangle" size={12} /> INVERSIÓN {rateStr} · {stationCount} est. · R²={rSquared.toFixed(2)}</>;
      gradientColor = 'text-amber-400';
    } else {
      gradientInfo = `${rateStr} · ${stationCount} est. · R²=${rSquared.toFixed(2)}`;
      gradientColor = 'text-slate-400';
    }
  }

  return (
    <div className="flex flex-col items-start gap-1 shrink-0">
      {/* Gradient info badge — above button when overlay is on (desktop only to save space) */}
      {gradientInfo && !isMobile && (
        <div
          className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[9px] font-semibold tracking-wide
            backdrop-blur-md bg-slate-900/70 border border-slate-700/50
            ${gradientColor} transition-opacity duration-300 whitespace-nowrap`}
        >
          {gradientInfo}
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={toggleOverlay}
        className={`flex items-center justify-center
          rounded-lg font-bold tracking-wide
          backdrop-blur-md transition-all duration-200 cursor-pointer
          ${isMobile ? 'gap-1 min-w-[44px] min-h-[44px] px-2.5 py-2 text-base' : 'gap-1.5 px-3 py-1.5 text-[11px]'}
          ${btnClasses}`}
        title={
          isMobile
            ? (showOverlay ? 'Ocultar gradiente de temperatura' : 'Mostrar gradiente de temperatura')
            : (showOverlay ? 'Ocultar gradiente de temperatura (T)' : 'Mostrar gradiente de temperatura (T)')
        }
      >
        <WeatherIcon id="thermometer" size={isMobile ? 18 : 14} />
        {!isMobile && <span>{showOverlay ? 'T° ON' : 'T°'}</span>}
        {hasInversion && (
          <span className="text-[9px] px-1 py-0.5 rounded bg-red-500/30 text-red-300 font-bold">
            INV
          </span>
        )}
      </button>
    </div>
  );
});
