import { useMemo, memo, useState, useCallback } from 'react';
import { Source, Layer, Popup } from 'react-map-gl/maplibre';
import { useMap } from 'react-map-gl/maplibre';
import { useAviationStore } from '../../store/aviationStore';
import type { Aircraft } from '../../types/aviation';
import type { MapLayerMouseEvent } from 'maplibre-gl';

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/**
 * Aviation overlay — Embalse sector only.
 * Shows aircraft as icons with altitude labels.
 * Color-coded by alert proximity.
 */
export const AviationOverlay = memo(function AviationOverlay() {
  const aircraft = useAviationStore((s) => s.aircraft);
  const alert = useAviationStore((s) => s.alert);
  const showOverlay = useAviationStore((s) => s.showOverlay);
  const [selectedAircraft, setSelectedAircraft] = useState<Aircraft | null>(null);
  const { current: mapRef } = useMap();

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
          // Color by proximity
          color: ac.distanceKm < 1 ? '#ef4444' : ac.distanceKm < 3 ? '#f59e0b' : '#60a5fa',
          altLabel: `${Math.round(ac.altitude)}m`,
        },
      })),
    };
  }, [showOverlay, aircraft]);

  // Click handler
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

  useMemo(() => {
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
    };
  }, [mapRef, handleClick]);

  if (!showOverlay) return null;

  return (
    <>
      <Source id="aviation-source" type="geojson" data={geojson}>
        {/* Aircraft circles */}
        <Layer
          id="aviation-aircraft"
          type="circle"
          paint={{
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 13, 10],
            'circle-color': ['get', 'color'],
            'circle-opacity': 0.9,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
          }}
        />
        {/* Altitude labels */}
        <Layer
          id="aviation-alt-labels"
          type="symbol"
          layout={{
            'text-field': ['get', 'altLabel'],
            'text-size': 10,
            'text-offset': [0, -1.5],
            'text-anchor': 'bottom',
            'text-allow-overlap': true,
          }}
          paint={{
            'text-color': '#fbbf24',
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
            'text-offset': [0, 1.4],
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

      {/* Aircraft popup */}
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
              <div>
                Altitud: <span className="text-slate-200">{Math.round(selectedAircraft.altitude)}m</span>
              </div>
              <div>
                Velocidad:{' '}
                <span className="text-slate-200">
                  {Math.round(selectedAircraft.velocity * 3.6)} km/h
                </span>
              </div>
              <div>
                Vertical:{' '}
                <span className={selectedAircraft.verticalRate < 0 ? 'text-red-400' : 'text-green-400'}>
                  {selectedAircraft.verticalRate > 0 ? '+' : ''}
                  {selectedAircraft.verticalRate.toFixed(1)} m/s
                  {selectedAircraft.verticalRate < -1 ? ' ↓' : selectedAircraft.verticalRate > 1 ? ' ↑' : ''}
                </span>
              </div>
              <div>
                Distancia: <span className="text-slate-200">{selectedAircraft.distanceKm.toFixed(1)} km</span>
              </div>
              <div className="text-slate-500 mt-1">ICAO: {selectedAircraft.icao24}</div>
            </div>
          </div>
        </Popup>
      )}
    </>
  );
});
