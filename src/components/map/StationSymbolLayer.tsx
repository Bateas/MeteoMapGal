/**
 * StationSymbolLayer — GPU-accelerated station markers via MapLibre symbol layer.
 *
 * Replaces 90+ DOM `<Marker>` components with a single GeoJSON source + symbol layer.
 * Icons are rendered on the WebGL canvas — no DOM elements, no CSS hacks,
 * no visibility toggle during pan. 60fps guaranteed.
 *
 * Wind arrows are handled separately by WindFieldOverlay (already GPU).
 * This layer shows: colored circle (temperature) + station name label.
 */
import { useMapInk } from '../../hooks/useMapInk';
import { useMemo, useEffect, useCallback, useState } from 'react';
import { Source, Layer, Marker, useMap } from 'react-map-gl/maplibre';
import type { NormalizedStation, NormalizedReading } from '../../types/station';
import { temperatureColor, windSpeedColor } from '../../services/windUtils';
import { SOURCE_CONFIG } from '../../config/sourceConfig';
import { isWindBlacklisted } from '../../services/spotScoringEngine';
import { useUIStore } from '../../store/uiStore';
import {
  clusterStations,
  STATION_CLUSTER_DISABLE_ZOOM,
  type StationClusterGroup,
} from '../../services/stationClustering';

/** A group says the temperature of its zone too, softened so it stays behind the spots. */
export function clusterFill(avgTemp: number | null): string {
  return avgTemp != null ? `color-mix(in srgb, ${temperatureColor(avgTemp)} 62%, var(--g-bg))` : 'var(--g-bg)';
}

interface StationSymbolLayerProps {
  stations: NormalizedStation[];
  readings: Map<string, NormalizedReading>;
  selectedStationId: string | null;
  onSelectStation: (id: string | null) => void;
  zoomLevel: number;
  /** Simple mode: same markers, without the source initials (MG, WU, NT...). */
  hideSourceLabels?: boolean;
  /** Simple mode: smaller and fainter, so the spots lead. */
  faint?: boolean;
}


/** Freshness in minutes */
function ageMins(timestamp?: Date | string | null): number {
  if (!timestamp) return 999;
  const t = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  return (Date.now() - t.getTime()) / 60_000;
}

/** Register the station circle icon (SDF mode for dynamic coloring) */
export async function registerStationIcon(map: maplibregl.Map): Promise<void> {
  const id = 'station-circle';
  if (map.hasImage(id)) return;

  const size = 36;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;

  // White filled circle — SDF mode will recolor it
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Subtle inner shadow for depth
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const img = await new Promise<HTMLImageElement>((resolve) => {
    const image = new Image(size, size);
    image.onload = () => resolve(image);
    image.src = canvas.toDataURL('image/png');
  });

  if (!map.hasImage(id)) {
    map.addImage(id, img, { sdf: true }); // SDF allows icon-color to recolor
  }
}

