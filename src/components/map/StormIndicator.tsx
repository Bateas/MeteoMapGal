import { memo } from 'react';
import { useLightningStore } from '../../hooks/useLightningData';
import { useLightningStatus } from '../../hooks/useLightningStatus';
import { useUIStore } from '../../store/uiStore';
import { WeatherIcon } from '../icons/WeatherIcons';

/**
 * Storm indicator on the map toolbar.
 * Shows what the lightning network measured: the level of the safety rule, or the distance of the
 * nearest strike when it is only in the region. No probability and no arrival time: the stored
 * season showed neither held up (services/lightningStatus.ts).
 * Not clickable — purely informational.
 */
export const StormIndicator = memo(function StormIndicator() {
  const isMobile = useUIStore((s) => s.isMobile);
  const stormLevel = useLightningStore((s) => s.stormAlert.level);
  const updatedAt = useLightningStore((s) => s.stormAlert.updatedAt);
  const status = useLightningStatus();

  const lastFetch = useLightningStore((s) => s.lastFetch);
  const lightningError = useLightningStore((s) => s.error);

  const hasStorm = stormLevel !== 'none';
  const ageMin = updatedAt ? Math.round((Date.now() - updatedAt.getTime()) / 60_000) : null;
  const fetchAgeMin = lastFetch ? Math.round((Date.now() - lastFetch.getTime()) / 60_000) : null;
  const isStale = fetchAgeMin !== null && fetchAgeMin >= 5;
  /** Heavy stale = beyond the worst-case "MG publish lag + 2 polls" window.
   *  Anything past this means a fetch is really stuck and the user should
   *  know the map data on screen does NOT reflect current conditions. */
  const isVeryStale = fetchAgeMin !== null && fetchAgeMin >= 7;
  /** Our server never answered since the page opened: no lightning picture at all, which is
   *  not the same as «no lightning». */
  const noData = lastFetch === null && lightningError !== null;

  // Purple with strikes at the point's rings (aviso, peligro); a quieter violet when they are
  // only somewhere within 80 km: measured, but not a warning.
  const isPurple = stormLevel === 'danger' || stormLevel === 'warning';
  const isRegion = stormLevel === 'watch';

  // Label: the safety level, or how far the nearest strike is
  const label = hasStorm && status.level !== 'none' ? status.chip
    : hasStorm ? ({ danger: 'PELIGRO', warning: 'AVISO', watch: 'RAYOS' }[stormLevel] ?? 'RAYOS')
    : 'RAYOS';

  // One fact per line: where, how many and how old, what to do, how to read the map.
  const tooltip = hasStorm
    ? [
        `${status.headline || 'Rayos en la zona'} del centro del sector`,
        status.detail,
        ageMin != null ? `Dato de hace ${ageMin} min` : '',
        status.action ?? '',
        'En el mapa: morado = núcleo con rayos; anillo amarillo = 80 km',
      ].filter(Boolean).join('\n')
    : noData
    ? 'Sin datos de rayos: el servidor no responde'
    : 'Sin rayos a menos de 80 km en los últimos 30 min';

  return (
    <div
      className={`flex items-center justify-center shrink-0
        rounded-lg font-bold tracking-wide
        transition-all duration-200
        ${isMobile ? 'gap-1 min-w-[44px] min-h-[44px] px-2.5 py-2 text-base' : 'gap-1.5 px-3 py-1.5 text-[11px]'}
        ${isPurple
          ? 'bg-purple-500/25 border border-purple-400/50 text-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.3)]'
          : isRegion
          ? 'bg-purple-500/10 border border-purple-400/30 text-purple-300/90'
          : 'bg-slate-800/60 border border-slate-600/40 text-slate-500'
        }`}
      title={tooltip}
    >
      <WeatherIcon id="zap" size={isMobile ? 18 : 14} />
      {/* Mobile: hide "RAYOS" text when no storm — just icon. Show label when active (PELIGRO/AVISO/km) */}
      {(!isMobile || label !== 'RAYOS') && (
        <span className={isMobile ? 'text-xs' : ''}>{label}</span>
      )}
      {isStale && (
        <span
          className={`text-[9px] font-mono ${isVeryStale ? 'text-red-500 font-bold animate-pulse' : 'text-amber-500'}`}
          title={lightningError ?? `Dato hace ${fetchAgeMin}min${isVeryStale ? ' — datos posiblemente desactualizados' : ''}`}
        >
          {fetchAgeMin}m
        </span>
      )}
      {noData && (
        <span className="text-[9px] font-mono text-amber-500" title={lightningError ?? undefined}>
          sin dato
        </span>
      )}
      {isPurple && (
        <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
      )}
    </div>
  );
});
