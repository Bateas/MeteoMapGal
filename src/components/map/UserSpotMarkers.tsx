/**
 * Markers for user-created "chincheta" spots.
 *
 * Visually DISTINCT from official spots (dashed violet ring + pin icon +
 * "SIN CALIBRAR" tag) and rendered BELOW them (lower z-index) — the curated
 * official spots stay the protagonists; user pins are clearly secondary and
 * marked as uncalibrated estimates.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Marker, useMap } from 'react-map-gl/maplibre';
import { makeMarkerButton } from './markerA11y';
import { useUserSpotStore } from '../../store/userSpotStore';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { WeatherIcon } from '../icons/WeatherIcons';
import { displayVerdict, displayWindKt, verdictLabel, VERDICT_MAP_LABEL } from '../../config/verdictStyles';
import { withMeteoPoints } from '../../config/userSpots';
import type { SpotVerdict } from '../../services/spotScoringEngine';
import { useMapInk } from '../../hooks/useMapInk';

/** Ink for ALL user pins, dashed: an own pin says no state, and the violet they had was the colour of «fuerte». */
const PIN_ACCENT = 'var(--g-ink)';

/** Words on a pin: one size on screen whatever the zoom (the marker itself is scaled down when the map is far). */
const PIN_TEXT_PX = 12;

export const UserSpotMarkers = memo(function UserSpotMarkers() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const userSpots = useUserSpotStore((s) => s.userSpots);
  const scores = useUserSpotStore((s) => s.scores);
  const selectedId = useUserSpotStore((s) => s.selectedUserSpotId);
  const selectUserSpot = useUserSpotStore((s) => s.selectUserSpot);
  const ink = useMapInk();

  const mine = useMemo(() => withMeteoPoints(userSpots).filter((u) => u.sectorId === sectorId), [userSpots, sectorId]);

  // Zoom-based scaling — shrink at low zoom to avoid clutter (mirror SpotMarker).
  const { current: mapRef } = useMap();
  const [zoomScale, setZoomScale] = useState(1);
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    const onZoom = () => {
      const z = map.getZoom();
      setZoomScale(z >= 11 ? 1 : z >= 10 ? 0.85 : z >= 9 ? 0.7 : 0.55);
    };
    onZoom();
    map.on('zoom', onZoom);
    return () => { map.off('zoom', onZoom); };
  }, [mapRef]);

  const handleSelect = useCallback((id: string) => {
    // Mutual exclusion: opening a user-spot popup closes any official spot popup.
    useSpotStore.getState().selectSpot('');
    selectUserSpot(id);
  }, [selectUserSpot]);

  if (mine.length === 0) return null;

  return (
    <>
      {mine.map((us) => {
        const score = scores.get(us.id);
        // Same gate as the official markers: a pin the user dropped himself
        // must not claim a verdict the engine has not finished computing.
        const verdict: SpotVerdict = displayVerdict(score);
        const windKt = displayWindKt(score);
        const isActive = us.id === selectedId;
        // The local map renders 'unknown' as a dash, which reads as "no data"
        // rather than "not finished yet" — so while the score is provisional the
        // shared label speaks instead, the same wording every other surface uses.
        const label = score?.provisional ? verdictLabel(score) : VERDICT_MAP_LABEL[verdict];
        const badge = windKt !== null && verdict !== 'calm' && verdict !== 'unknown'
          ? `${label} ${windKt.toFixed(0)}kt`
          : label;
        const size = isActive ? 38 : 32;

        return (
          <Marker
            key={us.id}
            // Keyboard button with a real name (see markerA11y). Inline callback
            // ref because hooks can't go in this loop; makeMarkerButton is
            // idempotent, so re-applying it on each render never stacks listeners.
            ref={(mk) => makeMarkerButton(mk, us.meteoOnly ? `${us.name} (BETA)` : `${us.name} (sin calibrar): ${badge}`, () => handleSelect(us.id))}
            longitude={us.center[0]}
            latitude={us.center[1]}
            anchor="center"
            onClick={(e) => { e.originalEvent.stopPropagation(); handleSelect(us.id); }}
            style={{ zIndex: isActive ? 27 : 25 }}
          >
            <div
              className="relative cursor-pointer flex flex-col items-center"
              title={us.meteoOnly ? `${us.name} (BETA)` : `${us.name} (sin calibrar)`}
              style={{ transform: `scale(${zoomScale})`, transformOrigin: 'center' }}
            >
              {/* Verdict badge: a weather point has no verdict to give */}
              {!us.meteoOnly && (
                <div
                  className="pointer-events-none whitespace-nowrap font-bold mb-0.5"
                  style={{
                    fontSize: PIN_TEXT_PX / zoomScale,
                    fontFamily: 'var(--g-narrow)',
                    padding: '2px 6px',
                    borderRadius: 3,
                    background: 'var(--g-bg)',
                    border: '1px dashed var(--g-rule)',
                    color: 'var(--g-ink)',
                  }}
                >
                  {badge}
                </div>
              )}

              {/* Dashed pin — clearly distinct from the solid hexagon spots */}
              <div
                className="rounded-full flex items-center justify-center"
                style={{
                  width: size,
                  height: size,
                  background: 'var(--g-bg)',
                  border: `2px dashed ${PIN_ACCENT}`,
                }}
              >
                <span style={{ color: PIN_ACCENT, display: 'flex' }}>
                  <WeatherIcon id="map-pin" size={isActive ? 18 : 15} />
                </span>
              </div>

              {/* Name + uncalibrated tag */}
              <div className="pointer-events-none whitespace-nowrap text-center mt-0.5">
                <div className="font-bold" style={{ fontSize: PIN_TEXT_PX / zoomScale, color: ink.text, textShadow: ink.shadow }}>
                  {us.name}
                </div>
                <div
                  className="font-bold mx-auto inline-block rounded"
                  style={{ fontSize: PIN_TEXT_PX / zoomScale, padding: '0 4px', color: 'var(--g-bg)', background: 'var(--g-ink)' }}
                >
                  {us.meteoOnly ? 'BETA' : 'SIN CALIBRAR'}
                </div>
              </div>
            </div>
          </Marker>
        );
      })}
    </>
  );
});
