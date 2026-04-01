import { useMemo, useEffect, useCallback, memo } from 'react';
import { Source, Layer, Marker } from 'react-map-gl/maplibre';
import { useMap } from 'react-map-gl/maplibre';
import { useRegattaStore } from '../../store/regattaStore';
import type { MapLayerMouseEvent } from 'maplibre-gl';

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * Regatta/Event Mode overlay.
 * Handles zone drawing (2-click rectangle) + displays zone boundary + draggable buoy markers.
 */
export const RegattaOverlay = memo(function RegattaOverlay() {
  const { active, drawingPhase, firstCorner, zone, buoyMarkers } = useRegattaStore();
  const { current: mapRef } = useMap();

  // Zone drawing click handler
  const handleClick = useCallback((e: MapLayerMouseEvent) => {
    const store = useRegattaStore.getState();
    if (!store.active) return;

    const { lng, lat } = e.lngLat;

    if (store.drawingPhase === 'first') {
      store.setFirstCorner([lng, lat]);
    } else if (store.drawingPhase === 'second') {
      const fc = store.firstCorner!;
      store.setZone({
        ne: [Math.max(fc[0], lng), Math.max(fc[1], lat)],
        sw: [Math.min(fc[0], lng), Math.min(fc[1], lat)],
      });
    }
  }, []);

  // Register/unregister click handler + cursor
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    if (active && (drawingPhase === 'first' || drawingPhase === 'second')) {
      map.getCanvas().style.cursor = 'crosshair';
      map.on('click', handleClick);
      return () => {
        map.off('click', handleClick);
        map.getCanvas().style.cursor = '';
      };
    } else {
      map.getCanvas().style.cursor = '';
    }
  }, [mapRef, active, drawingPhase, handleClick]);

  // Zone rectangle GeoJSON
  const zoneGeojson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!zone) return EMPTY_FC;
    const { ne, sw } = zone;
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[sw, [ne[0], sw[1]], ne, [sw[0], ne[1]], sw]],
        },
        properties: {},
      }],
    };
  }, [zone]);

  // First corner marker during drawing
  const drawingMarker = useMemo(() => {
    if (drawingPhase !== 'second' || !firstCorner) return null;
    return firstCorner;
  }, [drawingPhase, firstCorner]);

  if (!active) return null;

  return (
    <>
      {/* Drawing instruction banner */}
      {drawingPhase !== 'idle' && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-lg bg-amber-500/90 text-slate-900 text-sm font-bold shadow-lg">
          {drawingPhase === 'first' ? 'Toca la primera esquina de la zona' : 'Toca la segunda esquina'}
        </div>
      )}

      {/* First corner marker while drawing */}
      {drawingMarker && (
        <Marker longitude={drawingMarker[0]} latitude={drawingMarker[1]}>
          <div className="w-4 h-4 rounded-full bg-amber-400 border-2 border-white shadow-lg animate-pulse" />
        </Marker>
      )}

      {/* Zone rectangle */}
      {zone && (
        <Source id="regatta-zone" type="geojson" data={zoneGeojson}>
          <Layer
            id="regatta-zone-fill"
            type="fill"
            paint={{
              'fill-color': '#f59e0b',
              'fill-opacity': 0.08,
            }}
          />
          <Layer
            id="regatta-zone-border"
            type="line"
            paint={{
              'line-color': '#f59e0b',
              'line-width': 2.5,
              'line-dasharray': [6, 4],
              'line-opacity': 0.8,
            }}
          />
        </Source>
      )}

      {/* Draggable buoy markers */}
      {buoyMarkers.map((buoy) => (
        <Marker
          key={buoy.id}
          longitude={buoy.lon}
          latitude={buoy.lat}
          draggable
          onDragEnd={(e) => {
            useRegattaStore.getState().moveBuoy(buoy.id, e.lngLat.lng, e.lngLat.lat);
          }}
        >
          <div className="flex flex-col items-center cursor-grab active:cursor-grabbing">
            <div className="w-7 h-7 rounded-full bg-amber-500 border-2 border-white shadow-lg flex items-center justify-center text-xs font-black text-slate-900">
              {buoy.label}
            </div>
            <div className="w-0 h-0 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-amber-500 -mt-0.5" />
          </div>
        </Marker>
      ))}
    </>
  );
});
