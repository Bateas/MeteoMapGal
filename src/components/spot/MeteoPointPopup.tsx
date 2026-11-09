/**
 * Card of a BETA weather point (METEO_POINTS): when it rains next, rain, wind and temperature hour by hour
 * and the official warnings of its zone. No verdict: nobody comes here to sail. V3 look; on a desktop it is
 * today's map popup, on a phone the bottom sheet the spots use.
 */
import { memo, useCallback, useEffect, useMemo, useId } from 'react';
import { Popup } from 'react-map-gl/maplibre';
import { useUserSpotStore } from '../../store/userSpotStore';
import { useUIStore } from '../../store/uiStore';
import { useSwipeToDismiss } from '../../hooks/useSwipeToDismiss';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { PopupFit } from '../map/PopupFit';
import { PointForecast } from './PointForecast';
import type { UserSpot } from '../../config/userSpots';
import '../../styles/archivoFonts.css';
import '../../styles/v3tokens.css';
import '../../styles/ficha.css';
import '../../styles/pointCard.css';

export const MeteoPointPopup = memo(function MeteoPointPopup({ spot }: { spot: UserSpot }) {
  const stations = useUserSpotStore((s) => s.scores.get(spot.id)?.wind?.contributions);
  const nearest = useMemo(() => [...(stations ?? [])].sort((a, b) => a.distKm - b.distKm)[0], [stations]);
  const selectUserSpot = useUserSpotStore((s) => s.selectUserSpot);
  const close = useCallback(() => selectUserSpot(null), [selectUserSpot]);
  const isMobile = useUIStore((s) => s.isMobile);
  const titleId = useId();
  const { sheetRef, onTouchStart, onTouchMove, onTouchEnd } = useSwipeToDismiss(close);
  // Non-modal, like the spots' sheet: tapping the map still closes it or picks something else.
  const trapRef = useFocusTrap<HTMLDivElement>(isMobile);

  // Same rules as the other cards: capture phase, and an open aria-modal dialog owns the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[aria-modal="true"]')) return;
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  const content = (
    <>
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
    </>
  );

  if (isMobile) {
    return (
      <div ref={trapRef} role="dialog" aria-labelledby={titleId} className="g-theme gf-sheetwrap animate-slide-up">
        <div ref={sheetRef} className="gf-sheetbox">
          <button type="button" onClick={close} className="gfp-close" aria-label="Cerrar">
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="gf-sheet">
            <div className="gf-handle" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
              <span />
            </div>
            <div className="gf">{content}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Popup
      longitude={spot.center[0]}
      latitude={spot.center[1]}
      anchor="bottom"
      closeOnClick={false}
      onClose={close}
      maxWidth="440px"
      className="gf-popup"
    >
      <PopupFit />
      <div className="gf gfp-body">{content}</div>
    </Popup>
  );
});
