import { useWeatherStore } from '../../store/weatherStore';
import type { WeatherSource, SourceStatus } from '../../store/weatherStore';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

const SOURCE_LABELS: Record<WeatherSource, string> = {
  aemet: 'AEMET',
  meteogalicia: 'MG',
  meteoclimatic: 'MC',
  wunderground: 'WU',
  netatmo: 'NT',
};

const STALE_MS = 20 * 60 * 1000; // 20 min → stale

function dotColor(status: SourceStatus | undefined): string {
  if (!status || !status.lastSuccess) return '#6b7280'; // gray — never fetched
  const age = Date.now() - status.lastSuccess.getTime();
  if (status.lastError && status.lastError > status.lastSuccess) return '#ef4444'; // red — last attempt failed
  if (age > STALE_MS) return '#eab308'; // yellow — stale
  return '#22c55e'; // green — fresh
}

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
  /** When true, shows compact mobile layout (just dots + refresh icon) */
  compact?: boolean;
}

export function LastUpdated({ onRefresh, compact = false }: LastUpdatedProps) {
  const lastFetchTime = useWeatherStore((s) => s.lastFetchTime);
  const isLoading = useWeatherStore((s) => s.isLoading);
  const sourceFreshness = useWeatherStore((s) => s.sourceFreshness);
  const isUsingCachedData = useWeatherStore((s) => s.isUsingCachedData);

  if (compact) {
    // Mobile: compact layout — age badge + dots + refresh icon button
    return (
      <div className="flex items-center gap-1.5">
        {/* Age badge + cached indicator */}
        {isLoading ? (
          <span className="text-[10px] text-blue-400 animate-pulse">...</span>
        ) : isUsingCachedData && lastFetchTime ? (
          <span className="text-[10px] text-amber-400 font-mono" title="Datos en caché">⚡{compactAge(lastFetchTime)}</span>
        ) : lastFetchTime ? (
          <span className="text-[10px] text-slate-500 font-mono">{compactAge(lastFetchTime)}</span>
        ) : null}
        {/* Source dots */}
        <div className="flex items-center gap-0.5">
          {(Object.keys(SOURCE_LABELS) as WeatherSource[]).map((src) => {
            const status = sourceFreshness.get(src);
            const color = dotColor(status);
            const count = status?.readingCount ?? 0;
            const title = `${SOURCE_LABELS[src]}: ${count} est.`;
            return (
              <span
                key={src}
                title={title}
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: color }}
              />
            );
          })}
        </div>
        {/* Refresh button — icon only, 44px touch target */}
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="p-2 -m-0.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 active:bg-slate-700 disabled:opacity-50 transition-colors"
          aria-label="Refrescar datos"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
    );
  }

  // Desktop: full layout — no source dots (SourceStatusIndicator already shows them in Header)
  return (
    <div className="flex items-center gap-2 text-xs text-slate-400">
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
        className="px-2 py-0.5 rounded text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 disabled:opacity-50 transition-colors"
      >
        Refrescar
      </button>
    </div>
  );
}
