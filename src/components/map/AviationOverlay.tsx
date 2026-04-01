import { useMemo, useEffect, memo, useState, useCallback } from 'react';
import { Source, Layer, Popup } from 'react-map-gl/maplibre';
import { useMap } from 'react-map-gl/maplibre';
import { useAviationStore } from '../../store/aviationStore';
import type { Aircraft } from '../../types/aviation';
import type { MapLayerMouseEvent } from 'maplibre-gl';

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

const ICON_SIZE = 32;
const ICON_ID = 'aircraft-icon';

/** Draw airplane silhouette on canvas — white with dark outline */
function createAircraftImage(): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d')!;
  const cx = ICON_SIZE / 2;
  const cy = ICON_SIZE / 2;

  ctx.translate(cx, cy);

  // Fuselage
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.lineTo(2, -6);
  ctx.lineTo(2, 8);
  ctx.lineTo(0, 12);
  ctx.lineTo(-2, 8);
  ctx.lineTo(-2, -6);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();

  // Main wings
  ctx.beginPath();
  ctx.moveTo(-12, 0);
  ctx.lineTo(-2, -3);
  ctx.lineTo(2, -3);
  ctx.lineTo(12, 0);
  ctx.lineTo(2, 1);
  ctx.lineTo(-2, 1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Tail wings
  ctx.beginPath();
  ctx.moveTo(-5, 8);
  ctx.lineTo(-2, 6);
  ctx.lineTo(2, 6);
  ctx.lineTo(5, 8);
  ctx.lineTo(2, 9);
  ctx.lineTo(-2, 9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  return ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE);
}

/** Register aircraft icon on map load */
export function registerAircraftIcon(map: maplibregl.Map) {
  if (map.hasImage(ICON_ID)) return;
  map.addImage(ICON_ID, createAircraftImage(), { sdf: false });
}

/**
 * Aviation overlay — Embalse sector only.
 * Shows aircraft as airplane icons rotated by heading.
 * Color-coded altitude labels by proximity.
 */
/** Project position forward N minutes using heading + velocity */
function projectPosition(lat: number, lon: number, heading: number, velocityMs: number, minutes: number) {
  const distKm = (velocityMs / 1000) * minutes * 60;
  const headRad = (heading * Math.PI) / 180;
  const dLat = (distKm / 111.32) * Math.cos(headRad);
  const dLon = (distKm / (111.32 * Math.cos(lat * Math.PI / 180))) * Math.sin(headRad);
  return [lon + dLon, lat + dLat] as [number, number];
}

