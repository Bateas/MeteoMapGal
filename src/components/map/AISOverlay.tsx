import { useMemo, memo, useState, useCallback } from 'react';
import { Source, Layer, Popup } from 'react-map-gl/maplibre';
import { useMap } from 'react-map-gl/maplibre';
import { useAISStore } from '../../store/aisStore';
import { VESSEL_COLORS, VESSEL_LABELS } from '../../types/ais';
import type { Vessel } from '../../types/ais';
import type { MapLayerMouseEvent } from 'maplibre-gl';

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/**
 * AIS ship tracking overlay — Rías sector only.
 * Shows ships as colored triangles rotated by heading.
 * Includes trajectory lines and velocity vectors.
 */
export const AISOverlay = memo(function AISOverlay() {
  const vessels = useAISStore((s) => s.vessels);
  const trajectories = useAISStore((s) => s.trajectories);
  const showOverlay = useAISStore((s) => s.showOverlay);
  const [selectedVessel, setSelectedVessel] = useState<Vessel | null>(null);
  const { current: mapRef } = useMap();

  // Ship point features
  const shipGeojson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || vessels.size === 0) return EMPTY_FC;
    return {
      type: 'FeatureCollection',
      features: Array.from(vessels.values()).map((v) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [v.lon, v.lat] },
        properties: {
          mmsi: v.mmsi,
          name: v.name,
          type: v.type,
          heading: v.heading,
          sog: v.sog,
          cog: v.cog,
          destination: v.destination,
          color: VESSEL_COLORS[v.type],
        },
      })),
    };
  }, [showOverlay, vessels]);

  // Trajectory line features
  const trackGeojson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || trajectories.size === 0) return EMPTY_FC;
    const features: GeoJSON.Feature[] = [];
    for (const [mmsi, points] of trajectories) {
      if (points.length < 2) continue;
      const vessel = vessels.get(mmsi);
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: points.map((p) => [p.lon, p.lat]),
        },
        properties: {
          mmsi,
          color: vessel ? VESSEL_COLORS[vessel.type] : '#94a3b8',
        },
      });
    }
    return { type: 'FeatureCollection', features };
  }, [showOverlay, trajectories, vessels]);

  // Velocity vector features (SOG > 0.5kt)
  const velocityGeojson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || vessels.size === 0) return EMPTY_FC;
    const features: GeoJSON.Feature[] = [];
    for (const v of vessels.values()) {
      if (v.sog < 0.5) continue;
      const cogRad = (v.cog * Math.PI) / 180;
      // ~150m per knot at this latitude
      const lenDeg = v.sog * 0.002;
      const endLon = v.lon + lenDeg * Math.sin(cogRad);
      const endLat = v.lat + lenDeg * Math.cos(cogRad);
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [[v.lon, v.lat], [endLon, endLat]],
        },
        properties: {
          color: VESSEL_COLORS[v.type],
        },
      });
    }
    return { type: 'FeatureCollection', features };
  }, [showOverlay, vessels]);

  // Click handler
  const handleClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const mmsi = feature.properties?.mmsi;
      const vessel = vessels.get(mmsi);
      if (vessel) setSelectedVessel(vessel);
    },
    [vessels],
  );

  // Register click listener
  useMemo(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    map.on('click', 'ais-ships', handleClick);
    map.on('mouseenter', 'ais-ships', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'ais-ships', () => {
      map.getCanvas().style.cursor = '';
    });
    return () => {
      map.off('click', 'ais-ships', handleClick);
    };
  }, [mapRef, handleClick]);

  if (!showOverlay) return null;

  return (
    <>
      {/* Trajectory tracks */}
      <Source id="ais-tracks" type="geojson" data={trackGeojson}>
        <Layer
          id="ais-track-lines"
          type="line"
          paint={{
            'line-color': ['get', 'color'],
            'line-width': 1.5,
            'line-opacity': 0.4,
            'line-dasharray': [4, 3],
          }}
        />
      </Source>

      {/* Velocity vectors */}
      <Source id="ais-velocity" type="geojson" data={velocityGeojson}>
        <Layer
          id="ais-velocity-lines"
          type="line"
          paint={{
            'line-color': ['get', 'color'],
            'line-width': 2,
            'line-opacity': 0.6,
          }}
        />
      </Source>

      {/* Ship symbols */}
      <Source id="ais-ships-source" type="geojson" data={shipGeojson}>
        <Layer
          id="ais-ships"
          type="circle"
          paint={{
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 13, 8],
            'circle-color': ['get', 'color'],
            'circle-opacity': 0.85,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1,
          }}
        />
        <Layer
          id="ais-labels"
          type="symbol"
          layout={{
            'text-field': ['get', 'name'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 10, 0, 12, 10, 14, 12],
            'text-offset': [0, 1.4],
            'text-anchor': 'top',
            'text-optional': true,
            'text-allow-overlap': false,
          }}
          paint={{
            'text-color': '#e2e8f0',
            'text-halo-color': '#0f172a',
            'text-halo-width': 1,
          }}
        />
      </Source>

      {/* Ship popup */}
      {selectedVessel && (
        <Popup
          longitude={selectedVessel.lon}
          latitude={selectedVessel.lat}
          closeOnClick={false}
          onClose={() => setSelectedVessel(null)}
          anchor="bottom"
          className="ais-popup"
        >
          <div className="p-2 text-sm text-slate-200 min-w-[180px]">
            <div className="font-semibold text-white mb-1">{selectedVessel.name}</div>
            <div
              className="inline-block px-1.5 py-0.5 rounded text-xs font-medium mb-2"
              style={{ backgroundColor: VESSEL_COLORS[selectedVessel.type] + '40', color: VESSEL_COLORS[selectedVessel.type] }}
            >
              {VESSEL_LABELS[selectedVessel.type]}
            </div>
            <div className="space-y-0.5 text-xs text-slate-400">
              <div>Velocidad: <span className="text-slate-200">{selectedVessel.sog.toFixed(1)} kt</span></div>
              <div>Rumbo: <span className="text-slate-200">{Math.round(selectedVessel.cog)}°</span></div>
              {selectedVessel.destination && (
                <div>Destino: <span className="text-slate-200">{selectedVessel.destination}</span></div>
              )}
              <div className="text-slate-500 mt-1">MMSI: {selectedVessel.mmsi}</div>
            </div>
          </div>
        </Popup>
      )}
    </>
  );
});
