import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import Map, { NavigationControl } from 'react-map-gl/maplibre';
import type { MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { useSectorStore } from '../../store/sectorStore';
import { useWeatherSelectionStore } from '../../store/weatherSelectionStore';
import { useCssVarFromElement } from '../../hooks/useCssVarFromElement';
import { useMarkerTabOrder } from './useMarkerTabOrder';
import { useUIStore } from '../../store/uiStore';
import { useMapStyleStore, getStyleDef, resolveStyleId } from '../../store/mapStyleStore';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import type { MapStyleId } from '../../store/mapStyleStore';
import { useThemeStore } from '../../store/themeStore';
import { registerStationIcon } from './StationSymbolLayer';
import { registerWindArrowIcons } from './WindFieldOverlay';
// Station layers + selected-station popup subscribe to weatherStore THEMSELVES
// (per-poll commit isolation): currentReadings/stations get a new reference on
// every 60s poll — subscribing here would re-commit the whole map tree each poll.
import { ReadingsLayers, SelectedStationPopup } from './ReadingsLayers';
// Heavy overlays: lazy-loaded (toggle/condition-gated, not needed at first paint)
const LightningOverlay = lazy(() => import('./LightningOverlay').then(m => ({ default: m.LightningOverlay })));
const StormClusterOverlay = lazy(() => import('./StormClusterOverlay').then(m => ({ default: m.StormClusterOverlay })));
const GustFrontOverlay = lazy(() => import('./GustFrontOverlay').then(m => ({ default: m.GustFrontOverlay })));
const FogOverlay = lazy(() => import('./FogOverlay').then(m => ({ default: m.FogOverlay })));
const WindRampOverlay = lazy(() => import('./WindRampOverlay').then(m => ({ default: m.WindRampOverlay })));
const FireOverlay = lazy(() => import('./FireOverlay').then(m => ({ default: m.FireOverlay })));
const AemetVisibilityHalo = lazy(() => import('./AemetVisibilityHalo').then(m => ({ default: m.AemetVisibilityHalo })));
const SwanWaveOverlay = lazy(() => import('./SwanWaveOverlay').then(m => ({ default: m.SwanWaveOverlay })));
const AlertPanel = lazy(() => import('./AlertPanel').then(m => ({ default: m.AlertPanel })));
const WindParticleOverlay = lazy(() => import('./WindParticleOverlay').then(m => ({ default: m.WindParticleOverlay })));
const RadarOverlay = lazy(() => import('./RadarOverlay').then(m => ({ default: m.RadarOverlay })));
const RainNowOverlay = lazy(() => import('./RainNowOverlay').then(m => ({ default: m.RainNowOverlay })));
const RainNowChip = lazy(() => import('./RainNowChip').then(m => ({ default: m.RainNowChip })));
import { TemperatureOverlay } from './TemperatureOverlay';
import { WeatherLayerSelector } from './WeatherLayerSelector';
import { WeatherIcon } from '../icons/WeatherIcons';
import { MapStyleSelector } from './MapStyleSelector';
import { CriticalAlertBanner } from './CriticalAlertBanner';
import { LightningProximityBanner } from './LightningProximityBanner';
import { LightningDataChip } from './LightningDataChip';
import { BuoySymbolLayer, registerBuoyIcon } from './BuoySymbolLayer';
import { BuoyPopup } from './BuoyPopup';
import { SpotMarkers } from './SpotMarker';
import { UserSpotMarkers } from './UserSpotMarkers';
const SpotPopup = lazy(() => import('./SpotPopup').then(m => ({ default: m.SpotPopup })));
const UserSpotPopup = lazy(() => import('../spot/UserSpotPopup').then(m => ({ default: m.UserSpotPopup })));
const MeteoPointPopup = lazy(() => import('../spot/MeteoPointPopup').then(m => ({ default: m.MeteoPointPopup })));
const NauticalChartOverlay = lazy(() => import('./NauticalChartOverlay').then(m => ({ default: m.NauticalChartOverlay })));
import { DistanceTool } from './DistanceTool';
import { useBuoyStore } from '../../store/buoyStore';
import { useSpotStore } from '../../store/spotStore';
import { spotFitsSector } from '../../config/spots';
import { useUserSpotStore } from '../../store/userSpotStore';
import { useToastStore } from '../../store/toastStore';
import { isInGalicia, MAX_USER_SPOTS, withMeteoPoints } from '../../config/userSpots';
// useSurfMarineData, useWebcamVisionData
// moved to DeferredHooks — they fetch from external services and don't need
// to fire on critical-path mount. Stores they write to are still read here.
import { WebcamSymbolLayer, registerWebcamIcon } from './WebcamSymbolLayer';
import { WebcamPopup } from './WebcamPopup';
import { useWebcamStore } from '../../store/webcamStore';
import { getWebcamsForSector } from '../../config/webcams';
import { PwaInstallBanner } from '../common/PwaInstallBanner';
import { NewVersionBanner } from '../common/NewVersionBanner';
import { TERRARIUM_TILE_URL } from '../../api/demElevation';
import { MAP_LOCALE } from '../../config/mapLocale';

const RELIEF_MAXZOOM = 10;

/** Below this the notices and a docked card cannot share the top of the map: card 384 + notice 320 + tools 170. */
const NARROW_MAP_PX = 874;

/** Place names over the dark canvas (0.65 on every other map). */
const DARK_LABEL_OPACITY = 0.85;
/** The dark canvas, a step clearer: see buildMapStyle. */
const DARK_BASE_PAINT = { 'raster-brightness-min': 0.05, 'raster-contrast': 0.18 } as const;

/** Build a MapLibre StyleSpecification for the given base map style + 3D terrain */
function buildMapStyle(styleId: MapStyleId): maplibregl.StyleSpecification {
  const def = getStyleDef(styleId);
  const isDark = styleId === 'dark';
  // Place names go above the relief so the shading never dims them. The data
  // overlays are added later, by react-map-gl, so they still sit above both.
  const labels: Pick<maplibregl.StyleSpecification, 'sources' | 'layers'> = def.labelTiles
    ? {
        sources: {
          'base-labels': {
            type: 'raster',
            tiles: def.labelTiles,
            tileSize: def.tileSize,
            maxzoom: def.maxzoom,
          },
        },
        // 0.65: town names are context. At full strength "Redondela" read
        // louder than the spot "Cesantes" next to it. On the dark canvas the same 0.65 left them
        // all but unreadable (grey on near-black): there they go a step up.
        layers: [{ id: 'base-labels', type: 'raster', source: 'base-labels', paint: { 'raster-opacity': isDark ? DARK_LABEL_OPACITY : 0.65 } }],
      }
    : { sources: {}, layers: [] };
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
      ...labels.sources,
      terrainDEM: {
        type: 'raster-dem',
        // Same tiles the fog surfaces read for ground altitude (demElevation).
        tiles: [TERRARIUM_TILE_URL],
        encoding: 'terrarium',
        tileSize: 256,
        // The relief is decoration and was 55 % of the bytes of a first visit on a phone: 1.7 MB, because the
        // shading also asks for the neighbours of each tile. A level less costs a quarter of the tiles.
        maxzoom: RELIEF_MAXZOOM,
      },
    },
    layers: [
      {
        id: 'base-tiles',
        type: 'raster',
        source: 'base-tiles',
        // The dark canvas is land and water in two near-blacks: the ría did not read. A little more
        // contrast and a lifted floor separate them with the same tiles. The other maps are untouched.
        ...(isDark ? { paint: DARK_BASE_PAINT } : {}),
      },
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'terrainDEM',
        paint: {
          'hillshade-shadow-color': isDark ? '#000000' : '#473B24',
          'hillshade-highlight-color': isDark ? '#333333' : '#FFFFFF',
          'hillshade-illumination-direction': 315,
          // The light grey canvas is flat, so full relief (0.55) read as
          // crumpled paper and buried the grey calm spots. The coloured maps
          // (streets, topo) keep it.
          'hillshade-exaggeration': isDark ? 0.35 : styleId === 'positron' ? 0.3 : 0.55,
        },
      },
      ...labels.layers,
    ],
    // NO `terrain` and NO `sky` here on purpose: the map is flat 2D. The 3D
    // mesh plus the atmospheric haze rendered on every pan frame and were the
    // dominant GPU cost. Relief still reads through the `hillshade` layer
    // above (shaded, flat, and hidden during pan). The terrainDEM source is
    // only for hillshade: terrain is never switched on. The fog surfaces read
    // ground altitude from the same tiles themselves (api/demElevation) —
    // terrain made every pointer move and marker read pixels back from the GPU.
  };
}

