/**
 * Toast notification container — renders stacked toasts at bottom-right (desktop)
 * or bottom-center (mobile). Paper and ink; only the icon carries the severity.
 */
import type { CSSProperties } from 'react';
import { useToastStore, type ToastSeverity } from '../../store/toastStore';
import { WeatherIcon, type IconId } from '../icons/WeatherIcons';

const SEVERITY: Record<ToastSeverity, { icon: IconId; tone: string }> = {
  info: { icon: 'info', tone: 'var(--g-l-riesgo)' },
  success: { icon: 'check-circle', tone: 'var(--g-s-navegable)' },
  warning: { icon: 'alert-triangle', tone: 'var(--g-l-alto)' },
  error: { icon: 'x-circle', tone: 'var(--g-danger)' },
};

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    // Above the mobile bottom nav (48 px): at bottom-4 a toast sat on the nav and took its taps.
    <div className="fixed bottom-16 md:bottom-4 right-4 left-4 md:left-auto md:w-80 z-50 flex flex-col gap-2 pointer-events-none"
         role="status"
         aria-live="polite"
         style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {toasts.map((toast) => {
        const severity = SEVERITY[toast.severity];
        return (
          <div
            key={toast.id}
            className="g-theme gc-toast animate-slide-up"
            style={{ '--tone': severity.tone } as CSSProperties}
          >
            <span><WeatherIcon id={severity.icon} size={16} /></span>
            <span>{toast.message}</span>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              className="gc-btn gc-btn--plain gc-btn--icon"
              aria-label="Cerrar"
            >
              <WeatherIcon id="x" size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
