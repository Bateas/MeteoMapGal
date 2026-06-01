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
import { useUserSpotStore } from '../../store/userSpotStore';
import { useSpotStore } from '../../store/spotStore';
import { useSectorStore } from '../../store/sectorStore';
import { WeatherIcon } from '../icons/WeatherIcons';
import type { SpotVerdict } from '../../services/spotScoringEngine';

const VERDICT_LABEL: Record<SpotVerdict, string> = {
  calm: 'CALMA', light: 'FLOJO', sailing: 'NAVEG.', good: 'BUENO', strong: 'FUERTE', unknown: '—',
};
const VERDICT_TEXT: Record<SpotVerdict, string> = {
  calm: '#94a3b8', light: '#7dd3fc', sailing: '#4ade80', good: '#fde047', strong: '#fdba74', unknown: '#94a3b8',
};

/** Distinct accent for ALL user pins — signals "experimental / uncalibrated". */
const PIN_ACCENT = '#a78bfa'; // violet-400

export const UserSpotMarkers = memo(function UserSpotMarkers() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const userSpots = useUserSpotStore((s) => s.userSpots);
  const scores = useUserSpotStore((s) => s.scores);
  const selectedId = useUserSpotStore((s) => s.selectedUserSpotId);
  const selectUserSpot = useUserSpotStore((s) => s.selectUserSpot);

  const mine = useMemo(() => userSpots.filter((u) => u.sectorId === sectorId), [userSpots, sectorId]);

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
        const verdict: SpotVerdict = score?.verdict ?? 'unknown';
        const windKt = score?.effectiveWindKt ?? score?.wind?.avgSpeedKt ?? null;
        const isActive = us.id === selectedId;
        const textColor = VERDICT_TEXT[verdict];
        const badge = windKt !== null && verdict !== 'calm' && verdict !== 'unknown'
          ? `${VERDICT_LABEL[verdict]} ${windKt.toFixed(0)}kt`
          : VERDICT_LABEL[verdict];
        const size = isActive ? 38 : 32;

        return (
          <Marker
            key={us.id}
            longitude={us.center[0]}
            latitude={us.center[1]}
            anchor="center"
            onClick={(e) => { e.originalEvent.stopPropagation(); handleSelect(us.id); }}
            style={{ zIndex: isActive ? 7 : 5 }}
          >
            <div
              className="relative cursor-pointer flex flex-col items-center"
              title={`${us.name} (sin calibrar)`}
              style={{ transform: `scale(${zoomScale})`, transformOrigin: 'center' }}
            >
              {/* Verdict badge */}
              <div
                className="pointer-events-none whitespace-nowrap font-bold mb-0.5"
                style={{
                  fontSize: 10,
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  padding: '2px 6px',
                  borderRadius: 5,
                  background: 'rgba(15, 23, 42, 0.9)',
                  border: `1px dashed ${PIN_ACCENT}aa`,
                  color: textColor,
                }}
              >
                {badge}
              </div>

              {/* Dashed pin — clearly distinct from the solid hexagon spots */}
              <div
                className="rounded-full flex items-center justify-center"
                style={{
                  width: size,
                  height: size,
                  background: 'rgba(15, 23, 42, 0.82)',
                  border: `2px dashed ${PIN_ACCENT}`,
                  boxShadow: isActive ? `0 0 10px ${PIN_ACCENT}88` : `0 0 5px ${PIN_ACCENT}44`,
                }}
              >
                <span style={{ color: PIN_ACCENT, display: 'flex' }}>
                  <WeatherIcon id="map-pin" size={isActive ? 18 : 15} />
                </span>
              </div>

              {/* Name + uncalibrated tag */}
              <div className="pointer-events-none whitespace-nowrap text-center mt-0.5">
                <div className="text-[10px] font-bold" style={{ color: PIN_ACCENT, textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}>
                  {us.name}
                </div>
                <div
                  className="text-[8px] font-bold tracking-wider mx-auto inline-block px-1 rounded"
                  style={{ color: '#ddd6fe', background: 'rgba(124, 58, 237, 0.25)', border: '1px solid rgba(167,139,250,0.4)' }}
                >
                  SIN CALIBRAR
                </div>
              </div>
            </div>
          </Marker>
        );
      })}
    </>
  );
});
