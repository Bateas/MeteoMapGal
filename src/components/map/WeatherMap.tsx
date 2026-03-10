import { useCallback, useEffect, useRef } from 'react';
import Map, { NavigationControl } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { useSectorStore } from '../../store/sectorStore';
import { useWeatherStore } from '../../store/weatherStore';
import { useUIStore } from '../../store/uiStore';
import { StationMarker } from './StationMarker';
import { TempOnlyOverlay } from './TempOnlyMarker';
import { StationPopup } from './StationPopup';
import { WindFieldOverlay, registerWindArrowIcons } from './WindFieldOverlay';
import { ThermalZoneOverlay } from './ThermalZoneOverlay';
import { ThermalAlertMarkers } from './ThermalAlertMarker';
import { PropagationArrows } from './PropagationArrow';
import { LightningOverlay } from './LightningOverlay';
import { StormClusterOverlay } from './StormClusterOverlay';
import { StormIndicator } from './StormIndicator';
import { TemperatureOverlay } from './TemperatureOverlay';
import { TemperatureToggle } from './TemperatureToggle';
import { AlertPanel } from './AlertPanel';
import { WindParticleOverlay } from './WindParticleOverlay';
import { HumidityHeatmapOverlay } from './HumidityHeatmapOverlay';
import { SatelliteOverlay } from './SatelliteOverlay';
import { RadarOverlay } from './RadarOverlay';
import { AirspaceOverlay } from './AirspaceOverlay';
import { WeatherLayerSelector } from './WeatherLayerSelector';
import { SailingConditionBanner } from './SailingConditionBanner';
import { SectorSelector } from './SectorSelector';
import { MapContextMenu } from './MapContextMenu';
import { BuoyMarker } from './BuoyMarker';
import { BuoyPopup } from './BuoyPopup';
import { SpotMarkers } from './SpotMarker';
import { useBuoyStore } from '../../store/buoyStore';

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
  const isMobile = useUIStore((s) => s.isMobile);

  const selectedStation = stations.find((s) => s.id === selectedStationId);

  // Buoy data from shared store (populated by BuoyPanel in Rías Baixas sector)
  const buoys = useBuoyStore((s) => s.buoys);
  const selectedBuoyId = useBuoyStore((s) => s.selectedBuoyId);
  const selectBuoy = useBuoyStore((s) => s.selectBuoy);
  const selectedBuoy = buoys.find((b) => b.stationId === selectedBuoyId);

  const flyToTarget = useUIStore((s) => s.flyToTarget);
  const setFlyToTarget = useUIStore((s) => s.setFlyToTarget);

  // Cross-deselection: only one popup at a time (station XOR buoy).
  // Track previous values to detect which one changed (= new selection wins).
  const prevBuoyRef = useRef<number | null>(null);
  const prevStationRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedBuoyId != null && selectedStationId != null) {
      // Determine which was just selected by comparing to previous values
      const buoyChanged = selectedBuoyId !== prevBuoyRef.current;
      if (buoyChanged) {
        selectStation(null);   // new buoy selected → clear station
      } else {
        selectBuoy(null);      // new station selected → clear buoy
      }
    }
    prevBuoyRef.current = selectedBuoyId;
    prevStationRef.current = selectedStationId;
  }, [selectedBuoyId, selectedStationId, selectStation, selectBuoy]);

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
  // initialView is derived from sector id (immutable configs), but include it
  // so the linter sees all values used inside the effect are listed.
  }, [activeSector.id, activeSector.initialView]);

  /** Fly to a specific target (triggered from FieldDrawer zone click). */
  useEffect(() => {
    if (!flyToTarget) return;
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({
      center: [flyToTarget.lon, flyToTarget.lat],
      zoom: flyToTarget.zoom ?? 12,
      duration: 1500,
    });
    setFlyToTarget(null);
  }, [flyToTarget, setFlyToTarget]);

  const handleMapClick = useCallback(() => {
    selectStation(null);
    selectBuoy(null);
  }, [selectStation, selectBuoy]);

  /** Register all wind-arrow icons (one per speed level) when the map loads. */
  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    registerWindArrowIcons(map, 48);
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden">
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

        {/* Temp-only station dots — GPU-accelerated (single source + 3 layers) */}
        <TempOnlyOverlay stations={stations} readings={currentReadings} />

        {/* Wind station markers (full DOM markers with SVG) */}
        {stations.map((station) =>
          station.tempOnly ? null : (
            <StationMarker
              key={station.id}
              station={station}
              reading={currentReadings.get(station.id)}
              isSelected={station.id === selectedStationId}
            />
          )
        )}

        {/* Marine buoy markers — only for Rías Baixas sector */}
        {activeSector.id === 'rias' && buoys.map((b) => (
          <BuoyMarker
            key={b.stationId}
            reading={b}
            isSelected={b.stationId === selectedBuoyId}
          />
        ))}

        {/* Sailing spot markers — only for Rías Baixas sector */}
        {activeSector.id === 'rias' && <SpotMarkers />}

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

        {/* EUMETSAT satellite cloud imagery (inside Map for native raster rendering) */}
        <SatelliteOverlay />

        {/* AEMET Radar de Cuntis — regional Galicia precipitation radar */}
        <RadarOverlay />

        {/* ENAIRE airspace zones + NOTAMs — only visible when Dron tab is active */}
        <AirspaceOverlay />

        {/* Selected station popup */}
        {selectedStation && (
          <StationPopup
            station={selectedStation}
            reading={currentReadings.get(selectedStation.id)}
          />
        )}

        {/* Selected buoy popup — Rías Baixas only */}
        {activeSector.id === 'rias' && selectedBuoy && (
          <BuoyPopup reading={selectedBuoy} />
        )}
      </Map>

      {/* Canvas overlays on top of map (need project/unproject) */}
      <WindParticleOverlay mapRef={mapRef} />
      <HumidityHeatmapOverlay mapRef={mapRef} />

      {/* Right-click context menu */}
      <MapContextMenu mapRef={mapRef} />

      {/* HTML overlays on top of map */}
      <SectorSelector />
      {activeSector.id === 'embalse' && <SailingConditionBanner />}

      {/* ── Bottom controls: toolbar + alerts ── */}
      {isMobile ? (
        /* Mobile: FIXED positioning to escape MapLibre's stacking context.
           absolute z-20 renders behind the canvas; fixed z-30 floats above it
           (same pattern as BigWindDisplay & MobileSailingBanner). */
        <div className="fixed z-30 bottom-3 left-0 right-0 px-2 pb-[env(safe-area-inset-bottom,0px)] flex flex-col items-center gap-2 pointer-events-none">
          <div className="pointer-events-auto w-full flex justify-center">
            <AlertPanel />
          </div>
          <div className="flex items-center justify-center gap-1.5 max-w-full overflow-x-auto scrollbar-none pointer-events-auto">
            <StormIndicator />
            <TemperatureToggle />
            <WeatherLayerSelector />
          </div>
        </div>
      ) : (
        /* Desktop: single flex row — toolbar left, alerts fill remaining space */
        <div className="absolute z-20 bottom-2 left-2 right-2 flex items-end gap-3">
          {/* Toolbar: shrinks to fit, never overlapped */}
          <div className="flex items-end gap-2 shrink-0">
            <StormIndicator />
            <TemperatureToggle />
            <WeatherLayerSelector />
          </div>

          {/* Alerts: fills remaining width, centered within its space */}
          <div className="flex-1 min-w-0 flex justify-center">
            <div className="max-w-2xl w-full">
              <AlertPanel />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
