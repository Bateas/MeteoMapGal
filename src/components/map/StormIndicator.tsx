import { memo } from 'react';
import { useLightningStore } from '../../hooks/useLightningData';
import { useStormPrediction } from '../../hooks/useStormPrediction';
import { useUIStore } from '../../store/uiStore';
import { WeatherIcon } from '../icons/WeatherIcons';

/**
 * Storm indicator on the map toolbar.
 * Shows lightning activity level + storm prediction probability.
 * Not clickable — purely informational.
 */
export const StormIndicator = memo(function StormIndicator() {
  const isMobile = useUIStore((s) => s.isMobile);
  const stormLevel = useLightningStore((s) => s.stormAlert.level);
  const updatedAt = useLightningStore((s) => s.stormAlert.updatedAt);
  const prediction = useStormPrediction();

  const lastFetch = useLightningStore((s) => s.lastFetch);
  const lightningError = useLightningStore((s) => s.error);

  const hasStorm = stormLevel !== 'none';
  const hasPrediction = prediction.probability >= 25;
  const isActive = hasStorm || hasPrediction;
  const ageMin = updatedAt ? Math.round((Date.now() - updatedAt.getTime()) / 60_000) : null;
  const fetchAgeMin = lastFetch ? Math.round((Date.now() - lastFetch.getTime()) / 60_000) : null;
  const isStale = fetchAgeMin !== null && fetchAgeMin >= 5;

  // Color: purple for lightning, amber for prediction-only
  const isPurple = hasStorm;
  const isAmber = !hasStorm && hasPrediction;

  // Label: lightning level or prediction horizon
  const label = hasStorm
    ? { danger: 'PELIGRO', warning: 'AVISO', watch: 'VIGIL.' }[stormLevel] ?? stormLevel.toUpperCase()
    : hasPrediction
    ? prediction.horizon === 'imminent' ? 'INMIN.'
    : prediction.horizon === 'likely' ? 'PROB.'
    : `${prediction.probability}%`
    : 'RAYOS';

  // Tooltip
  const tooltip = hasStorm
    ? `Actividad eléctrica (${{ danger: 'peligro', warning: 'aviso', watch: 'vigilancia' }[stormLevel] ?? stormLevel})${ageMin != null ? ` · dato hace ${ageMin}min` : ''}${prediction.probability > 0 ? ` · predicción ${prediction.probability}%` : ''}`
    : hasPrediction
    ? `Predicción tormenta: ${prediction.probability}% · ${prediction.summary}`
    : 'Sin actividad eléctrica';

  return (
    <div
      className={`flex items-center justify-center shrink-0
        rounded-lg font-bold tracking-wide
        transition-all duration-200
        ${isMobile ? 'gap-1 min-w-[44px] min-h-[44px] px-2.5 py-2 text-base' : 'gap-1.5 px-3 py-1.5 text-[11px]'}
        ${isPurple
          ? 'bg-purple-500/25 border border-purple-400/50 text-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.3)]'
          : isAmber
          ? 'bg-amber-500/20 border border-amber-400/40 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.2)]'
          : 'bg-slate-800/60 border border-slate-600/40 text-slate-500'
        }`}
      title={tooltip}
    >
      <WeatherIcon id="zap" size={isMobile ? 18 : 14} />
      <span className={isMobile ? 'text-xs' : ''}>{label}</span>
      {isStale && (
        <span className="text-[9px] text-amber-500 font-mono" title={lightningError ?? `Dato hace ${fetchAgeMin}min`}>
          {fetchAgeMin}m
        </span>
      )}
      {hasPrediction && !hasStorm && (
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
      )}
      {hasStorm && (
        <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
      )}
    </div>
  );
});