export const AviationOverlay = memo(function AviationOverlay() {
  const aircraft = useAviationStore((s) => s.aircraft);
  const trajectories = useAviationStore((s) => s.trajectories);
  const showOverlay = useAviationStore((s) => s.showOverlay);
  const [selectedAircraft, setSelectedAircraft] = useState<Aircraft | null>(null);
  const { current: mapRef } = useMap();

  // Register icon when map is available
  useEffect(() => {
    const map = mapRef?.getMap();
    if (map) registerAircraftIcon(map);
  }, [mapRef]);

  const geojson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || aircraft.length === 0) return EMPTY_FC;
    return {
      type: 'FeatureCollection',
      features: aircraft.map((ac) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [ac.lon, ac.lat] },
        properties: {
          icao24: ac.icao24,
          callsign: ac.callsign,
          altitude: Math.round(ac.altitude),
          heading: ac.heading,
          velocity: ac.velocity,
          verticalRate: ac.verticalRate,
          distanceKm: ac.distanceKm,
          color: ac.distanceKm < 1 ? '#ef4444' : ac.distanceKm < 3 ? '#f59e0b' : '#60a5fa',
          altLabel: `${Math.round(ac.altitude)}m`,
        },
      })),
    };
  }, [showOverlay, aircraft]);

  // Past trajectory lines (solid, orange)
  const trackGeojson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || trajectories.size === 0) return EMPTY_FC;
    const features: GeoJSON.Feature[] = [];
    for (const [icao24, points] of trajectories) {
      if (points.length < 2) continue;
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: points.map((p) => [p.lon, p.lat]),
        },
        properties: { icao24 },
      });
    }
    return { type: 'FeatureCollection', features };
  }, [showOverlay, trajectories]);

  // Future projection lines (dashed, cyan — 1min ahead)
  const projectionGeojson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showOverlay || aircraft.length === 0) return EMPTY_FC;
    const features: GeoJSON.Feature[] = [];
    for (const ac of aircraft) {
      if (ac.velocity < 10) continue; // skip near-stationary
      const future = projectPosition(ac.lat, ac.lon, ac.heading, ac.velocity, 1);
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [[ac.lon, ac.lat], future],
        },
        properties: { icao24: ac.icao24 },
      });
    }
    return { type: 'FeatureCollection', features };
  }, [showOverlay, aircraft]);

  const handleClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const icao24 = feature.properties?.icao24;
      const ac = aircraft.find((a) => a.icao24 === icao24);
      if (ac) setSelectedAircraft(ac);
    },
    [aircraft],
  );

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    map.on('click', 'aviation-aircraft', handleClick);
    map.on('mouseenter', 'aviation-aircraft', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'aviation-aircraft', () => {
      map.getCanvas().style.cursor = '';
    });
    return () => {
      map.off('click', 'aviation-aircraft', handleClick);
      map.off('mouseenter', 'aviation-aircraft', () => {});
      map.off('mouseleave', 'aviation-aircraft', () => {});
    };
  }, [mapRef, handleClick]);

  if (!showOverlay) return null;

  return (
    <>
      {/* Past trajectory — solid orange */}
      <Source id="aviation-tracks" type="geojson" data={trackGeojson}>
        <Layer
          id="aviation-track-lines"
          type="line"
          paint={{
            'line-color': '#f59e0b',
            'line-width': 2,
            'line-opacity': 0.5,
          }}
        />
      </Source>

      {/* Future projection — dashed cyan, 3min ahead */}
      <Source id="aviation-projection" type="geojson" data={projectionGeojson}>
        <Layer
          id="aviation-projection-lines"
          type="line"
          paint={{
            'line-color': '#22d3ee',
            'line-width': 1.5,
            'line-opacity': 0.6,
            'line-dasharray': [4, 4],
          }}
        />
      </Source>

      <Source id="aviation-source" type="geojson" data={geojson}>
        {/* Aircraft icons — rotated by heading */}
        <Layer
          id="aviation-aircraft"
          type="symbol"
          layout={{
            'icon-image': ICON_ID,
            'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 13, 1.2],
            'icon-rotate': ['get', 'heading'],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          }}
          paint={{
            'icon-opacity': 0.95,
          }}
        />
        {/* Altitude labels */}
        <Layer
          id="aviation-alt-labels"
          type="symbol"
          layout={{
            'text-field': ['get', 'altLabel'],
            'text-size': 10,
            'text-offset': [0, -1.8],
            'text-anchor': 'bottom',
            'text-allow-overlap': true,
          }}
          paint={{
            'text-color': ['get', 'color'],
            'text-halo-color': '#000000',
            'text-halo-width': 1,
          }}
        />
        {/* Callsign labels */}
        <Layer
          id="aviation-callsign-labels"
          type="symbol"
          layout={{
            'text-field': ['get', 'callsign'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 10, 0, 12, 9, 14, 11],
            'text-offset': [0, 1.6],
            'text-anchor': 'top',
            'text-optional': true,
          }}
          paint={{
            'text-color': '#e2e8f0',
            'text-halo-color': '#0f172a',
            'text-halo-width': 1,
          }}
        />
      </Source>

      {selectedAircraft && (
        <Popup
          longitude={selectedAircraft.lon}
          latitude={selectedAircraft.lat}
          closeOnClick={false}
          onClose={() => setSelectedAircraft(null)}
          anchor="bottom"
          className="aviation-popup"
        >
          <div className="p-2 text-sm text-slate-200 min-w-[180px]">
            <div className="font-semibold text-white mb-1">{selectedAircraft.callsign}</div>
            <div className="space-y-0.5 text-xs text-slate-400">
              <div>Altitud: <span className="text-slate-200">{Math.round(selectedAircraft.altitude)}m</span></div>
              <div>Velocidad: <span className="text-slate-200">{Math.round(selectedAircraft.velocity * 3.6)} km/h</span></div>
              <div>
                Vertical:{' '}
                <span className={selectedAircraft.verticalRate < 0 ? 'text-red-400' : 'text-green-400'}>
                  {selectedAircraft.verticalRate > 0 ? '+' : ''}
                  {selectedAircraft.verticalRate.toFixed(1)} m/s
                  {selectedAircraft.verticalRate < -1 ? ' ↓' : selectedAircraft.verticalRate > 1 ? ' ↑' : ''}
                </span>
              </div>
              <div>Distancia: <span className="text-slate-200">{selectedAircraft.distanceKm.toFixed(1)} km</span></div>
              <div className="text-slate-500 mt-1">ICAO: {selectedAircraft.icao24}</div>
            </div>
          </div>
        </Popup>
      )}
    </>
  );
});
