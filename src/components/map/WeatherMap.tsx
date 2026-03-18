import { useCallback, useEffect, useMemo, useRef } from 'react';
import Map, { NavigationControl } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { useSectorStore } from '../../store/sectorStore';
import { useWeatherStore } from '../../store/weatherStore';
import { useUIStore } from '../../store/uiStore';
import { useMapStyleStore, getStyleDef } from '../../store/mapStyleStore';
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
import { CurrentsOverlay } from './CurrentsOverlay';
import { AirspaceOverlay } from './AirspaceOverlay';
import { BathymetryOverlay } from './BathymetryOverlay';
import { SSTOverlay } from './SSTOverlay';
import { SSTLegend } from './SSTLegend';
import { WeatherLayerSelector } from './WeatherLayerSelector';
import { MapStyleSelector } from './MapStyleSelector';
import { SailingConditionBanner } from './SailingConditionBanner';
import { CriticalAlertBanner } from './CriticalAlertBanner';
import { SectorSelector } from './SectorSelector';
import { MapContextMenu } from './MapContextMenu';
import { BuoyMarker } from './BuoyMarker';
import { BuoyPopup } from './BuoyPopup';
import { SpotMarkers } from './SpotMarker';
import { SpotPopup } from './SpotPopup';
import { SeamarksOverlay } from './SeamarksOverlay';
import { NauticalChartOverlay } from './NauticalChartOverlay';
import { IGNHillshadeOverlay } from './IGNHillshadeOverlay';
import { IGNContoursOverlay } from './IGNContoursOverlay';
import { IGNOrthoOverlay } from './IGNOrthoOverlay';
import { useBuoyStore } from '../../store/buoyStore';
import { useSpotStore } from '../../store/spotStore';

/** Build a MapLibre StyleSpecification for the given base map style + 3D terrain */
function buildMapStyle(styleId: string): maplibregl.StyleSpecification {
  const def = getStyleDef(styleId as any);
  const isDark = styleId === 'dark';
  return {
    version: 8,
    glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
    sources: {
      'base-tiles': {
        type: 'raster',
        tiles: def.tiles,
        tileSize: def.tileSize,
        attribution: def.attribution,
        maxzoom: def.maxzoom,
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
        id: 'base-tiles',
        type: 'raster',
        source: 'base-tiles',
      },
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'terrainDEM',
        paint: {
          'hillshade-shadow-color': isDark ? '#000000' : '#473B24',
          'hillshade-highlight-color': isDark ? '#333333' : '#FFFFFF',
          'hillshade-illumination-direction': 315,
          'hillshade-exaggeration': isDark ? 0.3 : 0.5,
        },
      },
    ],
    terrain: {
      source: 'terrainDEM',
      exaggeration: 1.5,
    },
    sky: {},
  };
}