export function WeatherMap() {
  const mapRef = useRef<MapRef | null>(null);
  /** A sector switch arrived before the map existed; applied on load. */
  const pendingSectorViewRef = useRef(false);
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const isCoastal = useSectorStore((s) => s.activeSector.coastal);
  const sectorInitialView = useSectorStore((s) => s.activeSector.initialView);
  const styleChoice = useMapStyleStore((s) => s.activeStyleId);
  const theme = useThemeStore((s) => s.theme);
  const activeStyleId = resolveStyleId(styleChoice, theme);
  const mapStyle = useMemo(() => buildMapStyle(activeStyleId), [activeStyleId]);
  // NOTE: WeatherMap intentionally does NOT subscribe to weatherStore
  // stations/currentReadings — ReadingsLayers/SelectedStationPopup do (per-poll
  // commit isolation, see ReadingsLayers.tsx).
  const selectedStationId = useWeatherSelectionStore((s) => s.selectedStationId);
  const selectStation = useWeatherSelectionStore((s) => s.selectStation);
  const isMobile = useUIStore((s) => s.isMobile);
  const simpleMode = useUIStore((s) => s.simpleMode);

  // Buoy data from shared store (populated by BuoyPanel in Rías Baixas sector)
  const liveBuoys = useBuoyStore((s) => s.buoys);
  const silentBuoys = useBuoyStore((s) => s.silentBuoys);
  // The silent ones only for the markers and their card: nothing that computes reads them.
  const buoys = useMemo(() => (silentBuoys.length ? [...liveBuoys, ...silentBuoys] : liveBuoys), [liveBuoys, silentBuoys]);
  const selectedBuoyId = useBuoyStore((s) => s.selectedBuoyId);
  const selectBuoy = useBuoyStore((s) => s.selectBuoy);
  const selectedBuoy = useMemo(
    () => buoys.find((b) => b.stationId === selectedBuoyId),
    [buoys, selectedBuoyId],
  );

  // Spot state (scores intentionally read inside SpotPopup for commit isolation)
  const activeSpotId = useSpotStore((s) => s.activeSpotId);
  const activeSpot = useSpotStore((s) => s.activeSpot);
  const selectSpot = useSpotStore((s) => s.selectSpot);
  const showSpotPopup = activeSpotId !== '';

  // User-created "chincheta" spots (scores intentionally read inside UserSpotPopup)
  const userSpots = useUserSpotStore((s) => s.userSpots);
  const selectedUserSpotId = useUserSpotStore((s) => s.selectedUserSpotId);
  const selectUserSpot = useUserSpotStore((s) => s.selectUserSpot);
  const addUserSpot = useUserSpotStore((s) => s.addUserSpot);
  const selectedUserSpot = useMemo(
    () => withMeteoPoints(userSpots).find((u) => u.id === selectedUserSpotId),
    [userSpots, selectedUserSpotId],
  );

  // Webcam state
  const showWebcams = useWebcamStore((s) => s.showOverlay);
  const selectedWebcamId = useWebcamStore((s) => s.selectedWebcamId);
  const selectWebcam = useWebcamStore((s) => s.selectWebcam);
  const sectorWebcams = useMemo(() => getWebcamsForSector(sectorId), [sectorId]);
  const selectedWebcam = sectorWebcams.find((c) => c.id === selectedWebcamId) ?? null;

  // What a switch turns on is not even downloaded until then: a lazy component mounted while off loads anyway
  const activeLayer = useWeatherLayerStore((s) => s.activeLayer);
  const showSwan = useMapStyleStore((s) => s.showSwan);
  const showChart = useMapStyleStore((s) => s.showNauticalChart);

  const flyToTarget = useUIStore((s) => s.flyToTarget);
  const setFlyToTarget = useUIStore((s) => s.setFlyToTarget);

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
  // With the keyboard, the first spot the Tab key reaches is the one the map is looking at
  useMarkerTabOrder(containerRef);
  // The bar of tools at the bottom takes a second row when the map is narrow; the card docked above it
  // reads this height so it never sits on the tools.
  const toolsBarRef = useRef<HTMLDivElement>(null);
  useCssVarFromElement(toolsBarRef, '--map-tools-h', 'height', !isMobile);
  // Narrow map (a small window with the panel open): the notices and a card cannot share the top. An
  // attribute and not state: nothing here has to render again for it.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => el.toggleAttribute('data-narrow', el.clientWidth < NARROW_MAP_PX));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
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
   *  because they share the same leakage pattern).
   *
   *  A switch that lands before the map exists — a shared `?sector=rias` link
   *  opened by someone whose last sector was Embalse — is remembered and done
   *  on load (`handleMapLoad`). Before, the effect returned and never ran
   *  again: Rías data over a map left at Castrelo. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      pendingSectorViewRef.current = true;
      return;
    }
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

  /** Fly to a specific target (triggered from the lists). */
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
    selectWebcam(null);
  }, [placingSpot, addUserSpot, sectorId, selectStation, selectBuoy, selectSpot, selectUserSpot, selectWebcam]);

  // Mutual exclusion: opening an official spot popup closes any user-spot popup.
  useEffect(() => {
    if (activeSpotId && selectedUserSpotId) selectUserSpot(null);
  }, [activeSpotId, selectedUserSpotId, selectUserSpot]);

  /** Register all custom SDF/raster icons. Idempotent (each register*
   *  guards with map.hasImage). Must run on initial load AND after every
   *  setStyle — MapLibre wipes addImage() icons on a style rebuild.
   *
   */
  const registerAllIcons = useCallback((map: maplibregl.Map) => {
    registerWindArrowIcons(map, 48);
    registerStationIcon(map);
    registerBuoyIcon(map);
    registerWebcamIcon(map);
  }, []);

  /** Register all map icons when the map loads. */
  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (pendingSectorViewRef.current) {
      // The sector changed before the map existed: put the camera where the
      // sector the app is in now wants it (see the sector effect above).
      pendingSectorViewRef.current = false;
      const { longitude, latitude, zoom, pitch, bearing } = useSectorStore.getState().activeSector.initialView;
      map.jumpTo({ center: [longitude, latitude], zoom, pitch, bearing });
    }
    // The sector effect could not clear the selection without a map: a spot remembered from another
    // sector stays selected, and its card would open over this one. A shared link's spot is of this sector.
    const { activeSpotId: remembered, selectSpot: pick } = useSpotStore.getState();
    if (!spotFitsSector(remembered, useSectorStore.getState().activeSector.id)) pick('');
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
  }, [registerAllIcons]);

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden" role="region" aria-label="Mapa meteorológico interactivo de Galicia" style={{ contain: 'layout style paint' }}>
      <Map
        ref={mapRef}
        mapLib={maplibregl}
        locale={MAP_LOCALE}
        initialViewState={sectorInitialView}
        style={{ width: '100%', height: '100%' }}
        mapStyle={mapStyle}
        // Flat 2D only: tilting brings back the terrain-less perspective view
        // (many more tiles at the horizon) for no informational gain.
        maxPitch={0}
        // Regional app — never need to zoom out past NW Iberia. Without a floor,
        // zooming "out to the world" forced MapLibre to load global vector tiles
        // + place every world label (addSymbols) + the DEM, causing a hard hitch
        // (user-reported). minZoom 6 still shows all of Galicia + margin.
        minZoom={6}
        // No horizontal world repetition (extra tiles at low zoom, never useful here).
        renderWorldCopies={false}
        onClick={handleMapClick}
        attributionControl={{ compact: true }}
        onLoad={handleMapLoad}
        onMoveStart={handleMoveStart}
        onMoveEnd={(e) => {
          handleMoveEnd();
          // Defer zoom state update to avoid re-render spike right after pan ends
          const q = quantizeZoom(e.viewState.zoom);
          if (q !== zoomLevel) requestAnimationFrame(() => setZoomLevel(q));
        }}
      >
        <NavigationControl position="top-right" />
        {/* Localize MapLibre controls to Spanish after mount */}

        {/* IHM nautical chart — coastal sectors only, below everything except base tiles */}
        {isCoastal && showChart && <Suspense fallback={null}><NauticalChartOverlay /></Suspense>}

        {/* Temperature gradient circles + lapse-rate lines (below wind arrows) */}
        <TemperatureOverlay />


        {/* Wind arrows + temp dots + station markers — wrapper subscribes to
            weatherStore itself so the 60s poll only re-commits these layers,
            not the whole map tree (per-poll commit isolation). Renders in the
            exact same order the three layers had here before. */}
        <ReadingsLayers
          simpleMode={simpleMode}
          buoys={isCoastal ? liveBuoys : undefined}
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

        {/* Fog overlay — terrain-based valley fill when fog detected */}
        <Suspense fallback={null}><FogOverlay /></Suspense>

        {/* Rain now: radar rain the gauges did not deny + gauges that measured it. Wakes only on measured rain */}
        <Suspense fallback={null}><RainNowOverlay /></Suspense>

        {/* Where the official visibility sensors say there is fog: draws nothing, FogOverlay paints it */}
        <Suspense fallback={null}><AemetVisibilityHalo /></Suspense>

        {/* Wind ramp pulse — stations glow when wind increases +6kt/30min */}
        <Suspense fallback={null}><WindRampOverlay /></Suspense>

        {/* NASA FIRMS active wildfires (Galicia + buffer). Auto-shows when fires present */}
        <Suspense fallback={null}><FireOverlay /></Suspense>

        {/* SWAN nearshore wave model — real wave propagation inside rías (#56 v4) */}
        {isCoastal && showSwan && <Suspense fallback={null}><SwanWaveOverlay /></Suspense>}

        {/* Storm cluster masses (below strikes) */}
        <Suspense fallback={null}><StormClusterOverlay /></Suspense>
        <Suspense fallback={null}><GustFrontOverlay /></Suspense>

        {/* Lightning strikes overlay */}
        <Suspense fallback={null}><LightningOverlay /></Suspense>

        {/* Rain radar: RainViewer tiles, the past 2 h */}
        {activeLayer === 'radar' && <Suspense fallback={null}><RadarOverlay /></Suspense>}

        {/* Selected station popup — reads stations/readings from the store
            itself (per-poll commit isolation, see ReadingsLayers.tsx) */}
        <SelectedStationPopup selectedStationId={selectedStationId} />

        {/* Selected buoy popup — coastal sectors only */}
        {isCoastal && selectedBuoy && (
          <BuoyPopup key={selectedBuoy.stationId} reading={selectedBuoy} />
        )}

        {/* Selected webcam popup */}
        {selectedWebcam && (
          <WebcamPopup key={selectedWebcam.id} webcam={selectedWebcam} onClose={() => selectWebcam(null)} />
        )}

        {/* Selected spot popup — reads score internally (commit isolation). Keyed: an answer half-given,
            a loaded history or a water temperature belong to that spot alone. */}
        {showSpotPopup && activeSpot && Number.isFinite(activeSpot.center?.[0]) && (
          <Suspense fallback={null}><SpotPopup key={activeSpot.id} spot={activeSpot} /></Suspense>
        )}

        {/* Selected user-spot popup — reads score internally (commit isolation) */}
        {selectedUserSpot && (
          <Suspense fallback={null}>
            {selectedUserSpot.meteoOnly
              ? <MeteoPointPopup key={selectedUserSpot.id} spot={selectedUserSpot} />
              : <UserSpotPopup key={selectedUserSpot.id} spot={selectedUserSpot} />}
          </Suspense>
        )}

        {/* Distance measurement tool — line + markers rendered inside Map */}
        <DistanceTool mapRef={mapRef} isActive={distanceActive} onDeactivate={deactivateDistance} />
      </Map>

      {/* Canvas overlays on top of map (need project/unproject) */}
      {activeLayer === 'wind-particles' && <Suspense fallback={null}><WindParticleOverlay mapRef={mapRef} /></Suspense>}

      {/* HTML overlays on top of map */}
      <MapStyleSelector />
      {/* Desktop: one column, so they never cover each other. On a phone AppShell has its own. */}
      {!isMobile && (
        <div className="gc-mapstack">
          <CriticalAlertBanner />
          <LightningProximityBanner />
        </div>
      )}

      {/* "Crear spot" placement-mode hint — transient, while choosing the spot */}
      {placingSpot && (
        <div className="absolute z-40 left-1/2 -translate-x-1/2 pointer-events-none" style={{ top: 'calc(4rem + var(--ticker-h, 0px))' }} role="status">
          <div className="g-theme gc-hint whitespace-nowrap">
            <WeatherIcon id="map-pin" size={15} />
            Toca el mapa donde quieras crear tu spot
          </div>
        </div>
      )}

      {/* ── Bottom controls: toolbar + alerts ── */}
      {isMobile ? (
        /* Mobile: FIXED positioning to escape MapLibre's stacking context.
           absolute z-20 renders behind the canvas; fixed z-30 floats above it
           (same pattern as MobileSailingBanner). */
        <div className="fixed z-40 left-0 right-0 px-2 flex flex-col items-center gap-2 pointer-events-none"
          style={{ bottom: isMobile ? 'calc(52px + env(safe-area-inset-bottom, 0px))' : '0.75rem', paddingBottom: isMobile ? undefined : 'env(safe-area-inset-bottom, 0px)' }}>
          {/* Notices stack here on a phone, above the alerts and the toolbar. At a fixed offset of
              their own they covered the toolbar, and above everything they covered an open spot
              sheet; in this column an open sheet covers them instead. */}
          <div className="w-full flex flex-col gap-2">
            <NewVersionBanner />
            <PwaInstallBanner />
          </div>
          <div className="pointer-events-auto w-full flex justify-center">
            <Suspense fallback={null}><AlertPanel /></Suspense>
          </div>
          <div className="flex items-center justify-center-safe gap-1 max-w-full overflow-x-auto scrollbar-none pointer-events-auto">
            <LightningDataChip />
            <Suspense fallback={null}><RainNowChip /></Suspense>
            {/* Simple mode keeps what the map shows by itself; the switches live in «Ver en el mapa» (11-nov) */}
            {!simpleMode && <WeatherLayerSelector />}
            {!simpleMode && (
              <button
                type="button"
                onClick={() => { setDistanceActive((v) => !v); setPlacingSpot(false); }}
                className="gc-tool"
                aria-pressed={distanceActive}
                title="Medir distancia"
                aria-label="Medir distancia"
              >
                <WeatherIcon id="ruler" size={18} />
              </button>
            )}
            {/* Simple mode is the map and the forecast: no tools to make things (11-nov). */}
            {!simpleMode && (
            <button
              type="button"
              onClick={togglePlacingSpot}
              className="gc-tool"
              aria-pressed={placingSpot}
              title="Crear un spot propio (sin calibrar)"
              aria-label="Crear spot"
            >
              <WeatherIcon id="map-pin" size={18} />
              +
            </button>
            )}
          </div>
        </div>
      ) : (
        /* Desktop: single flex row — toolbar left, alerts fill remaining space */
        <div ref={toolsBarRef} className="gc-maptools absolute z-40 bottom-2 left-2 right-2 flex flex-wrap items-end gap-3">
          {/* Toolbar: shrinks to fit, never overlapped */}
          <div className="flex items-end gap-2 shrink-0">
            <LightningDataChip />
            <Suspense fallback={null}><RainNowChip /></Suspense>
            {/* Simple mode keeps what the map shows by itself; the switches live in «Ver en el mapa» (11-nov) */}
            {!simpleMode && <WeatherLayerSelector />}
            {!simpleMode && (
              <button
                type="button"
                onClick={() => { setDistanceActive((v) => !v); setPlacingSpot(false); }}
                className="gc-tool"
                aria-pressed={distanceActive}
                title="Medir distancia"
                aria-label="Medir distancia"
              >
                <WeatherIcon id="ruler" size={16} />
              </button>
            )}
            {!simpleMode && (
            <button
              type="button"
              onClick={togglePlacingSpot}
              className="gc-tool"
              aria-pressed={placingSpot}
              title="Crear un spot propio (sin calibrar): toca el mapa para colocarlo"
              aria-label="Crear spot"
            >
              <WeatherIcon id="map-pin" size={16} />
              Crear spot
            </button>
            )}
          </div>

          {/* Alerts: fills remaining width, centered within its space */}
          <div className="gc-maptools-alerts flex-1">
            <div className="max-w-xl">
              <Suspense fallback={null}><AlertPanel /></Suspense>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
