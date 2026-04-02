import { useMemo, useEffect, useCallback, memo } from 'react';
import { Source, Layer, Marker } from 'react-map-gl/maplibre';
import { useMap } from 'react-map-gl/maplibre';
import { useRegattaStore } from '../../store/regattaStore';
import { useSectorStore } from '../../store/sectorStore';
import { getZonesBySector, type WaterZone } from '../../config/waterZones';
import type { MapLayerMouseEvent } from 'maplibre-gl';

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * Regatta/Event overlay:
 * 1. Zone selector panel (predefined water zones or custom draw)
 * 2. Zone polygon rendering
 * 3. Draggable buoy markers
 * 4. Click handler for custom zone drawing
 */
export const RegattaOverlay = memo(function RegattaOverlay() {
  const { active, showZoneSelector, drawingPhase, firstCorner, zone, zonePolygon, buoyMarkers } = useRegattaStore();
  const activeSector = useSectorStore((s) => s.activeSector);
  const { current: mapRef } = useMap();

  // Custom zone drawing click handler
  const handleClick = useCallback((e: MapLayerMouseEvent) => {
    const store = useRegattaStore.getState();
    if (!store.active || store.showZoneSelector) return;
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

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    if (active && (drawingPhase === 'first' || drawingPhase === 'second')) {
      map.getCanvas().style.cursor = 'crosshair';
      map.on('click', handleClick);
      return () => { map.off('click', handleClick); map.getCanvas().style.cursor = ''; };
    } else {
      map.getCanvas().style.cursor = '';
    }
  }, [mapRef, active, drawingPhase, handleClick]);

  // Zone polygon GeoJSON (works for both predefined and custom)
  const zoneGeojson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!zonePolygon || zonePolygon.length < 3) return EMPTY_FC;
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [zonePolygon] },
        properties: {},
      }],
    };
  }, [zonePolygon]);

  // First corner marker during custom drawing
  const drawingMarker = drawingPhase === 'second' && firstCorner ? firstCorner : null;

  if (!active) return null;

  const sectorZones = getZonesBySector(activeSector.id);

  return (
    <>
      {/* Zone selector panel */}
      {showZoneSelector && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 w-80 rounded-xl bg-slate-900/95 border border-amber-500/40 backdrop-blur-md shadow-2xl overflow-hidden">
          <div className="px-3 py-2 bg-amber-500/15 border-b border-amber-500/30">
            <span className="text-amber-400 text-sm font-bold uppercase tracking-wider">Seleccionar zona del evento</span>
          </div>
          <div className="p-3 space-y-1.5 max-h-64 overflow-y-auto">
            {sectorZones.map((wz) => (
              <ZoneOption key={wz.id} zone={wz} />
            ))}
          </div>
          <div className="px-3 py-2 border-t border-slate-700/40 flex gap-2">
            <button
              onClick={() => useRegattaStore.getState().startDrawing()}
              className="flex-1 px-2 py-1.5 rounded text-[10px] font-bold bg-slate-700/50 border border-slate-600/40 text-slate-300 cursor-pointer hover:bg-slate-600/50 transition-all"
            >
              Dibujar zona custom
            </button>
            <button
              onClick={() => useRegattaStore.getState().deactivate()}
              className="px-3 py-1.5 rounded text-[10px] text-slate-600 hover:text-red-400 cursor-pointer transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Drawing instructions */}
      {drawingPhase !== 'idle' && !showZoneSelector && (
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

      {/* Zone polygon */}
      {zonePolygon && (
        <Source id="regatta-zone" type="geojson" data={zoneGeojson}>
          <Layer id="regatta-zone-fill" type="fill" paint={{ 'fill-color': '#f59e0b', 'fill-opacity': 0.08 }} />
          <Layer id="regatta-zone-border" type="line" paint={{ 'line-color': '#f59e0b', 'line-width': 2.5, 'line-dasharray': [6, 4], 'line-opacity': 0.8 }} />
        </Source>
      )}

      {/* Draggable buoy markers */}
      {buoyMarkers.map((buoy) => (
        <Marker key={buoy.id} longitude={buoy.lon} latitude={buoy.lat} draggable
          onDragEnd={(e) => useRegattaStore.getState().moveBuoy(buoy.id, e.lngLat.lng, e.lngLat.lat)}>
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

/** Zone option button */
function ZoneOption({ zone }: { zone: WaterZone }) {
  const typeLabels: Record<string, string> = {
    ria: 'Ria', embalse: 'Embalse', costa: 'Costa', ensenada: 'Ensenada', puerto: 'Puerto',
  };
  const typeColors: Record<string, string> = {
    ria: 'text-cyan-400 bg-cyan-500/20', embalse: 'text-green-400 bg-green-500/20',
    costa: 'text-blue-400 bg-blue-500/20', ensenada: 'text-teal-400 bg-teal-500/20',
    puerto: 'text-slate-400 bg-slate-500/20',
  };

  return (
    <button
      onClick={() => useRegattaStore.getState().selectPredefinedZone(zone.id)}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/40
        hover:bg-amber-500/10 hover:border-amber-500/30 cursor-pointer transition-all text-left"
    >
      <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded ${typeColors[zone.type] || typeColors.puerto}`}>
        {typeLabels[zone.type] || zone.type}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-white truncate">{zone.name}</div>
        <div className="text-[9px] text-slate-500 truncate">{zone.concellos.join(', ')} — {zone.areaKm2}km²</div>
      </div>
    </button>
  );
}
