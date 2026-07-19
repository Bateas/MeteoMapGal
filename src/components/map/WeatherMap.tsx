import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import Map, { NavigationControl } from 'react-map-gl/maplibre';
import type { MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { useSectorStore } from '../../store/sectorStore';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';
import { useUIStore } from '../../store/uiStore';
import { useMapStyleStore, getStyleDef } from '../../store/mapStyleStore';
import { registerStationIcon } from './StationSymbolLayer';
import { registerWindArrowIcons } from './WindFieldOverlay';
// Station layers + selected-station popup subscribe to weatherStore THEMSELVES
// (per-poll commit isolation): currentReadings/stations get a new reference on
// every 60s poll — subscribing here would re-commit the whole map tree each poll.
import { ReadingsLayers, SelectedStationPopup } from './ReadingsLayers';
const ThermalZoneOverlay = lazy(() => import('./ThermalZoneOverlay').then(m => ({ default: m.ThermalZoneOverlay })));
const ThermalFlowOverlay = lazy(() => import('./ThermalFlowOverlay').then(m => ({ default: m.ThermalFlowOverlay })));
import { ThermalAlertMarkers } from './ThermalAlertMarker';
import { PropagationArrows } from './PropagationArrow';
// Heavy overlays: lazy-loaded (toggle/condition-gated, not needed at first paint)
const LightningOverlay = lazy(() => import('./LightningOverlay').then(m => ({ default: m.LightningOverlay })));
const StormClusterOverlay = lazy(() => import('./StormClusterOverlay').then(m => ({ default: m.StormClusterOverlay })));
const GustFrontOverlay = lazy(() => import('./GustFrontOverlay').then(m => ({ default: m.GustFrontOverlay })));
const ConvectionRiskOverlay = lazy(() => import('./ConvectionRiskOverlay').then(m => ({ default: m.ConvectionRiskOverlay })));
const FogOverlay = lazy(() => import('./FogOverlay').then(m => ({ default: m.FogOverlay })));
const WindRampOverlay = lazy(() => import('./WindRampOverlay').then(m => ({ default: m.WindRampOverlay })));
const HazeOverlay = lazy(() => import('./HazeOverlay').then(m => ({ default: m.HazeOverlay })));
const FireOverlay = lazy(() => import('./FireOverlay').then(m => ({ default: m.FireOverlay })));
const SmokePlumeOverlay = lazy(() => import('./SmokePlumeOverlay').then(m => ({ default: m.SmokePlumeOverlay })));
const AemetVisibilityHalo = lazy(() => import('./AemetVisibilityHalo').then(m => ({ default: m.AemetVisibilityHalo })));
const LightningRippleOverlay = lazy(() => import('./LightningRippleOverlay').then(m => ({ default: m.LightningRippleOverlay })));
const UpwellingOverlay = lazy(() => import('./UpwellingOverlay').then(m => ({ default: m.UpwellingOverlay })));
const SwanWaveOverlay = lazy(() => import('./SwanWaveOverlay').then(m => ({ default: m.SwanWaveOverlay })));
const StormIndicator = lazy(() => import('./StormIndicator').then(m => ({ default: m.StormIndicator })));
const AlertPanel = lazy(() => import('./AlertPanel').then(m => ({ default: m.AlertPanel })));
const WindParticleOverlay = lazy(() => import('./WindParticleOverlay').then(m => ({ default: m.WindParticleOverlay })));
const HumidityHeatmapOverlay = lazy(() => import('./HumidityHeatmapOverlay').then(m => ({ default: m.HumidityHeatmapOverlay })));
const IcaOverlay = lazy(() => import('./IcaOverlay').then(m => ({ default: m.IcaOverlay })));
const RadarOverlay = lazy(() => import('./RadarOverlay').then(m => ({ default: m.RadarOverlay })));
const CurrentsOverlay = lazy(() => import('./CurrentsOverlay').then(m => ({ default: m.CurrentsOverlay })));
const AirspaceOverlay = lazy(() => import('./AirspaceOverlay').then(m => ({ default: m.AirspaceOverlay })));
import { TemperatureOverlay } from './TemperatureOverlay';
import { TemperatureToggle } from './TemperatureToggle';
const BathymetryOverlay = lazy(() => import('./BathymetryOverlay').then(m => ({ default: m.BathymetryOverlay })));
const SSTOverlay = lazy(() => import('./SSTOverlay').then(m => ({ default: m.SSTOverlay })));
import { SSTLegend } from './SSTLegend';
import { WeatherLayerSelector } from './WeatherLayerSelector';
import { MapStyleSelector } from './MapStyleSelector';
import { SailingConditionBanner } from './SailingConditionBanner';
import { CriticalAlertBanner } from './CriticalAlertBanner';
import { LightningProximityBanner } from './LightningProximityBanner';
import { SectorSelector } from './SectorSelector';
import { MapContextMenu } from './MapContextMenu';
import { BuoySymbolLayer, registerBuoyIcon } from './BuoySymbolLayer';
import { BuoyPopup } from './BuoyPopup';
import { SpotMarkers } from './SpotMarker';
import { UserSpotMarkers } from './UserSpotMarkers';
const SpotPopup = lazy(() => import('./SpotPopup').then(m => ({ default: m.SpotPopup })));
const UserSpotPopup = lazy(() => import('../spot/UserSpotPopup').then(m => ({ default: m.UserSpotPopup })));
const SeamarksOverlay = lazy(() => import('./SeamarksOverlay').then(m => ({ default: m.SeamarksOverlay })));
const NauticalChartOverlay = lazy(() => import('./NauticalChartOverlay').then(m => ({ default: m.NauticalChartOverlay })));
import { IGNHillshadeOverlay } from './IGNHillshadeOverlay';
import { IGNContoursOverlay } from './IGNContoursOverlay';
import { IGNOrthoOverlay } from './IGNOrthoOverlay';
import { DistanceTool } from './DistanceTool';
const AviationOverlay = lazy(() => import('./AviationOverlay').then(m => ({ default: m.AviationOverlay })));
import { RegattaOverlay } from './RegattaOverlay';
const RegattaPanel = lazy(() => import('./RegattaPanel').then(m => ({ default: m.RegattaPanel })));
import { useRegattaStore } from '../../store/regattaStore';
import { useBuoyStore } from '../../store/buoyStore';
import { useSpotStore } from '../../store/spotStore';
import { useUserSpotStore } from '../../store/userSpotStore';
import { useToastStore } from '../../store/toastStore';
import { isInGalicia, MAX_USER_SPOTS } from '../../config/userSpots';
// Audit S136+3 #7: useAviationData, useSurfMarineData, useWebcamVisionData
// moved to DeferredHooks — they fetch from external services and don't need
// to fire on critical-path mount. Stores they write to are still read here.
import { WebcamSymbolLayer, registerWebcamIcon } from './WebcamSymbolLayer';
import { WebcamPopup } from './WebcamPopup';
import { useWebcamStore } from '../../store/webcamStore';
import { getWebcamsForSector } from '../../config/webcams';

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
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const isCoastal = useSectorStore((s) => s.activeSector.coastal);
  const sectorInitialView = useSectorStore((s) => s.activeSector.initialView);
  const activeStyleId = useMapStyleStore((s) => s.activeStyleId);
  const mapStyle = useMemo(() => buildMapStyle(activeStyleId), [activeStyleId]);
  // NOTE: WeatherMap intentionally does NOT subscribe to weatherStore
  // stations/currentReadings — ReadingsLayers/SelectedStationPopup do (per-poll
  // commit isolation, see ReadingsLayers.tsx).
  const selectedStationId = useWeatherSelectionStore((s) => s.selectedStationId);
  const selectStation = useWeatherSelectionStore((s) => s.selectStation);
  const isMobile = useUIStore((s) => s.isMobile);
  const simpleMode = useUIStore((s) => s.simpleMode);

  // Buoy data from shared store (populated by BuoyPanel in Rías Baixas sector)
  const buoys = useBuoyStore((s) => s.buoys);
  const selectedBuoyId = useBuoyStore((s) => s.selectedBuoyId);
  const selectBuoy = useBuoyStore((s) => s.selectBuoy);
  const selectedBuoy = useMemo(
    () => buoys.find((b) => b.stationId === selectedBuoyId),
    [buoys, selectedBuoyId],
  );

  // Spot state
  const activeSpotId = useSpotStore((s) => s.activeSpotId);
  const activeSpot = useSpotStore((s) => s.activeSpot);
  const spotScores = useSpotStore((s) => s.scores);
  const selectSpot = useSpotStore((s) => s.selectSpot);
  const showSpotPopup = activeSpotId !== '';

  // User-created "chincheta" spots (isolated from the official pipeline)
  const userSpots = useUserSpotStore((s) => s.userSpots);
  const selectedUserSpotId = useUserSpotStore((s) => s.selectedUserSpotId);
  const userScores = useUserSpotStore((s) => s.scores);
  const selectUserSpot = useUserSpotStore((s) => s.selectUserSpot);
  const addUserSpot = useUserSpotStore((s) => s.addUserSpot);
  const selectedUserSpot = useMemo(
    () => userSpots.find((u) => u.id === selectedUserSpotId),
    [userSpots, selectedUserSpotId],
  );

  // Webcam state
  const showWebcams = useWebcamStore((s) => s.showOverlay);
  const selectedWebcamId = useWebcamStore((s) => s.selectedWebcamId);
  const selectWebcam = useWebcamStore((s) => s.selectWebcam);
  const sectorWebcams = useMemo(() => getWebcamsForSector(sectorId), [sectorId]);
  const selectedWebcam = sectorWebcams.find((c) => c.id === selectedWebcamId) ?? null;

  const flyToTarget = useUIStore((s) => s.flyToTarget);
  const setFlyToTarget = useUIStore((s) => s.setFlyToTarget);

  // Moved to DeferredHooks (audit S136+3 #7)

  // Regatta mode: fade non-essential elements.
  // CSS class handles DOM markers (.maplibregl-marker).
  // setPaintProperty handles native GPU layers — but on deactivate we MUST restore
  // the original data-driven freshness expressions, NOT a flat 1 (which destroys them
  // and makes stale stations appear fully opaque).
  const regattaActive = useRegattaStore((s) => s.active && s.zone !== null);
  useEffect(() => {
    containerRef.current?.classList.toggle('regatta-active', regattaActive);
    const map = mapRef.current?.getMap();
    if (!map) return;

    if (regattaActive) {
      // Dim all station/buoy layers uniformly
      for (const id of ['stations-icons', 'stations-names', 'stations-source-ring', 'buoys-icons']) {
        try {
          if (!map.getLayer(id)) continue;
          const isSymbol = map.getLayer(id)?.type === 'symbol';
          map.setPaintProperty(id, isSymbol ? 'icon-opacity' : 'circle-opacity', 0.3);
          map.setPaintProperty(id, isSymbol ? 'text-opacity' : 'circle-stroke-opacity', 0.3);
        } catch { /* layer may not exist yet */ }
      }
    } else {
      // Restore original freshness-based expressions (must match StationSymbolLayer / BuoySymbolLayer)
      try {
        if (map.getLayer('stations-icons')) {
          map.setPaintProperty('stations-icons', 'icon-opacity', [
            'step', ['get', 'freshness'],
            0.0, 0.15, 0.08, 0.3, 0.25, 0.6, 0.45, 0.85, 0.8,
          ]);
          map.setPaintProperty('stations-icons', 'text-opacity', [
            'step', ['get', 'freshness'],
            0.0, 0.15, 0.1, 0.3, 0.25, 0.6, 0.5, 0.85, 1.0,
          ]);
        }
        if (map.getLayer('stations-names')) {
          map.setPaintProperty('stations-names', 'text-opacity', [
            'step', ['get', 'freshness'],
            0.0, 0.15, 0.1, 0.3, 0.25, 0.6, 0.5, 0.85, 1.0,
          ]);
        }
        if (map.getLayer('stations-source-ring')) {
          map.setPaintProperty('stations-source-ring', 'circle-opacity', [
            'step', ['get', 'freshness'],
            0.0, 0.15, 0.08, 0.3, 0.2, 0.6, 0.35, 0.85, 0.7,
          ]);
          map.setPaintProperty('stations-source-ring', 'circle-stroke-opacity', [
            'step', ['get', 'freshness'],
            0.0, 0.15, 0.08, 0.3, 0.2, 0.6, 0.35, 0.85, 0.7,
          ]);
        }
        if (map.getLayer('buoys-icons')) {
          map.setPaintProperty('buoys-icons', 'icon-opacity', ['*', ['get', 'freshness'], 0.75]);
        }
      } catch { /* layers may not exist */ }
    }
  }, [regattaActive]);

  // Track zoom level for label visibility — quantized to visual breakpoints
  // to avoid re-rendering ~84 markers on every 0.1 zoom change
  const [zoomLevel, setZoomLevel] = useState(sectorInitialView.zoom);
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

  // "Crear spot" placement mode — tap the map to drop a user pin. Visible,
  // tap-based (works identically on mobile + desktop), discoverable via the
  // toolbar button. Mutually exclusive with the distance tool.
  const [placingSpot, setPlacingSpot] = useState(false);
  const togglePlacingSpot = useCallback(() => {
    setPlacingSpot((v) => {
      if (!v) setDistanceActive(false);
      return !v;
    });
  }, []);
  // Crosshair cursor while placing, so it's clear the next tap drops a pin.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    map.getCanvas().style.cursor = placingSpot ? 'crosshair' : '';
    return () => {
      const m = mapRef.current?.getMap();
      if (m) m.getCanvas().style.cursor = '';
    };
  }, [placingSpot]);

  // Hide markers during map drag for smooth panning (95 DOM markers = jank)
  // Uses DOM class toggle instead of React state to avoid re-rendering ~100 markers
  const containerRef = useRef<HTMLDivElement>(null);
  const handleMoveStart = useCallback(() => {
    containerRef.current?.classList.add('map-panning');
    // Hide the hillshade layer during the drag — its per-pixel DEM shader is the
    // biggest unconditional GPU cost per frame and is imperceptible mid-pan.
    // Hillshade is a SEPARATE layer from the 3D terrain mesh, so toggling only
    // its visibility does NOT touch setTerrain (avoids the terrain-flatten race).
    const map = mapRef.current?.getMap();
    if (map?.getLayer('hillshade')) map.setLayoutProperty('hillshade', 'visibility', 'none');
  }, []);
  const handleMoveEnd = useCallback(() => {
    containerRef.current?.classList.remove('map-panning');
    const map = mapRef.current?.getMap();
    if (map?.getLayer('hillshade')) map.setLayoutProperty('hillshade', 'visibility', 'visible');
  }, []);

  // Cross-deselection: only one popup at a time (station XOR buoy XOR spot XOR webcam).
  const prevBuoyRef = useRef<number | null>(null);
  const prevStationRef = useRef<string | null>(null);
  const prevSpotRef = useRef<string>('');
  const prevWebcamRef = useRef<string | null>(null);
  useEffect(() => {
    const spotChanged = activeSpotId !== prevSpotRef.current;
    const buoyChanged = selectedBuoyId !== prevBuoyRef.current;
    const stationChanged = selectedStationId !== prevStationRef.current;
    const webcamChanged = selectedWebcamId !== prevWebcamRef.current;

    if (webcamChanged && selectedWebcamId) {
      if (selectedStationId) selectStation(null);
      if (selectedBuoyId != null) selectBuoy(null);
      if (activeSpotId) selectSpot('');
    } else if (spotChanged && activeSpotId) {
      if (selectedStationId) selectStation(null);
      if (selectedBuoyId != null) selectBuoy(null);
      if (selectedWebcamId) selectWebcam(null);
    } else if (stationChanged && selectedStationId) {
      if (selectedBuoyId != null) selectBuoy(null);
      if (activeSpotId) selectSpot('');
      if (selectedWebcamId) selectWebcam(null);
    } else if (buoyChanged && selectedBuoyId != null) {
      if (selectedStationId) selectStation(null);
      if (activeSpotId) selectSpot('');
      if (selectedWebcamId) selectWebcam(null);
    }

    prevBuoyRef.current = selectedBuoyId;
    prevStationRef.current = selectedStationId;
    prevSpotRef.current = activeSpotId;
    prevWebcamRef.current = selectedWebcamId;
  }, [selectedBuoyId, selectedStationId, activeSpotId, selectedWebcamId, selectStation, selectBuoy, selectSpot, selectWebcam]);

  /** Fly to sector view when it changes — and close any popup that belongs
   *  to the previous sector (spots, stations, buoys, webcams). Without this
   *  reset, a selection persists across sector switches and re-opens when
   *  the user returns to the original sector (audit — first
   *  reported as the Cesantes auto-open bug, extended to all map selections
   *  because they share the same leakage pattern). */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (activeSpotId) selectSpot('');
    if (selectedStationId) selectStation(null);
    if (selectedBuoyId != null) selectBuoy(null);
    if (selectedWebcamId) selectWebcam(null);
    if (selectedUserSpotId) selectUserSpot(null);
    setPlacingSpot(false); // exit "Crear spot" placement mode on sector switch
    const { longitude, latitude, zoom, pitch, bearing } = sectorInitialView;
    map.flyTo({
      center: [longitude, latitude],
      zoom,
      pitch,
      bearing,
      duration: 2000,
    });
  // initialView is derived from sector id (immutable configs), but include it
  // so the linter sees all values used inside the effect are listed.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- selection getters/setters intentionally omitted: only react to sector changes
  }, [sectorId, sectorInitialView]);

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

  const handleMapClick = useCallback((e: MapLayerMouseEvent) => {
    // Placement mode: the tap drops a user pin here instead of deselecting.
    if (placingSpot) {
      const { lng, lat } = e.lngLat;
      const addToast = useToastStore.getState().addToast;
      if (!isInGalicia(lng, lat)) {
        addToast('Solo puedes crear spots dentro de Galicia', 'warning');
      } else {
        const created = addUserSpot(lng, lat, sectorId);
        addToast(
          created
            ? 'Spot creado (sin calibrar). Toca el pin para verlo o sugerirlo.'
            : `Máximo ${MAX_USER_SPOTS} spots propios. Elimina alguno primero.`,
          created ? 'success' : 'warning',
        );
      }
      setPlacingSpot(false);
      return;
    }
    selectStation(null);
    selectBuoy(null);
    selectSpot('');
    selectUserSpot(null);
  }, [placingSpot, addUserSpot, sectorId, selectStation, selectBuoy, selectSpot, selectUserSpot]);

  // Mutual exclusion: opening an official spot popup closes any user-spot popup.
  useEffect(() => {
    if (activeSpotId && selectedUserSpotId) selectUserSpot(null);
  }, [activeSpotId, selectedUserSpotId, selectUserSpot]);

  /** Register all custom SDF/raster icons. Idempotent (each register*
   *  guards with map.hasImage). Must run on initial load AND after every
   *  setStyle — MapLibre wipes addImage() icons on a style rebuild.
   *
   *  Aircraft icon (audit): lives in the lazy AviationOverlay
   *  chunk, so we dynamic-import it. Only Embalse + regatta surface aviation,
   *  so we gate the import to avoid pulling that chunk for Rías-only users.
   *  Fire-and-forget — the registrar is idempotent. */
  const registerAllIcons = useCallback((map: maplibregl.Map) => {
    registerWindArrowIcons(map, 48);
    registerStationIcon(map);
    registerBuoyIcon(map);
    registerWebcamIcon(map);
    if (sectorId === 'embalse' || regattaActive) {
      import('./AviationOverlay').then(({ registerAircraftIcon }) => registerAircraftIcon(map));
    }
  }, [sectorId, regattaActive]);

  /** Register all map icons when the map loads. */
  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    registerAllIcons(map);
    // CRITICAL: `onLoad` fires ONCE. A base-map switch or sector change
    // rebuilds mapStyle → react-map-gl calls map.setStyle() → MapLibre
    // destroys every addImage() icon (station-circle, wind arrows, buoy,
    // webcam). Without re-registering, the symbol layers render with a
    // missing icon-image → markers vanish SILENTLY (no JS error). The
    // `style.load` event fires after every setStyle (and the initial load),
    // so re-running the idempotent registrars there keeps markers alive
    // across any style rebuild.
    map.on('style.load', () => registerAllIcons(map));
    // Localize MapLibre navigation controls to Spanish
    requestAnimationFrame(() => {
      const container = map.getContainer();
      container.querySelector('.maplibregl-ctrl-zoom-in')?.setAttribute('aria-label', 'Acercar');
      container.querySelector('.maplibregl-ctrl-zoom-out')?.setAttribute('aria-label', 'Alejar');
      container.querySelector('.maplibregl-ctrl-compass')?.setAttribute('aria-label', 'Restablecer orientación norte');
    });
  }, [registerAllIcons]);

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden" role="region" aria-label="Mapa meteorológico interactivo de Galicia" style={{ contain: 'layout style paint' }}>
      <Map
        ref={mapRef}
        mapLib={maplibregl}
        initialViewState={sectorInitialView}
        style={{ width: '100%', height: '100%' }}
        mapStyle={mapStyle}
        maxPitch={85}
        // Regional app — never need to zoom out past NW Iberia. Without a floor,
        // zooming "out to the world" forced MapLibre to load global vector tiles
        // + place every world label (addSymbols) + the DEM, causing a hard hitch
        // (user-reported). minZoom 6 still shows all of Galicia + margin.
        minZoom={6}
        // No horizontal world repetition (extra tiles at low zoom, never useful here).
        renderWorldCopies={false}
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

        {/* IHM nautical chart — coastal sectors only, below everything except base tiles */}
        {isCoastal && <Suspense fallback={null}><NauticalChartOverlay /></Suspense>}

        {/* OpenSeaMap seamarks — coastal sectors only, above nautical chart, below weather overlays */}
        {isCoastal && <Suspense fallback={null}><SeamarksOverlay /></Suspense>}

        {/* IGN terrain overlays — available in both sectors */}
        <IGNOrthoOverlay />
        <IGNHillshadeOverlay />
        <IGNContoursOverlay />

        {/* EMODnet bathymetry — seabed depth tiles (Rías only, below all other layers) */}
        <Suspense fallback={null}><BathymetryOverlay /></Suspense>

        {/* CMEMS SST — sea surface temperature tiles (Rías only) */}
        <Suspense fallback={null}><SSTOverlay /></Suspense>

        {/* Thermal zone polygons — only for Embalse sector */}
        {sectorId === 'embalse' && <Suspense fallback={null}><ThermalZoneOverlay /></Suspense>}
        {sectorId === 'embalse' && <Suspense fallback={null}><ThermalFlowOverlay /></Suspense>}

        {/* Temperature gradient circles + lapse-rate lines (below wind arrows) */}
        <TemperatureOverlay />

        {/* Wind arrows + temp dots + station markers — wrapper subscribes to
            weatherStore itself so the 60s poll only re-commits these layers,
            not the whole map tree (per-poll commit isolation). Renders in the
            exact same order the three layers had here before. */}
        <ReadingsLayers
          simpleMode={simpleMode}
          buoys={isCoastal ? buoys : undefined}
          zoomLevel={zoomLevel}
          selectedStationId={selectedStationId}
          onSelectStation={selectStation}
        />

        {/* Marine buoy markers — GPU circle+symbol layer (coastal sectors only) */}
        {isCoastal && (
          <BuoySymbolLayer
            buoys={buoys}
            selectedBuoyId={selectedBuoyId}
            onSelectBuoy={selectBuoy}
          />
        )}

        {/* Webcam markers — triangles rotated by azimuth */}
        {showWebcams && sectorWebcams.length > 0 && (
          <WebcamSymbolLayer
            webcams={sectorWebcams}
            selectedWebcamId={selectedWebcamId}
            onSelectWebcam={selectWebcam}
          />
        )}

        {/* Sailing spot markers — both sectors */}
        <SpotMarkers />

        {/* User-created "chincheta" spots — dashed pins, below official spots */}
        <UserSpotMarkers />

        {/* Thermal alert badges + propagation — only for Embalse sector */}
        {sectorId === 'embalse' && (
          <>
            <ThermalAlertMarkers />
            <PropagationArrows />
          </>
        )}

        {/* Fog overlay — terrain-based valley fill when fog detected */}
        <Suspense fallback={null}><FogOverlay /></Suspense>

        {/* Official AEMET visibility halo — pale glow at airports/coastal stations
            reporting vis<2km. DEM-aware: only paints valley/coast, not hilltops. */}
        <Suspense fallback={null}><AemetVisibilityHalo /></Suspense>

        {/* Wind ramp pulse — stations glow when wind increases +6kt/30min */}
        <Suspense fallback={null}><WindRampOverlay /></Suspense>

        {/* Smoke plumes downwind of fires — rendered BEFORE FireOverlay so flame markers overlay smoke */}
        <Suspense fallback={null}><SmokePlumeOverlay /></Suspense>

        {/* NASA FIRMS active wildfires (Galicia + buffer). Auto-shows when fires present */}
        <Suspense fallback={null}><FireOverlay /></Suspense>

        {/* EMODnet bathymetry + coastline — professional marine data (Rías only) */}
        <Suspense fallback={null}><UpwellingOverlay /></Suspense>

        {/* SWAN nearshore wave model — real wave propagation inside rías (#56 v4) */}
        <Suspense fallback={null}><SwanWaveOverlay /></Suspense>

        {/* Storm cluster masses + radius rings (below strikes) */}
        <Suspense fallback={null}><ConvectionRiskOverlay /></Suspense>
        <Suspense fallback={null}><StormClusterOverlay /></Suspense>
        <Suspense fallback={null}><GustFrontOverlay /></Suspense>

        {/* Lightning strikes overlay */}
        <Suspense fallback={null}><LightningOverlay /></Suspense>

        {/* Ripple animation on every NEW lightning strike (last 30s) */}
        <Suspense fallback={null}><LightningRippleOverlay /></Suspense>

        {/* AEMET Radar nacional — includes Cerceda/A Coruña */}
        <Suspense fallback={null}><RadarOverlay /></Suspense>

        {/* RADAR ON RAIA — HF radar surface currents (Rías Baixas only) */}
        <Suspense fallback={null}><CurrentsOverlay /></Suspense>

        {/* ENAIRE airspace zones + NOTAMs — only visible when Dron tab is active */}
        <Suspense fallback={null}><AirspaceOverlay /></Suspense>

        {/* Aviation aircraft monitoring — Embalse always, Rías during events */}
        {(sectorId === 'embalse' || regattaActive) && <Suspense fallback={null}><AviationOverlay /></Suspense>}

        {/* Regatta/Event mode — zone + buoy markers */}
        <RegattaOverlay />

        {/* Selected station popup — reads stations/readings from the store
            itself (per-poll commit isolation, see ReadingsLayers.tsx) */}
        <SelectedStationPopup selectedStationId={selectedStationId} />

        {/* Selected buoy popup — coastal sectors only */}
        {isCoastal && selectedBuoy && (
          <BuoyPopup reading={selectedBuoy} />
        )}

        {/* Selected webcam popup */}
        {selectedWebcam && (
          <WebcamPopup webcam={selectedWebcam} onClose={() => selectWebcam(null)} />
        )}

        {/* Selected spot popup */}
        {showSpotPopup && activeSpot && Number.isFinite(activeSpot.center?.[0]) && (
          <Suspense fallback={null}><SpotPopup spot={activeSpot} score={spotScores.get(activeSpotId)} /></Suspense>
        )}

        {/* Selected user-spot popup */}
        {selectedUserSpot && (
          <Suspense fallback={null}>
            <UserSpotPopup spot={selectedUserSpot} score={userScores.get(selectedUserSpot.id)} />
          </Suspense>
        )}

        {/* Distance measurement tool — line + markers rendered inside Map */}
        <DistanceTool mapRef={mapRef} isActive={distanceActive} onDeactivate={deactivateDistance} />
      </Map>

      {/* Canvas overlays on top of map (need project/unproject) */}
      <Suspense fallback={null}><WindParticleOverlay mapRef={mapRef} /></Suspense>
      <Suspense fallback={null}><HumidityHeatmapOverlay mapRef={mapRef} /></Suspense>
      {/* Air-quality heatmap — auto-activates when any station reports ICA ≥ 3 */}
      <Suspense fallback={null}><IcaOverlay mapRef={mapRef} /></Suspense>

      {/* Right-click context menu */}
      <MapContextMenu mapRef={mapRef} />

      {/* HTML overlays on top of map */}
      {/* Haze/calima overlay — DOM tint outside <Map>, auto-activates on Saharan dust */}
      <Suspense fallback={null}><HazeOverlay /></Suspense>

      <SectorSelector />
      <MapStyleSelector />
      <SSTLegend />
      {/* SpotScoreLegend removed — verdict info visible on each spot badge. Revisit if needed for specific modes */}
      {sectorId === 'embalse' && <SailingConditionBanner />}
      <CriticalAlertBanner />
      <LightningProximityBanner />

      {/* "Crear spot" placement-mode hint — transient, while choosing the spot */}
      {placingSpot && (
        <div className="absolute z-40 top-16 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-violet-600/90 text-white text-xs font-semibold shadow-lg backdrop-blur-sm border border-violet-300/50 whitespace-nowrap">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
            Toca el mapa donde quieras crear tu spot
          </div>
        </div>
      )}

      {/* Regatta/Event mode panel — lazy loaded (only used in event mode) */}
      <Suspense fallback={null}>
        <RegattaPanel />
      </Suspense>

      {/* ── Bottom controls: toolbar + alerts ── */}
      {isMobile ? (
        /* Mobile: FIXED positioning to escape MapLibre's stacking context.
           absolute z-20 renders behind the canvas; fixed z-30 floats above it
           (same pattern as MobileSailingBanner). */
        <div className="fixed z-40 left-0 right-0 px-2 flex flex-col items-center gap-2 pointer-events-none"
          style={{ bottom: isMobile ? 'calc(52px + env(safe-area-inset-bottom, 0px))' : '0.75rem', paddingBottom: isMobile ? undefined : 'env(safe-area-inset-bottom, 0px)' }}>
          <div className="pointer-events-auto w-full flex justify-center">
            <Suspense fallback={null}><AlertPanel /></Suspense>
          </div>
          <div className="flex items-center justify-center gap-1.5 max-w-full overflow-x-auto scrollbar-none pointer-events-auto">
            <Suspense fallback={null}><StormIndicator /></Suspense>
            <TemperatureToggle />
            {!simpleMode && <WeatherLayerSelector />}
            <button
              onClick={() => { setDistanceActive((v) => !v); setPlacingSpot(false); }}
              className={`p-2 rounded-lg border transition-colors ${distanceActive ? 'bg-amber-600/80 border-amber-400/50 text-white' : 'bg-slate-800 border-slate-600/30 text-slate-300 hover:text-white'}`}
              title="Medir distancia"
              aria-label="Medir distancia"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/></svg>
            </button>
            <button
              onClick={togglePlacingSpot}
              className={`flex items-center gap-1 px-2.5 py-2 rounded-lg border transition-colors text-xs font-semibold ${placingSpot ? 'bg-violet-600/85 border-violet-400/60 text-white' : 'bg-slate-800 border-slate-600/30 text-violet-300 hover:text-white'}`}
              title="Crear un spot propio (sin calibrar)"
              aria-label="Crear spot"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
              Spot
            </button>
          </div>
        </div>
      ) : (
        /* Desktop: single flex row — toolbar left, alerts fill remaining space */
        <div className="absolute z-30 bottom-2 left-2 right-2 flex items-end gap-3">
          {/* Toolbar: shrinks to fit, never overlapped */}
          <div className="flex items-end gap-2 shrink-0">
            <Suspense fallback={null}><StormIndicator /></Suspense>
            <TemperatureToggle />
            {!simpleMode && <WeatherLayerSelector />}
            <button
              onClick={() => { setDistanceActive((v) => !v); setPlacingSpot(false); }}
              className={`p-2 rounded-lg border transition-colors ${distanceActive ? 'bg-amber-600/80 border-amber-400/50 text-white' : 'bg-slate-800 border-slate-600/30 text-slate-300 hover:text-white'}`}
              title="Medir distancia (nm)"
              aria-label="Medir distancia"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/></svg>
            </button>
            <button
              onClick={togglePlacingSpot}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border transition-colors text-xs font-semibold ${placingSpot ? 'bg-violet-600/85 border-violet-400/60 text-white' : 'bg-slate-800 border-slate-600/30 text-violet-300 hover:text-white'}`}
              title="Crear un spot propio (sin calibrar) — toca el mapa para colocarlo"
              aria-label="Crear spot"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
              Crear spot
            </button>
          </div>

          {/* Alerts: fills remaining width, centered within its space */}
          <div className="flex-1 min-w-0 flex justify-center">
            <div className="max-w-2xl w-full">
              <Suspense fallback={null}><AlertPanel /></Suspense>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
