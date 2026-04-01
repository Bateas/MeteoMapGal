import { useMemo, useEffect, useRef, memo, useState, useCallback } from 'react';
import { Source, Layer, Popup } from 'react-map-gl/maplibre';
import { useMap } from 'react-map-gl/maplibre';
import { useAISStore } from '../../store/aisStore';
import { VESSEL_COLORS, VESSEL_LABELS } from '../../types/ais';
import type { Vessel, VesselType } from '../../types/ais';
import type { MapLayerMouseEvent } from 'maplibre-gl';

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

const ICON_SIZE = 24;

/** Draw a boat/triangle icon for a vessel type color */
function createShipImage(color: string): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d')!;
  const cx = ICON_SIZE / 2;

  // Triangle pointing up (bow) — will be rotated by MapLibre icon-rotate
  ctx.beginPath();
  ctx.moveTo(cx, 3);          // bow (top point)
  ctx.lineTo(cx + 7, 20);     // starboard stern
  ctx.lineTo(cx, 17);         // keel notch
  ctx.lineTo(cx - 7, 20);     // port stern
  ctx.closePath();

  ctx.fillStyle = color;
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();

  return ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE);
}

/** Register ship icons for all vessel types */
export function registerShipIcons(map: maplibregl.Map) {
  for (const [type, color] of Object.entries(VESSEL_COLORS)) {
    const id = `ship-${type}`;
    if (!map.hasImage(id)) {
      map.addImage(id, createShipImage(color), { sdf: false });
    }
  }
}

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

  // Sync iframe with map viewport (debounced 3s to avoid constant reloads)
  const [iframeView, setIframeView] = useState({ lat: 42.24, lon: -8.72, zoom: 12 });
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    const syncView = () => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const c = map.getCenter();
        const z = Math.min(Math.round(map.getZoom()), 18);
        setIframeView({ lat: +c.lat.toFixed(4), lon: +c.lng.toFixed(4), zoom: z });
      }, 3000);
    };
    map.on('moveend', syncView);
    // Initial sync (immediate)
    const c = map.getCenter();
    setIframeView({ lat: +c.lat.toFixed(4), lon: +c.lng.toFixed(4), zoom: Math.min(Math.round(map.getZoom()), 18) });
    return () => { map.off('moveend', syncView); clearTimeout(debounceRef.current); };
  }, [mapRef]);

  // Register icons when map is available
  useEffect(() => {
    const map = mapRef?.getMap();
    if (map) registerShipIcons(map);
  }, [mapRef]);

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
          icon: `ship-${v.type}`,
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

  // Future projection lines (5 min ahead, dashed cyan)
  const projectionGeojson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || vessels.size === 0) return EMPTY_FC;
    const features: GeoJSON.Feature[] = [];
    for (const v of vessels.values()) {
      if (v.sog < 0.5) continue;
      const cogRad = (v.cog * Math.PI) / 180;
      // SOG is in knots → nm/h. 5 min = 5/60 h. 1nm ≈ 0.01667° lat
      const distNm = v.sog * (5 / 60);
      const distDeg = distNm * 0.01667;
      const endLat = v.lat + distDeg * Math.cos(cogRad);
      const endLon = v.lon + (distDeg / Math.cos(v.lat * Math.PI / 180)) * Math.sin(cogRad);
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [[v.lon, v.lat], [endLon, endLat]],
        },
        properties: { color: VESSEL_COLORS[v.type] },
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

  useEffect(() => {
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
      map.off('mouseenter', 'ais-ships', () => {});
      map.off('mouseleave', 'ais-ships', () => {});
    };
  }, [mapRef, handleClick]);

  if (!showOverlay) return null;

  return (
    <>
      {/* VesselFinder iframe — MVP while native AIS data source is not available */}
      {vessels.size === 0 && (
        <div
          className="absolute bottom-12 right-2 z-30 rounded-lg overflow-hidden border border-teal-500/30 shadow-xl"
          style={{ width: 360, height: 260 }}
        >
          <div className="flex items-center justify-between bg-slate-900/95 px-2 py-1 border-b border-slate-700/50">
            <span className="text-[10px] text-teal-400 font-bold uppercase tracking-wider">
              Trafico maritimo — VesselFinder
            </span>
            <span className="text-[8px] text-amber-400/70 font-bold uppercase">alpha</span>
          </div>
          <iframe
            src={`https://www.vesselfinder.com/aismap?lat=${iframeView.lat}&lon=${iframeView.lon}&zoom=${iframeView.zoom}&names=true`}
            width="360"
            height="236"
            style={{ border: 0 }}
            title="VesselFinder — Tráfico marítimo Rías Baixas"
            loading="lazy"
          />
        </div>
      )}

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

      {/* Future projection — dashed cyan, 5min ahead */}
      <Source id="ais-projection" type="geojson" data={projectionGeojson}>
        <Layer
          id="ais-projection-lines"
          type="line"
          paint={{
            'line-color': '#22d3ee',
            'line-width': 1.5,
            'line-opacity': 0.5,
            'line-dasharray': [4, 4],
          }}
        />
      </Source>

      {/* Ship icons — triangles rotated by heading */}
      <Source id="ais-ships-source" type="geojson" data={shipGeojson}>
        <Layer
          id="ais-ships"
          type="symbol"
          layout={{
            'icon-image': ['get', 'icon'],
            'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 13, 1.2],
            'icon-rotate': ['get', 'heading'],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          }}
          paint={{
            'icon-opacity': 0.9,
          }}
        />
        <Layer
          id="ais-labels"
          type="symbol"
          layout={{
            'text-field': ['get', 'name'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 10, 0, 12, 10, 14, 12],
            'text-offset': [0, 1.6],
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