export function StationSymbolLayer({
  stations,
  readings,
  selectedStationId,
  onSelectStation,
  zoomLevel: _zoomLevel,
  hideSourceLabels = false,
  faint = false,
}: StationSymbolLayerProps) {
  const ink = useMapInk();
  const { current: mapRef } = useMap();

  // Track current zoom — clustering only kicks in below threshold so this
  // re-renders only at meaningful transitions in practice.
  const [zoom, setZoom] = useState(() => mapRef?.getMap()?.getZoom() ?? 11);
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    // Discretize to 0.5-zoom steps: clustering only depends on coarse zoom
    // bands, so updating state on every continuous zoom tick (30-60/s during a
    // pinch/scroll) just thrashes the re-cluster useMemo + DOM markers. Round to
    // the nearest 0.5 and only setState when the band actually changes.
    const onZoom = () => {
      const stepped = Math.round(map.getZoom() * 2) / 2;
      setZoom((prev) => (prev === stepped ? prev : stepped));
    };
    map.on('zoom', onZoom);
    return () => { map.off('zoom', onZoom); };
  }, [mapRef]);

  // Filter out tempOnly + wind-blacklisted, then cluster by proximity.
  // Wind-blacklisted stations are hidden entirely — their wind readings
  // are unreliable (<0.20 ratio vs buoys); they still contribute temp /
  // humidity internally to alerts and overlays. tempOnly stations also
  // skipped here (rendered by other dedicated layers).
  const items = useMemo(() => {
    const eligible = stations.filter((s) => !s.tempOnly && !isWindBlacklisted(s.id));
    return clusterStations(eligible, readings, zoom);
  }, [stations, readings, zoom]);

  // Build GeoJSON from STANDALONE stations only — clustered ones rendered
  // as DOM markers below.
  const geojson = useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = [];

    for (const item of items) {
      if (item.type !== 'station') continue;
      const station = item.station;
      const reading = readings.get(station.id);
      const windMs = reading?.windSpeed ?? 0;
      const age = ageMins(reading?.timestamp);
      const isSelected = station.id === selectedStationId;

      const srcMeta = SOURCE_CONFIG[station.source];
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [station.lon, station.lat] },
        properties: {
          id: station.id,
          name: station.name,
          source: station.source,
          sourceLabel: srcMeta?.label ?? '?',
          windSpeed: windMs,
          temperature: reading?.temperature ?? null,
          // The centre says the temperature: a cold station or a cold zone is bluer, without saying it
          tempColor: temperatureColor(reading?.temperature ?? null),
          sourceColor: srcMeta?.color ?? '#64748b',
          windColor: windSpeedColor(reading?.windSpeed ?? null),
          freshness: age < 15 ? 1.0 : age < 45 ? 0.85 : age < 90 ? 0.7 : age < 180 ? 0.5 : 0.35,
          isSelected: isSelected ? 1 : 0,
        },
      });
    }

    return { type: 'FeatureCollection', features };
  }, [items, readings, selectedStationId]);

  const clusterItems = useMemo(
    () => items.filter((it): it is StationClusterGroup => it.type === 'cluster'),
    [items],
  );

  const handleClusterClick = useCallback((cluster: StationClusterGroup) => {
    const map = mapRef?.getMap();
    if (!map) return;
    // Fly to centroid + zoom past the cluster disable threshold so individual
    // stations re-appear.
    map.flyTo({
      center: [cluster.lon, cluster.lat],
      zoom: STATION_CLUSTER_DISABLE_ZOOM + 0.5,
      duration: 700,
    });
  }, [mapRef]);

  // Click handler — map event instead of per-marker
  const handleClick = useCallback(
    (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const id = feature.properties?.id as string;
      onSelectStation(id === selectedStationId ? null : id);
    },
    [onSelectStation, selectedStationId],
  );

  // Register click + cursor handlers on both clickable layers
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    const layers = ['stations-icons', 'stations-source-ring'];
    const enter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const leave = () => { map.getCanvas().style.cursor = ''; };

    for (const layerId of layers) {
      map.on('click', layerId, handleClick);
      map.on('mouseenter', layerId, enter);
      map.on('mouseleave', layerId, leave);
    }

    return () => {
      for (const layerId of layers) {
        map.off('click', layerId, handleClick);
        map.off('mouseenter', layerId, enter);
        map.off('mouseleave', layerId, leave);
      }
    };
  }, [mapRef, handleClick]);

  // Zoom-based size scaling — visible from zoom 8+
  const sizeScale = faint ? 0.7 : 1;
  const iconSize: maplibregl.ExpressionSpecification = [
    'interpolate', ['linear'], ['zoom'],
    8, 0.25 * sizeScale,
    9, 0.35 * sizeScale,
    10, 0.5 * sizeScale,
    11, 0.7 * sizeScale,
    12, 0.9 * sizeScale,
  ];
  // Muted stations keep their freshness fade, at a bit over half the strength.
  const fade = (e: maplibregl.ExpressionSpecification): maplibregl.ExpressionSpecification =>
    faint ? ['*', 0.8, e] : e;

  // Synchronized filter: station markers are visible down to zoom 8+
  // (matches WindFieldOverlay minzoom=8, preventing circles from vanishing before wind arrows)
  const filter: maplibregl.ExpressionSpecification = [
    'any',
    ['>=', ['zoom'], 8],
    ['==', ['get', 'isSelected'], 1],
  ];

  return (
    <Source id="stations-geo" type="geojson" data={geojson}>
      {/* The ring says something else: which network it is, where the initials say so too. Neutral in simple mode. */}
      <Layer
        id="stations-source-ring"
        type="circle"
        filter={filter}
        paint={{
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5 * sizeScale, 9, 7 * sizeScale, 10, 9 * sizeScale, 11, 12 * sizeScale, 12, 15 * sizeScale],
          'circle-color': 'transparent',
          'circle-stroke-color': faint ? '#8a928e' : ['get', 'sourceColor'],
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 9, 1, 12, 1.5],
          // Freshness opacity: hourly stations remain visible even when readings are 1-2h old
          'circle-opacity': [
            'step', ['get', 'freshness'],
            0.25,
            0.35, 0.35,
            0.5, 0.45,
            0.7, 0.6,
            0.85, 0.7,
          ],
          'circle-stroke-opacity': fade([
            'step', ['get', 'freshness'],
            0.3,
            0.35, 0.4,
            0.5, 0.55,
            0.7, 0.7,
            0.85, 0.85,
          ]),
        }}
      />

      {/* Circle in the colour of its temperature + source label centered */}
      <Layer
        id="stations-icons"
        type="symbol"
        filter={filter}
        layout={{
          'icon-image': 'station-circle',
          'icon-size': iconSize,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          // Source label always visible (A, MG, MC, WU, NT, SX, PT)
          // In simple mode the initials go: to a casual visitor "WU" or "MG" is
          // jargon, while the temperature colour and the wind arrows still read.
          'text-field': hideSourceLabels ? '' : ['get', 'sourceLabel'],
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 9, 7, 11, 9, 12, 11],
          'text-offset': [0, 0],
          'text-anchor': 'center',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        }}
        paint={{
          'icon-color': ['get', 'tempColor'],
          // Freshness opacity: minimum 0.35 so older readings are clearly identifiable
          'icon-opacity': fade([
            'step', ['get', 'freshness'],
            0.35,
            0.35, 0.45,
            0.5, 0.6,
            0.7, 0.75,
            0.85, 0.85,
          ]),
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.5)',
          'text-halo-width': 0.8,
          // Source label fades with marker
          'text-opacity': [
            'step', ['get', 'freshness'],
            0.45,
            0.35, 0.6,
            0.5, 0.75,
            0.7, 0.9,
            0.85, 1.0,
          ],
        }}
      />

      {/* Station name below — only at zoom >= 11 */}
      <Layer
        id="stations-names"
        type="symbol"
        filter={filter}
        layout={{
          'text-field': ['step', ['zoom'], '', 11, ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
          'text-offset': [0, 1.8],
          'text-anchor': 'top',
          'text-optional': true,
          'text-allow-overlap': false,
        }}
        paint={{
          'text-color': ink.text,
          'text-halo-color': ink.halo,
          'text-halo-width': 1.5,
          // Stale station names fade with the marker
          'text-opacity': [
            'step', ['get', 'freshness'],
            0.4,
            0.35, 0.55,
            0.5, 0.7,
            0.7, 0.85,
            0.85, 1.0,
          ],
        }}
      />

      {/* Selection ring — larger, glowing */}
      <Layer
        id="stations-selected-ring"
        type="circle"
        filter={['==', ['get', 'isSelected'], 1]}
        paint={{
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 10, 12, 18],
          'circle-color': 'transparent',
          'circle-stroke-color': ink.text,
          'circle-stroke-width': 2.5,
          'circle-opacity': 0.9,
        }}
      />
      {/* Station clusters are ambient context, not protagonists. Hide them
          entirely at sector scale (<zoom 8) so spots + weather overlays own the
          far view — an individual station's reading isn't a decision driver at
          50 km (v2.81.78). */}
      {zoom >= 8 && clusterItems.map((cluster) => (
        <StationClusterMarker key={cluster.id} cluster={cluster} onClick={handleClusterClick} />
      ))}
    </Source>
  );
}

