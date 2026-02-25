import { useCallback } from 'react';
import Map, { NavigationControl } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { INITIAL_VIEW_STATE } from '../../config/constants';
import { useWeatherStore } from '../../store/weatherStore';
import { StationMarker } from './StationMarker';
import { StationPopup } from './StationPopup';
import { WindFieldOverlay } from './WindFieldOverlay';

const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors',
      maxzoom: 19,
    },
    terrainSource: {
      type: 'raster-dem',
      tiles: [
        'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
      ],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15,
    },
    hillshadeSource: {
      type: 'raster-dem',
      tiles: [
        'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
      ],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15,
    },
  },
  layers: [
    {
      id: 'osm-tiles',
      type: 'raster',
      source: 'osm',
    },
    {
      id: 'hillshade',
      type: 'hillshade',
      source: 'hillshadeSource',
      paint: {
        'hillshade-shadow-color': '#473B24',
        'hillshade-illumination-direction': 315,
        'hillshade-exaggeration': 0.5,
      },
    },
  ],
  terrain: {
    source: 'terrainSource',
    exaggeration: 1.5,
  },
  sky: {},
};

export function WeatherMap() {
  const stations = useWeatherStore((s) => s.stations);
  const currentReadings = useWeatherStore((s) => s.currentReadings);
  const selectedStationId = useWeatherStore((s) => s.selectedStationId);
  const selectStation = useWeatherStore((s) => s.selectStation);

  const selectedStation = stations.find((s) => s.id === selectedStationId);

  const handleMapClick = useCallback(() => {
    selectStation(null);
  }, [selectStation]);

  return (
    <Map
      mapLib={maplibregl}
      initialViewState={INITIAL_VIEW_STATE}
      style={{ width: '100%', height: '100%' }}
      mapStyle={MAP_STYLE}
      maxPitch={85}
      onClick={handleMapClick}
    >
      <NavigationControl position="top-right" visualizePitch />

      {/* Wind field arrows around stations */}
      <WindFieldOverlay stations={stations} readings={currentReadings} />

      {/* Station markers */}
      {stations.map((station) => (
        <StationMarker
          key={station.id}
          station={station}
          reading={currentReadings.get(station.id)}
        />
      ))}

      {/* Selected station popup */}
      {selectedStation && (
        <StationPopup
          station={selectedStation}
          reading={currentReadings.get(selectedStation.id)}
        />
      )}
    </Map>
  );
}
