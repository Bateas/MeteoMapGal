/**
 * Toast notification container — renders stacked toasts at bottom-right (desktop)
 * or bottom-center (mobile).
 */
import type { ReactNode } from 'react';
import { useToastStore, type ToastSeverity } from '../../store/toastStore';
import { WeatherIcon } from '../icons/WeatherIcons';

const SEVERITY_STYLES: Record<ToastSeverity, { bg: string; border: string; text: string; icon: ReactNode }> = {
  info:    { bg: 'bg-blue-900/90',   border: 'border-blue-700', text: 'text-blue-200',   icon: <WeatherIcon id="info" size={14} /> },
  success: { bg: 'bg-green-900/90',  border: 'border-green-700', text: 'text-green-200',  icon: <WeatherIcon id="check-circle" size={14} /> },
  warning: { bg: 'bg-amber-900/90',  border: 'border-amber-700', text: 'text-amber-200',  icon: <WeatherIcon id="alert-triangle" size={14} /> },
  error:   { bg: 'bg-red-900/90',    border: 'border-red-700',   text: 'text-red-200',    icon: <WeatherIcon id="x-circle" size={14} /> },
};

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 left-4 md:left-auto md:w-80 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => {
        const style = SEVERITY_STYLES[toast.severity];
        return (
          <div
            key={toast.id}
            className={`
              ${style.bg} ${style.border} ${style.text}
              border rounded-lg px-3 py-2 shadow-lg backdrop-blur-sm
              flex items-start gap-2 pointer-events-auto
              animate-slide-up
            `}
          >
            <span className="flex-shrink-0 mt-0.5">{style.icon}</span>
            <span className="text-xs font-medium flex-1">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-xs opacity-60 hover:opacity-100 flex-shrink-0 ml-1"
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
