import { useWeatherStore } from '../../store/weatherStore';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { Database } from 'lucide-react';

/** Compact time label for mobile: "1m", "5m", "12m" instead of "hace menos de un minuto" */
function compactAge(date: Date): string {
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return `${hours}h`;
}

interface LastUpdatedProps {
  onRefresh: () => void;
  /** When true, shows the compact mobile layout (age + refresh icon) */
  compact?: boolean;
}

export function LastUpdated({ onRefresh, compact = false }: LastUpdatedProps) {
  const lastFetchTime = useWeatherStore((s) => s.lastFetchTime);
  const isLoading = useWeatherStore((s) => s.isLoading);
  const isUsingCachedData = useWeatherStore((s) => s.isUsingCachedData);

  if (compact) {
    // Mobile: compact layout — age badge + dots + refresh icon button
    return (
      <div className="flex items-center gap-1.5">
        {/* Age badge + cached indicator */}
        {isLoading ? (
          <span className="text-[11px] text-blue-400 animate-pulse">...</span>
        ) : isUsingCachedData && lastFetchTime ? (
          <span className="inline-flex items-center gap-0.5 text-[11px] text-amber-400 font-mono" title="Datos en caché">
            <Database size={10} aria-hidden="true" />
            {compactAge(lastFetchTime)}
          </span>
        ) : lastFetchTime ? (
          <span className="text-[11px] text-slate-500 font-mono">{compactAge(lastFetchTime)}</span>
        ) : null}
        {/* No per-source dots here: on a phone they can only be read by hovering, which touch
            cannot do, and they cost the width the 44 px refresh target needs. A failing source
            is announced by SourceStatusBanner instead. */}
        {/* Refresh button — icon only, 44px touch target */}
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="p-2 -m-0.5 min-h-11 min-w-11 flex items-center justify-center rounded-lg border border-slate-700/50 bg-slate-900/80 text-slate-400 hover:text-white hover:bg-slate-800/90 hover:shadow-[0_0_12px_rgba(148,163,184,0.15)] hover:border-slate-500/40 active:bg-slate-700 disabled:opacity-50 transition-all"
          aria-label={isLoading ? 'Actualizando datos...' : 'Refrescar datos'}
          aria-busy={isLoading}
        >
          <svg className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
    );
  }

  // Desktop: full layout — no source dots (SourceStatusIndicator already shows them in Header)
  return (
    <div className="flex items-center gap-2 text-xs text-slate-400" aria-live="polite" aria-atomic="true">
      {isLoading ? (
        <span className="text-blue-400">Actualizando...</span>
      ) : isUsingCachedData && lastFetchTime ? (
        <span className="text-amber-400">
          Caché — {formatDistanceToNow(lastFetchTime, { addSuffix: true, locale: es })}
        </span>
      ) : lastFetchTime ? (
        <span>
          Actualizado{' '}
          {formatDistanceToNow(lastFetchTime, { addSuffix: true, locale: es })}
        </span>
      ) : (
        <span>Sin datos</span>
      )}
      <button
        onClick={onRefresh}
        disabled={isLoading}
        className="px-2 py-0.5 rounded text-[13px] border border-slate-600/50 bg-slate-700 text-slate-300 hover:bg-slate-600 hover:shadow-[0_0_10px_rgba(148,163,184,0.12)] hover:border-slate-500/40 disabled:opacity-50 transition-all min-h-[44px] min-w-[44px] flex items-center justify-center gap-1.5"
        aria-busy={isLoading}
      >
        {isLoading ? (
          <>
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Actualizando...
          </>
        ) : (
          'Refrescar'
        )}
      </button>
    </div>
  );
}
