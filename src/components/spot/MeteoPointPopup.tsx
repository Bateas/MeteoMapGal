/**
 * Card of a BETA weather point (METEO_POINTS): when it rains next, rain, wind and temperature hour by hour
 * and the official warnings of its zone. No verdict: nobody comes here to sail. It opens in the same shell
 * as every other card of the map (Ficha): docked panel on a desktop, bottom sheet on a phone.
 */
import { memo, useCallback, useMemo, useId } from 'react';
import { Ficha } from '../map/Ficha';
import { useUserSpotStore } from '../../store/userSpotStore';
import { PointForecast } from './PointForecast';
import type { UserSpot } from '../../config/userSpots';
import '../../styles/pointCard.css';

export const MeteoPointPopup = memo(function MeteoPointPopup({ spot }: { spot: UserSpot }) {
  const stations = useUserSpotStore((s) => s.scores.get(spot.id)?.wind?.contributions);
  const nearest = useMemo(() => [...(stations ?? [])].sort((a, b) => a.distKm - b.distKm)[0], [stations]);
  const selectUserSpot = useUserSpotStore((s) => s.selectUserSpot);
  const close = useCallback(() => selectUserSpot(null), [selectUserSpot]);
  const titleId = useId();

  return (
    <Ficha longitude={spot.center[0]} latitude={spot.center[1]} onClose={close} titleId={titleId}>
      <div className="gf-head">
        <div className="gf-titles">
          <h2 id={titleId} className="gf-name">{spot.name}</h2>
          <div className="gf-sub">Punto meteorológico</div>
        </div>
      </div>

      <PointForecast pointId={spot.id} lat={spot.center[1]} lon={spot.center[0]} zones={spot.warningZones ?? []} gaugeIds={spot.gauges?.map((g) => g.id)} />

      {nearest && (
        <p className="gf-sub gfp-now">
          Ahora en {nearest.name} ({nearest.distKm.toFixed(1).replace('.', ',')} km): {Math.round(nearest.speedKt)} kt{nearest.dir ? ` ${nearest.dir}` : ''}
        </p>
      )}

      <p className="gf-credit">
        <span className="gf-tag">BETA</span>
        La hora de cada chubasco puede sufrir variaciones.
      </p>
    </Ficha>
  );
});
