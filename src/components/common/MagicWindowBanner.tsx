/**
 * MagicWindowBanner — top-of-app callout when a magic window is active in Rías.
 *
 * T2-2 (S136+3+3). Shows up only when the backend detector confirms the rare
 * alignment of SW synoptic + ΔT + thermal hour + humid mouth for sector 'rias'.
 * Tone is "don't miss this" — small but distinctive purple/amber gradient
 * with a wind icon.
 *
 * Dismissible per session (re-shows on reload) — doesn't pollute storage,
 * matches the reactive-map philosophy of "info that helps the next decision".
 */
import { memo, useState, useEffect } from 'react';
import { useMagicWindow } from '../../hooks/useMagicWindow';
import { WeatherIcon } from '../icons/WeatherIcons';

export const MagicWindowBanner = memo(function MagicWindowBanner() {
  const magic = useMagicWindow();
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  // Reset dismiss when a NEW detection arrives (different detectedAt)
  useEffect(() => {
    if (magic?.detectedAt && dismissedFor && dismissedFor !== magic.detectedAt) {
      setDismissedFor(null);
    }
  }, [magic?.detectedAt, dismissedFor]);

  if (!magic || !magic.active) return null;
  if (dismissedFor === magic.detectedAt) return null;

  const isPeak = (magic.score ?? 0) >= 90;
  const label = isPeak ? 'Ventana MÁGICA' : 'Ventana favorable';
  const styles = isPeak
    ? 'from-amber-500/25 via-purple-500/25 to-amber-500/25 border-amber-400/60'
    : 'from-purple-500/20 via-sky-500/15 to-purple-500/20 border-purple-400/50';

  return (
    <div
      className={`w-full bg-gradient-to-r ${styles} border-b text-[12px] px-3 py-1.5 flex items-center justify-between gap-2 min-h-[32px]`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <WeatherIcon id="wind" size={14} className="text-amber-300 shrink-0" />
        <span className="font-bold text-amber-200 shrink-0">{label}</span>
        <span className="text-slate-200 truncate">{magic.summary}</span>
        {magic.estimatedHours && magic.estimatedHours > 0 && (
          <span className="text-purple-300 tabular-nums shrink-0 ml-1">
            ~{magic.estimatedHours}h
          </span>
        )}
      </div>
      <button
        onClick={() => setDismissedFor(magic.detectedAt ?? null)}
        className="text-slate-400 hover:text-slate-200 text-[14px] leading-none shrink-0 px-2 py-0.5"
        aria-label="Cerrar aviso"
        title="Cerrar (vuelve a aparecer si cambia la detección)"
      >
        ×
      </button>
    </div>
  );
});
