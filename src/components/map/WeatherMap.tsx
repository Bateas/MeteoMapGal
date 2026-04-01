import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, { NavigationControl } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { useSectorStore } from '../../store/sectorStore';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';
import { useUIStore } from '../../store/uiStore';
import { useMapStyleStore, getStyleDef } from '../../store/mapStyleStore';
import { StationSymbolLayer, registerStationIcon } from './StationSymbolLayer';
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
import { BuoySymbolLayer, registerBuoyIcon } from './BuoySymbolLayer';
import { BuoyPopup } from './BuoyPopup';
import { SpotMarkers } from './SpotMarker';
import { SpotPopup } from './SpotPopup';
import { SeamarksOverlay } from './SeamarksOverlay';
import { NauticalChartOverlay } from './NauticalChartOverlay';
import { IGNHillshadeOverlay } from './IGNHillshadeOverlay';
import { IGNContoursOverlay } from './IGNContoursOverlay';
import { IGNOrthoOverlay } from './IGNOrthoOverlay';
import { DistanceTool } from './DistanceTool';
import { useBuoyStore } from '../../store/buoyStore';
import { useSpotStore } from '../../store/spotStore';

/** Build a MapLibre StyleSpecification for the given base map style + 3D terrain */
function buildMapStyle(styleId: string): maplibregl.StyleSpecification {
  const def = getStyleDef(styleId as any);
  const isDark = styleId === 'dark';
  return {
    version: 8,
    glyphs: 'https://cdn.protomaps.com/fonts/pbf/{fontstack}/{range}.pbf',
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
        maxzoom: 11, // Limit DEM resolution — fewer tiles to fetch/render
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
          'hillshade-exaggeration': isDark ? 0.35 : 0.55,
        },
      },
    ],
    terrain: { source: 'terrainDEM', exaggeration: 1.2 },
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
  const selectedStationId = useWeatherSelectionStore((s) => s.selectedStationId);
  const selectStation = useWeatherSelectionStore((s) => s.selectStation);
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

  // Track zoom level for label visibility — quantized to visual breakpoints
  // to avoid re-rendering ~84 markers on every 0.1 zoom change
  const [zoomLevel, setZoomLevel] = useState(activeSector.initialView.zoom);
  const showStationLabels = zoomLevel >= 11;
  const quantizeZoom = useCallback((z: number) => {
    // Only 4 breakpoints matter: <9.5, 9.5-11, 11-12, >=12
    if (z < 9.5) return 9;
    if (z < 11) return 10;
    if (z < 12) return 11;
    return 12;
  }, []);

  // Distance measurement tool
  const [distanceActive, setDistanceActive] = useState(false);
  const deactivateDistance = useCallback(() => setDistanceActive(false), []);

  // Hide markers during map drag for smooth panning (95 DOM markers = jank)
  // Uses DOM class toggle instead of React state to avoid re-rendering ~100 markers
  const containerRef = useRef<HTMLDivElement>(null);
  const terrainRestoreTimer = useRef<ReturnType<typeof setTimeout>>();
  const handleMoveStart = useCallback(() => {
    containerRef.current?.classList.add('map-panning');
    // Disable terrain during pan for smooth 60fps — restore after idle
    const map = mapRef.current?.getMap();
    if (map?.getTerrain()) {
      clearTimeout(terrainRestoreTimer.current);
      map.setTerrain(null);
    }
  }, []);
  const handleMoveEnd = useCallback(() => {
    containerRef.current?.classList.remove('map-panning');
    // Restore terrain after a short delay to avoid flicker during rapid pan-zoom
    clearTimeout(terrainRestoreTimer.current);
    terrainRestoreTimer.current = setTimeout(() => {
      const map = mapRef.current?.getMap();
      if (map && !map.getTerrain()) {
        map.setTerrain({ source: 'terrainDEM', exaggeration: 1.2 });
      }
    }, 500);
  }, []);

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

  /** Fly to a specific target (triggered from FieldDrawer zone click / SpotComparator). */
  useEffect(() => {
    if (!flyToTarget) return;
    const map = mapRef.current;
    if (!map) return;
    const { lon, lat } = flyToTarget;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      console.warn('[WeatherMap] Invalid flyToTarget coords:', lon, lat);
      setFlyToTarget(null);
      return;
    }
    map.flyTo({
      center: [lon, lat],
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

  /** Register all map icons when the map loads. */
  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    registerWindArrowIcons(map, 48);
    registerStationIcon(map);
    registerBuoyIcon(map);
    // Localize MapLibre navigation controls to Spanish
    requestAnimationFrame(() => {
      const container = map.getContainer();
      container.querySelector('.maplibregl-ctrl-zoom-in')?.setAttribute('aria-label', 'Acercar');
      container.querySelector('.maplibregl-ctrl-zoom-out')?.setAttribute('aria-label', 'Alejar');
      container.querySelector('.maplibregl-ctrl-compass')?.setAttribute('aria-label', 'Restablecer orientación norte');
    });
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden" role="region" aria-label="Mapa meteorológico interactivo de Galicia">
      <Map
        ref={mapRef}
        mapLib={maplibregl}
        initialViewState={activeSector.initialView}
        style={{ width: '100%', height: '100%' }}
        mapStyle={mapStyle}
        maxPitch={85}
        onClick={handleMapClick}
        onLoad={handleMapLoad}
        onMoveStart={handleMoveStart}
        onMoveEnd={(e) => {
          handleMoveEnd();
          // Defer zoom state update to avoid re-render spike right after pan ends
          const q = quantizeZoom(e.viewState.zoom);
          if (q !== zoomLevel) requestAnimationFrame(() => setZoomLevel(q));
        }}
      >
        <NavigationControl position="top-right" visualizePitch />
        {/* Localize MapLibre controls to Spanish after mount */}

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
        <WindFieldOverlay stations={stations} readings={currentReadings} buoys={activeSector.id === 'rias' ? buoys : undefined} compact={stations.length > 35} zoomLevel={zoomLevel} />

        {/* Temp-only station dots — GPU-accelerated (single source + 3 layers) */}
        <TempOnlyOverlay stations={stations} readings={currentReadings} />

        {/* Station markers — GPU symbol layer (replaces 90+ DOM markers) */}
        <StationSymbolLayer
          stations={stations}
          readings={currentReadings}
          selectedStationId={selectedStationId}
          onSelectStation={selectStation}
          zoomLevel={zoomLevel}
        />

        {/* Marine buoy markers — GPU circle+symbol layer (Rías only) */}
        {activeSector.id === 'rias' && (
          <BuoySymbolLayer
            buoys={buoys}
            selectedBuoyId={selectedBuoyId}
            onSelectBuoy={selectBuoy}
          />
        )}

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

        {/* AEMET Radar nacional — includes Cerceda/A Coruña */}
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
        {showSpotPopup && activeSpot && Number.isFinite(activeSpot.center?.[0]) && (
          <SpotPopup spot={activeSpot} score={spotScores.get(activeSpotId)} />
        )}

        {/* Distance measurement tool — line + markers rendered inside Map */}
        <DistanceTool mapRef={mapRef} isActive={distanceActive} onDeactivate={deactivateDistance} />
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
        <div className="fixed z-40 bottom-3 left-0 right-0 px-2 pb-[env(safe-area-inset-bottom,0px)] flex flex-col items-center gap-2 pointer-events-none">
          <div className="pointer-events-auto w-full flex justify-center">
            <AlertPanel />
          </div>
          <div className="flex items-center justify-center gap-1.5 max-w-full overflow-x-auto scrollbar-none pointer-events-auto">
            <StormIndicator />
            <TemperatureToggle />
            <WeatherLayerSelector />
            <button
              onClick={() => setDistanceActive((v) => !v)}
              className={`p-2 rounded-lg backdrop-blur-sm border transition-colors ${distanceActive ? 'bg-amber-600/80 border-amber-400/50 text-white' : 'bg-slate-800/80 border-slate-600/30 text-slate-300 hover:text-white'}`}
              title="Medir distancia"
              aria-label="Medir distancia"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/></svg>
            </button>
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
            <button
              onClick={() => setDistanceActive((v) => !v)}
              className={`p-2 rounded-lg backdrop-blur-sm border transition-colors ${distanceActive ? 'bg-amber-600/80 border-amber-400/50 text-white' : 'bg-slate-800/80 border-slate-600/30 text-slate-300 hover:text-white'}`}
              title="Medir distancia (nm)"
              aria-label="Medir distancia"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/></svg>
            </button>
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
