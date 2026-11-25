/**
 * Says when the lightning picture on the map cannot be trusted: nothing since the page opened, or a last good
 * answer that is too old. Silent otherwise. Without it, no strikes on the map would read as no storm.
 */
import { memo } from 'react';
import { useLightningStore } from '../../hooks/useLightningData';
import { WeatherIcon } from '../icons/WeatherIcons';

/** Beyond the publication lag of the source plus two polls: a fetch that is really stuck. */
const STALE_MIN = 7;

export const LightningDataChip = memo(function LightningDataChip() {
  const lastFetch = useLightningStore((s) => s.lastFetch);
  const error = useLightningStore((s) => s.error);

  const noData = lastFetch === null && error !== null;
  const ageMin = lastFetch ? Math.round((Date.now() - lastFetch.getTime()) / 60_000) : null;
  if (!noData && (ageMin === null || ageMin < STALE_MIN)) return null;

  return (
    <span className="g-theme gc-chip" role="status" title={error ?? undefined}>
      <WeatherIcon id="zap" size={14} />
      {noData ? 'Rayos: sin dato' : `Rayos: dato de hace ${ageMin} min`}
    </span>
  );
});
