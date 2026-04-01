import { memo } from 'react';
import { useWeatherStore, type WeatherSource } from '../../store/weatherStore';
import { isAemetRateLimited, aemetCooldownRemaining } from '../../api/aemetClient';

const SOURCE_LABELS: Record<WeatherSource, string> = {
  aemet: 'A',
  meteogalicia: 'MG',
  meteoclimatic: 'MC',
  wunderground: 'WU',
  netatmo: 'NT',
  skyx: 'SX',
};

const SOURCE_ORDER: WeatherSource[] = ['aemet', 'meteogalicia', 'meteoclimatic', 'wunderground', 'netatmo', 'skyx'];

function formatAge(date: Date | null): string {
  if (!date) return 'Sin datos';
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `${mins}min`;
  return `${Math.round(mins / 60)}h`;
}

export const SourceStatusIndicator = memo(function SourceStatusIndicator() {
  const sourceFreshness = useWeatherStore((s) => s.sourceFreshness);

  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Filtro por fuente de datos">
      {SOURCE_ORDER.map((source) => {
        const status = sourceFreshness.get(source);
        const hasData = status && status.readingCount > 0;
        const hasError = status?.lastError && (!status.lastSuccess || status.lastError > status.lastSuccess);
        const isStale = status?.lastSuccess &&
          (Date.now() - status.lastSuccess.getTime()) > 30 * 60 * 1000; // >30 min

        let color: string;
        let bgColor: string;
        let title: string;

        // Distinguish AEMET rate-limit cooldown from generic errors
        const isRateLimited = source === 'aemet' && isAemetRateLimited();

        if (!status || (!status.lastSuccess && !status.lastError)) {
          color = 'text-slate-600';
          bgColor = 'bg-slate-800/50';
          title = `${source}: Esperando...`;
        } else if (isRateLimited) {
          color = 'text-amber-400 animate-pulse';
          bgColor = 'bg-amber-950/30';
          title = `AEMET: Rate-limited (${aemetCooldownRemaining()}s restantes)`;
        } else if (hasError && !hasData) {
          color = 'text-red-400';
          bgColor = 'bg-red-950/40';
          title = `${source}: Error — ${status.errorMessage || 'Sin conexión'}`;
        } else if (isStale) {
          color = 'text-amber-400';
          bgColor = 'bg-amber-950/30';
          title = `${source}: Datos antiguos (${formatAge(status.lastSuccess)}) — ${status.readingCount} est.`;
        } else if (hasData) {
          color = 'text-emerald-400';
          bgColor = 'bg-emerald-950/30';
          title = `${source}: OK (${formatAge(status.lastSuccess)}) — ${status.readingCount} est.`;
        } else {
          color = 'text-slate-500';
          bgColor = 'bg-slate-800/50';
          title = `${source}: Sin estaciones`;
        }

        return (
          <span
            key={source}
            className={`inline-flex items-center justify-center px-1 py-0.5 rounded text-[11px] font-bold ${color} ${bgColor} cursor-default`}
            title={title}
            aria-label={title}
          >
            {SOURCE_LABELS[source]}
          </span>
        );
      })}
    </div>
  );
});
