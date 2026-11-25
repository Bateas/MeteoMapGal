/**
 * Distance measurement tool — click two points on the map to measure distance.
 *
 * Displays distance in nautical miles (nm) and kilometers.
 * Uses Haversine formula for accuracy.
 * Toggle via button in the map toolbar.
 *
 * UX: Click point A → click point B → shows line + distance label.
 * Click again to start new measurement. Press Escape or toggle off to cancel.
 */
import { WeatherIcon } from '../icons/WeatherIcons';
import { useState, useEffect, memo, useRef } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { Source, Layer, Marker } from 'react-map-gl/maplibre';
import type { LineLayerSpecification } from 'maplibre-gl';
import { useUIStore } from '../../store/uiStore';
import { useSectorStore } from '../../store/sectorStore';
import { haversineDistance } from '../../services/geoUtils';
import { degreesToCardinal } from '../../services/windUtils';

interface DistanceToolProps {
  mapRef: React.RefObject<MapRef | null>;
  isActive: boolean;
  onDeactivate: () => void;
}

interface Point {
  lng: number;
  lat: number;
}

/** Bearing from A to B in degrees (0-360) */
function bearing(a: Point, b: Point): number {
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

const oneDecimal = (n: number) => n.toFixed(1).replace('.', ',');

const lineLayer: LineLayerSpecification = {
  id: 'distance-line',
  type: 'line',
  source: 'distance-line',
  paint: {
    'line-color': '#f59e0b',
    'line-width': 2.5,
    'line-dasharray': [4, 3],
  },
};

export const DistanceTool = memo(function DistanceTool({ mapRef, isActive, onDeactivate }: DistanceToolProps) {
  const isMobile = useUIStore((s) => s.isMobile);
  const [pointA, setPointA] = useState<Point | null>(null);
  const [pointB, setPointB] = useState<Point | null>(null);
  const clickPhaseRef = useRef<'A' | 'B' | 'done'>('A');

  // A change of sector ends the measure: its points are in the other sector, off the map (P3 review, 19-nov)
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const sectorRef = useRef(sectorId);
  useEffect(() => {
    if (sectorId === sectorRef.current) return;
    sectorRef.current = sectorId;
    if (isActive) onDeactivate();
  }, [sectorId, isActive, onDeactivate]);

  // Reset on deactivate
  useEffect(() => {
    if (!isActive) {
      setPointA(null);
      setPointB(null);
      clickPhaseRef.current = 'A';
    }
  }, [isActive]);

  // Change cursor when active
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (isActive) {
      map.getCanvas().style.cursor = 'crosshair';
      return () => { map.getCanvas().style.cursor = ''; };
    }
  }, [isActive, mapRef]);

  // Escape key to cancel
  useEffect(() => {
    if (!isActive) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDeactivate();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isActive, onDeactivate]);

  // Map click handler
  useEffect(() => {
    if (!isActive) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const pt: Point = { lng: e.lngLat.lng, lat: e.lngLat.lat };

      if (clickPhaseRef.current === 'A') {
        setPointA(pt);
        setPointB(null);
        clickPhaseRef.current = 'B';
      } else if (clickPhaseRef.current === 'B') {
        setPointB(pt);
        clickPhaseRef.current = 'done';
      } else {
        // Reset — start new measurement
        setPointA(pt);
        setPointB(null);
        clickPhaseRef.current = 'B';
      }
    };

    map.on('click', handleClick);
    return () => { map.off('click', handleClick); };
  }, [isActive, mapRef]);

  if (!isActive) return null;

  const hasLine = pointA && pointB;
  const distKm = hasLine ? haversineDistance(pointA.lat, pointA.lng, pointB.lat, pointB.lng) : 0;
  const distNm = distKm / 1.852;
  const brg = hasLine ? bearing(pointA, pointB) : 0;
  const midLat = hasLine ? (pointA.lat + pointB.lat) / 2 : 0;
  const midLng = hasLine ? (pointA.lng + pointB.lng) / 2 : 0;

  const lineGeoJSON = hasLine ? {
    type: 'Feature' as const,
    geometry: {
      type: 'LineString' as const,
      coordinates: [[pointA.lng, pointA.lat], [pointB.lng, pointB.lat]],
    },
    properties: {},
  } : null;

  const cardinal = hasLine ? degreesToCardinal(brg) : '';

  return (
    <>
      {/* Instruction banner */}
      {!hasLine && (
        // Phone: under AppShell's top-of-map column (--map-top + its height),
        // not at a fixed distance from the top of the screen, where it covered
        // the official warnings.
        <div
          className={`g-theme gc-hint fixed ${isMobile ? '' : 'top-16 '}left-1/2 -translate-x-1/2 z-40`}
          style={isMobile ? { top: 'calc(var(--map-top, 4rem) + var(--map-stack-h, 0px) + 0.875rem)' } : undefined}
        >
          <span>{clickPhaseRef.current === 'A' ? 'Toca el punto de inicio' : 'Toca el punto final'}</span>
          <button type="button" onClick={onDeactivate} className="gc-btn gc-btn--plain gc-btn--icon" style={{ minHeight: 28, width: 28 }} aria-label="Cerrar herramienta de medición">
            <WeatherIcon id="x" size={14} />
          </button>
        </div>
      )}

      {/* Point A marker */}
      {pointA && (
        <Marker longitude={pointA.lng} latitude={pointA.lat} anchor="center">
          <div className="relative">
            <div className="w-4 h-4 rounded-full bg-amber-400 border-2 border-white shadow-lg" />
            <span className="g-theme gc-pointname absolute -top-6 left-1/2 -translate-x-1/2">A</span>
          </div>
        </Marker>
      )}

      {/* Point B marker */}
      {pointB && (
        <Marker longitude={pointB.lng} latitude={pointB.lat} anchor="center">
          <div className="relative">
            <div className="w-4 h-4 rounded-full bg-amber-400 border-2 border-white shadow-lg" />
            <span className="g-theme gc-pointname absolute -top-6 left-1/2 -translate-x-1/2">B</span>
          </div>
        </Marker>
      )}

      {/* Distance line */}
      {lineGeoJSON && (
        <Source id="distance-line" type="geojson" data={lineGeoJSON}>
          <Layer {...lineLayer} />
        </Source>
      )}

      {/* Distance label at midpoint */}
      {hasLine && (
        <Marker longitude={midLng} latitude={midLat} anchor="bottom">
          <div className="g-theme gc-popover gc-measure-label" style={{ textAlign: 'center' }}>
            <div className="gc-popover-body" style={{ gap: 3, alignItems: 'center' }}>
              <b style={{ fontSize: 17, fontWeight: 800 }}>{oneDecimal(distKm)} km</b>
              <span className="gc-note">{oneDecimal(distNm)} mn, {cardinal} ({brg.toFixed(0)}°)</span>
              <button type="button" onClick={onDeactivate} className="gc-linkbtn" style={{ alignSelf: 'center' }} aria-label="Cerrar medición">Cerrar</button>
            </div>
          </div>
        </Marker>
      )}
    </>
  );
});