export function WeatherMap() {
  const mapRef = useRef<MapRef | null>(null);
  const activeSector = useSectorStore((s) => s.activeSector);
  const activeStyleId = useMapStyleStore((s) => s.activeStyleId);
  const mapStyle = useMemo(() => buildMapStyle(activeStyleId), [activeStyleId]);
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

  // Spot state
  const activeSpotId = useSpotStore((s) => s.activeSpotId);
  const activeSpot = useSpotStore((s) => s.activeSpot);
  const spotScores = useSpotStore((s) => s.scores);
  const selectSpot = useSpotStore((s) => s.selectSpot);
  const showSpotPopup = activeSpotId !== '';

  const flyToTarget = useUIStore((s) => s.flyToTarget);
  const setFlyToTarget = useUIStore((s) => s.setFlyToTarget);

  // Cross-deselection: only one popup at a time (station XOR buoy XOR spot).
  // Track previous values to detect which one changed (= new selection wins).
  const prevBuoyRef = useRef<number | null>(null);
  const prevStationRef = useRef<string | null>(null);
  const prevSpotRef = useRef<string>('');
  useEffect(() => {
    const spotChanged = activeSpotId !== prevSpotRef.current;
    const buoyChanged = selectedBuoyId !== prevBuoyRef.current;
    const stationChanged = selectedStationId !== prevStationRef.current;

    // Spot selected → clear station + buoy
    if (spotChanged && activeSpotId) {
      if (selectedStationId) selectStation(null);
      if (selectedBuoyId != null) selectBuoy(null);
    }
    // Station selected → clear buoy + spot
    else if (stationChanged && selectedStationId) {
      if (selectedBuoyId != null) selectBuoy(null);
      if (activeSpotId) selectSpot('');
    }
    // Buoy selected → clear station + spot
    else if (buoyChanged && selectedBuoyId != null) {
      if (selectedStationId) selectStation(null);
      if (activeSpotId) selectSpot('');
    }

    prevBuoyRef.current = selectedBuoyId;
    prevStationRef.current = selectedStationId;
    prevSpotRef.current = activeSpotId;
  }, [selectedBuoyId, selectedStationId, activeSpotId, selectStation, selectBuoy, selectSpot]);

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
    selectSpot('');
  }, [selectStation, selectBuoy, selectSpot]);

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
        mapStyle={mapStyle}
        maxPitch={85}
        onClick={handleMapClick}
        onLoad={handleMapLoad}
      >
        <NavigationControl position="top-right" visualizePitch />

        {/* IHM nautical chart — Rías only, below everything except base tiles */}
        {activeSector.id === 'rias' && <NauticalChartOverlay />}

        {/* OpenSeaMap seamarks — Rías only, above nautical chart, below weather overlays */}
        {activeSector.id === 'rias' && <SeamarksOverlay />}

        {/* IGN terrain overlays — available in both sectors */}
        <IGNOrthoOverlay />
        <IGNHillshadeOverlay />
        <IGNContoursOverlay />

        {/* EMODnet bathymetry — seabed depth tiles (Rías only, below all other layers) */}
        <BathymetryOverlay />

        {/* CMEMS SST — sea surface temperature tiles (Rías only) */}
        <SSTOverlay />

        {/* Thermal zone polygons — only for Embalse sector */}
        {activeSector.id === 'embalse' && <ThermalZoneOverlay />}

        {/* Temperature gradient circles + lapse-rate lines (below wind arrows) */}
        <TemperatureOverlay />

        {/* Wind field arrows around stations + buoys */}
        <WindFieldOverlay stations={stations} readings={currentReadings} buoys={activeSector.id === 'rias' ? buoys : undefined} compact={stations.length > 35} />

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

        {/* Sailing spot markers — both sectors */}
        <SpotMarkers />

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

        {/* RADAR ON RAIA — HF radar surface currents (Rías Baixas only) */}
        <CurrentsOverlay />

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

        {/* Selected spot popup */}
        {showSpotPopup && activeSpot && (
          <SpotPopup spot={activeSpot} score={spotScores.get(activeSpotId)} />
        )}
      </Map>

      {/* Canvas overlays on top of map (need project/unproject) */}
      <WindParticleOverlay mapRef={mapRef} />
      <HumidityHeatmapOverlay mapRef={mapRef} />

      {/* Right-click context menu */}
      <MapContextMenu mapRef={mapRef} />

      {/* HTML overlays on top of map */}
      <SectorSelector />
      <MapStyleSelector />
      <SSTLegend />
      {activeSector.id === 'embalse' && <SailingConditionBanner />}
      <CriticalAlertBanner />

      {/* ── Bottom controls: toolbar + alerts ── */}
      {isMobile ? (
        /* Mobile: FIXED positioning to escape MapLibre's stacking context.
           absolute z-20 renders behind the canvas; fixed z-30 floats above it
           (same pattern as MobileSailingBanner). */
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
        <div className="absolute z-30 bottom-2 left-2 right-2 flex items-end gap-3">
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
