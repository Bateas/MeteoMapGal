import { useCallback, useEffect, useRef } from 'react';
import Map, { NavigationControl } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { useSectorStore } from '../../store/sectorStore';
import { useWeatherStore } from '../../store/weatherStore';
import { StationMarker } from './StationMarker';
import { TempOnlyMarker } from './TempOnlyMarker';
import { StationPopup } from './StationPopup';
import { WindFieldOverlay, registerWindArrowIcons } from './WindFieldOverlay';
import { ThermalZoneOverlay } from './ThermalZoneOverlay';
import { ThermalAlertMarkers } from './ThermalAlertMarker';
import { PropagationArrows } from './PropagationArrow';
import { LightningOverlay } from './LightningOverlay';
import { StormClusterOverlay } from './StormClusterOverlay';
import { SimulationToggle } from './SimulationToggle';
import { TemperatureOverlay } from './TemperatureOverlay';
import { TemperatureToggle } from './TemperatureToggle';
import { AlertPanel } from './AlertPanel';
import { WindParticleOverlay } from './WindParticleOverlay';
import { HumidityHeatmapOverlay } from './HumidityHeatmapOverlay';
import { WrfOverlay } from './WrfOverlay';
import { WeatherLayerSelector } from './WeatherLayerSelector';
import { SailingConditionBanner } from './SailingConditionBanner';
import { SectorSelector } from './SectorSelector';

const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
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
    terrainDEM: {
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
      source: 'terrainDEM',
      paint: {
        'hillshade-shadow-color': '#473B24',
        'hillshade-illumination-direction': 315,
        'hillshade-exaggeration': 0.5,
      },
    },
  ],
  terrain: {
    source: 'terrainDEM',
    exaggeration: 1.5,
  },
  sky: {},
};

export function WeatherMap() {
  const mapRef = useRef<MapRef | null>(null);
  const activeSector = useSectorStore((s) => s.activeSector);
  const stations = useWeatherStore((s) => s.stations);
  const currentReadings = useWeatherStore((s) => s.currentReadings);
  const selectedStationId = useWeatherStore((s) => s.selectedStationId);
  const selectStation = useWeatherStore((s) => s.selectStation);

  const selectedStation = stations.find((s) => s.id === selectedStationId);

  /** Fly to sector view when it changes. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const { longitude, latitude, zoom, pitch, bearing } = activeSector.initialView;
    map.flyTo({
      center: [longitude, latitude],
      zoom,
      pitch,
      bearing,
      duration: 2000,
    });
  }, [activeSector.id]);

  const handleMapClick = useCallback(() => {
    selectStation(null);
  }, [selectStation]);

  /** Register all wind-arrow icons (one per speed level) when the map loads. */
  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    registerWindArrowIcons(map, 48);
  }, []);

  return (
    <div className="relative w-full h-full">
      <Map
        ref={mapRef}
        mapLib={maplibregl}
        initialViewState={activeSector.initialView}
        style={{ width: '100%', height: '100%' }}
        mapStyle={MAP_STYLE}
        maxPitch={85}
        onClick={handleMapClick}
        onLoad={handleMapLoad}
      >
        <NavigationControl position="top-right" visualizePitch />

        {/* Thermal zone polygons — only for Embalse sector */}
        {activeSector.id === 'embalse' && <ThermalZoneOverlay />}

        {/* Temperature gradient circles + lapse-rate lines (below wind arrows) */}
        <TemperatureOverlay />

        {/* Wind field arrows around stations */}
        <WindFieldOverlay stations={stations} readings={currentReadings} compact={stations.length > 35} />

        {/* Station markers (full markers for wind stations, tiny dots for temp-only) */}
        {stations.map((station) =>
          station.tempOnly ? (
            <TempOnlyMarker
              key={station.id}
              station={station}
              reading={currentReadings.get(station.id)}
            />
          ) : (
            <StationMarker
              key={station.id}
              station={station}
              reading={currentReadings.get(station.id)}
            />
          )
        )}

        {/* Thermal alert badges + propagation — only for Embalse sector */}
        {activeSector.id === 'embalse' && (
          <>
            <ThermalAlertMarkers />
            <PropagationArrows />
          </>
        )}

        {/* Storm cluster masses + radius rings (below strikes) */}
        <StormClusterOverlay />

        {/* Lightning strikes overlay */}
        <LightningOverlay />

        {/* WRF model raster overlay (inside Map for native MapLibre rendering) */}
        <WrfOverlay />

        {/* Selected station popup */}
        {selectedStation && (
          <StationPopup
            station={selectedStation}
            reading={currentReadings.get(selectedStation.id)}
          />
        )}
      </Map>

      {/* Canvas overlays on top of map (need project/unproject) */}
      <WindParticleOverlay mapRef={mapRef} />
      <HumidityHeatmapOverlay mapRef={mapRef} />

      {/* HTML overlays on top of map */}
      <SectorSelector />
      {activeSector.id === 'embalse' && <SailingConditionBanner />}
      <AlertPanel />

      {/* Bottom toolbar — flex row so elements never overlap */}
      <div className="absolute bottom-2 left-2 z-20 flex items-end gap-2">
        <SimulationToggle />
        <TemperatureToggle />
        <WeatherLayerSelector />
      </div>
    </div>
  );
}
