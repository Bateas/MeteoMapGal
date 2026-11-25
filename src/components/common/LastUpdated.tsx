import { useWeatherStore } from '../../store/weatherStore';

/** Compact time label for mobile: "1m", "5m", "12m" instead of "hace menos de un minuto" */
function compactAge(date: Date): string {
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return `${hours}h`;
}

/** Desktop label: short on purpose, «hace menos de un minuto» overflowed the header below 1100 px */
function shortAge(date: Date): string {
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  return `hace ${Math.round(mins / 60)} h`;
}

interface LastUpdatedProps {
  onRefresh: () => void;
  /** When true, shows the compact mobile layout (age + refresh icon) */
  compact?: boolean;
}

/** How old the data on screen is, and the button to ask for it again. */
export function LastUpdated({ onRefresh, compact = false }: LastUpdatedProps) {
  const lastFetchTime = useWeatherStore((s) => s.lastFetchTime);
  const isLoading = useWeatherStore((s) => s.isLoading);
  const isUsingCachedData = useWeatherStore((s) => s.isUsingCachedData);

  let age: string;
  if (isLoading) age = compact ? '...' : 'Actualizando';
  else if (!lastFetchTime) age = compact ? '' : 'Sin datos';
  else if (compact) age = compactAge(lastFetchTime);
  else age = shortAge(lastFetchTime);

  const cached = !isLoading && isUsingCachedData && lastFetchTime !== null;

  return (
    <div className="gc-header-group">
      {/* No per-source dots on a phone: they can only be read by hovering, which touch cannot do.
          A failing source is announced by SourceStatusBanner instead. */}
      <span
        className="gc-age"
        data-state={cached ? 'cached' : undefined}
        title={cached ? 'Datos guardados: la última actualización falló' : 'Última actualización'}
        aria-live={compact ? undefined : 'polite'}
      >
        {cached && !compact ? 'Guardado, ' : ''}{age}
      </span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={isLoading}
        className="gc-btn gc-btn--plain gc-btn--icon"
        aria-label={isLoading ? 'Actualizando datos...' : 'Refrescar datos'}
        aria-busy={isLoading}
        title="Refrescar datos (R)"
      >
        <svg className={isLoading ? 'animate-spin' : undefined} width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>
    </div>
  );
}
