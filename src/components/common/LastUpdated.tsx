import { useWeatherStore } from '../../store/weatherStore';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface LastUpdatedProps {
  onRefresh: () => void;
}

export function LastUpdated({ onRefresh }: LastUpdatedProps) {
  const lastFetchTime = useWeatherStore((s) => s.lastFetchTime);
  const isLoading = useWeatherStore((s) => s.isLoading);

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
