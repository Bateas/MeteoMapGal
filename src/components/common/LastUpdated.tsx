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

interface LastUpdatedProps {
  onRefresh: () => void;
}

export function LastUpdated({ onRefresh }: LastUpdatedProps) {
  const lastFetchTime = useWeatherStore((s) => s.lastFetchTime);
  const isLoading = useWeatherStore((s) => s.isLoading);
  const sourceFreshness = useWeatherStore((s) => s.sourceFreshness);

  return (
    <div className="flex items-center gap-2 text-xs text-slate-400">
      {isLoading ? (
        <span className="text-blue-400">Actualizando...</span>
      ) : lastFetchTime ? (
        <span>
          Actualizado{' '}
          {formatDistanceToNow(lastFetchTime, { addSuffix: true, locale: es })}
        </span>
      ) : (
        <span>Sin datos</span>
      )}
      {/* Per-source freshness dots */}
      <div className="flex items-center gap-1">
        {(Object.keys(SOURCE_LABELS) as WeatherSource[]).map((src) => {
          const status = sourceFreshness.get(src);
          const color = dotColor(status);
          const count = status?.readingCount ?? 0;
          const title = `${SOURCE_LABELS[src]}: ${count} est.${status?.lastError && (!status.lastSuccess || status.lastError > status.lastSuccess) ? ' (error)' : ''}`;
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
