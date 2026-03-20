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
import { useState, useEffect, useCallback, memo, useRef } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { Source, Layer, Marker } from 'react-map-gl/maplibre';
import type { LineLayerSpecification } from 'maplibre-gl';

interface DistanceToolProps {
  mapRef: React.RefObject<MapRef | null>;
  isActive: boolean;
  onDeactivate: () => void;
}

interface Point {
  lng: number;
  lat: number;
}

/** Haversine distance in kilometers */
function haversineKm(a: Point, b: Point): number {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
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

/** Convert degrees to cardinal direction (N, NNE, NE, etc.) */
function degreesToCardinal(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

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
  const [pointA, setPointA] = useState<Point | null>(null);
  const [pointB, setPointB] = useState<Point | null>(null);
  const clickPhaseRef = useRef<'A' | 'B' | 'done'>('A');

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
  const distKm = hasLine ? haversineKm(pointA, pointB) : 0;
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
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-40 bg-slate-800/95 border border-amber-500/30 rounded-lg px-4 py-2 text-sm text-amber-300 shadow-lg backdrop-blur-sm flex items-center gap-3">
          <span>{clickPhaseRef.current === 'A' ? 'Toca el punto de inicio' : 'Toca el punto final'}</span>
          <button
            onClick={onDeactivate}
            className="text-slate-400 hover:text-white text-xs ml-1 px-1.5 py-0.5 rounded bg-slate-700/50 hover:bg-slate-600/50 transition-colors"
            aria-label="Cerrar herramienta de medición"
          >
            &times;
          </button>
        </div>
      )}

      {/* Point A marker */}
      {pointA && (
        <Marker longitude={pointA.lng} latitude={pointA.lat} anchor="center">
          <div className="relative">
            <div className="w-4 h-4 rounded-full bg-amber-400 border-2 border-white shadow-lg" />
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-bold text-amber-300 bg-slate-900/80 px-1 rounded">A</span>
          </div>
        </Marker>
      )}

      {/* Point B marker */}
      {pointB && (
        <Marker longitude={pointB.lng} latitude={pointB.lat} anchor="center">
          <div className="relative">
            <div className="w-4 h-4 rounded-full bg-amber-400 border-2 border-white shadow-lg" />
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] font-bold text-amber-300 bg-slate-900/80 px-1 rounded">B</span>
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
          <div className="bg-slate-800/95 border border-amber-500/40 rounded-lg px-3 py-2 text-center shadow-xl backdrop-blur-sm">
            <div className="text-amber-300 font-bold text-sm">{distKm.toFixed(1)} km</div>
            <div className="text-slate-400 text-xs">{distNm.toFixed(1)} mn &middot; {cardinal} ({brg.toFixed(0)}&deg;)</div>
            <button
              onClick={onDeactivate}
              className="mt-1.5 text-[10px] text-slate-500 hover:text-amber-300 transition-colors"
              aria-label="Cerrar medición"
            >
              Cerrar
            </button>
          </div>
        </Marker>
      )}
    </>
  );
});