// ── Cluster marker (DOM) ───────────────────────────────────────

interface StationClusterMarkerProps {
  cluster: StationClusterGroup;
  onClick: (cluster: StationClusterGroup) => void;
}

function StationClusterMarker({ cluster, onClick }: StationClusterMarkerProps) {
  const isMobile = useUIStore((s) => s.isMobile);
  // AMBIENT styling on purpose (v2.81.78): station clusters are
  // secondary context, not protagonists. Small, translucent, thin muted ring,
  // small number — they recede so the bold coloured spots clearly dominate.
  // What recedes is the drawing: the button around it is a full touch target.
  // A cluster just says "N stations here — click to zoom in"; it is NOT a
  // temperature reading (that's the dedicated temperature overlay's job). The
  // average temp + spread live in the hover tooltip for anyone curious.
  const spreadLabel = cluster.tempSpread != null && cluster.tempSpread >= 2
    ? ` · Δ${cluster.tempSpread.toFixed(1)}°`
    : '';
  const tempLabel = cluster.avgTemp != null ? ` · ${cluster.avgTemp.toFixed(1)}°C medio` : '';

  return (
    // Low z-index: station clusters sit BELOW spots (z-index 6) — spots are the
    // actionable element and must always paint on top.
    <Marker longitude={cluster.lon} latitude={cluster.lat} anchor="center" style={{ zIndex: 20 }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick(cluster); }}
        className="flex items-center justify-center transition-transform hover:scale-125 cursor-pointer"
        style={{
          width: isMobile ? 44 : 40,
          height: isMobile ? 44 : 40,
          background: 'transparent',
          border: 0,
        }}
        title={`${cluster.count} estaciones${tempLabel}${spreadLabel}: pulsa para acercar`}
        aria-label={`${cluster.count} estaciones`}
      >
        <span
          className="flex items-center justify-center rounded-full font-semibold tabular-nums leading-none"
          style={{
            width: 26,
            height: 26,
            background: clusterFill(cluster.avgTemp),
            border: '1px solid var(--g-rule)',
            color: 'var(--g-ink)',
            fontFamily: 'var(--g-narrow)',
            fontSize: '13px',
          }}
        >
          {cluster.count}
        </span>
      </button>
    </Marker>
  );
}
