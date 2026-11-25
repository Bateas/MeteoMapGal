import { windTone, msToKnots, WIND_TONES_ON_DARK, WIND_TONES_ON_LIGHT, WIND_TONE_NAMES } from '../../services/windUtils';
import { mapIsDark } from '../../hooks/useMapInk';
import { useMemo, memo, useState, useEffect } from 'react';
import { windFieldZoom } from './windFieldZoom';
import { arrowSize, arrowOpacity } from './windArrowStyle';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import type maplibregl from 'maplibre-gl';
import type { NormalizedStation, NormalizedReading } from '../../types/station';
import type { BuoyReading } from '../../api/buoyClient';
import { BUOY_COORDS_MAP, buoyLandStationId } from '../../api/buoyClient';
import { isLandStationCopy } from '../../services/buoyUtils';
import { isWindBlacklisted } from '../../services/spotScoringEngine';
import {
  clusterStations,
  type StationClusterPoint,
} from '../../services/stationClustering';

interface WindFieldOverlayProps {
  stations: NormalizedStation[];
  readings: Map<string, NormalizedReading>;
  /** Optional buoy readings — generates hex-pattern arrows around buoys too */
  buoys?: BuoyReading[];
  /** When true, uses smaller arrows and tighter ring (for dense sectors). */
  compact?: boolean;
  /** Current map zoom level — used to scale arrow offsets dynamically */
  zoomLevel?: number;
  /** Simple mode: smaller and fainter, with their colour, so the spots lead. */
  muted?: boolean;
}

/** Base offset distance in degrees at reference zoom 11 (~31px screen radius at lat 42°) */
const BASE_OFFSET_LAT = 0.016;
const BASE_OFFSET_LON = 0.022;

/** Reference zoom where BASE_OFFSET matches target screen radius (~31px) */
const REF_ZOOM = 11;

/** Positions around each station (hex pattern) */
const OFFSETS = [
  [0, 1],            // N
  [0.866, 0.5],      // NE
  [0.866, -0.5],     // SE
  [0, -1],           // S
  [-0.866, -0.5],    // SW
  [-0.866, 0.5],     // NW
] as const;

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/** Push hex-pattern arrow features for a single wind source (station or buoy).
 *
 * Restored in v2.81.49 and enhanced:
 * - Dynamic zoomScale keeps the 6 arrows at a constant visual screen radius (~31px)
 *   regardless of zoom level (preventing arrows from flying 280px away at high zooms).
 * - Full support for calm wind (<0.5 m/s) and sensors without direction vane:
 *   emits calm-level arrows (wind-arrow-0, slate) with radial outward orientation
 *   so calm stations visibly communicate calm rather than vanishing.
 */
function pushHexArrows(
  features: GeoJSON.Feature[],
  lon: number,
  lat: number,
  windSpeed: number,
  windDir: number | null,
  offsetScale: number,
  compact: boolean,
  freshnessAlpha = 1.0,
): void {
  const isCalm = windSpeed < 0.5;
  const level = speedToLevel(windSpeed);
  const hasDir = windDir !== null && Number.isFinite(windDir);

  // Wind but no vane (e.g. a Netatmo anemometer without direction): the outward
  // star below reads as "wind blowing out of this station in every direction",
  // which is false. The speed is still in the marker and the popup; the map only
  // lacks a direction to show, so it shows none. The star stays for real calm.
  if (!hasDir && !isCalm) return;

  // Inner ring (6 arrows)
  for (let i = 0; i < OFFSETS.length; i++) {
    const [dx, dy] = OFFSETS[i];

    // Direction calculation:
    // If wind direction is available, arrows point towards where wind blows (meteorological + 180).
    // If wind direction is null (calm vane / no vane), arrows point outward radially in hex direction.
    let rotation: number;
    if (windDir !== null && Number.isFinite(windDir)) {
      rotation = (windDir + 180) % 360;
    } else {
      // Outward radial direction: N points N (0°), NE points NE (60°), etc.
      rotation = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    }

    const baseOpacity = isCalm ? 0.45 : (compact ? 0.65 : 0.75);

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [
          lon + dx * BASE_OFFSET_LON * offsetScale,
          lat + dy * BASE_OFFSET_LAT * offsetScale,
        ],
      },
      properties: {
        rotation,
        speed: windSpeed,
        speedLevel: level,
        opacity: baseOpacity * freshnessAlpha,
      },
    });
  }
}

/** One icon per step of the map's scale (windTone), painted for the map drawn when the style loads. */
export const SPEED_LEVELS = WIND_TONE_NAMES.map((_, step) => ({ id: `wind-arrow-${step}`, step }));

/** Wind in m/s → its step of the scale. */
export function speedToLevel(speed: number): number {
  return windTone(msToKnots(speed));
}

/**
 * Create a wind-arrow icon as HTMLImageElement for MapLibre symbol layers.
 *
 * IMPORTANT: MapLibre v5 does NOT render `ImageData` objects properly in
 * symbol layers — the features exist but are invisible. Using `HTMLImageElement`
 * (via canvas.toDataURL → new Image) works reliably.
 *
 * Clean arrow-only design: colored arrow with dark outline for contrast,
 * no background circle. The outline makes it stand out against any terrain.
 */
function createArrowIcon(
  size: number,
  arrowColor: string,
): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const cx = size / 2;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Modern tapered arrow: wide head narrowing to thin tail
    // Dark outline first
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.beginPath();
    ctx.moveTo(cx, size * 0.08);            // sharp tip
    ctx.lineTo(cx + size * 0.26, size * 0.45); // right wing
    ctx.lineTo(cx + size * 0.06, size * 0.38); // right notch
    ctx.lineTo(cx + size * 0.04, size * 0.85); // right tail
    ctx.lineTo(cx - size * 0.04, size * 0.85); // left tail
    ctx.lineTo(cx - size * 0.06, size * 0.38); // left notch
    ctx.lineTo(cx - size * 0.26, size * 0.45); // left wing
    ctx.closePath();
    ctx.fill();
    // The same shape stroked: at map size the dark edge was under a pixel and a light-wind arrow
    // (pale blue) vanished over the blue of the rain layer and over the pale relief.
    ctx.strokeStyle = 'rgba(8, 15, 30, 0.85)';
    ctx.lineWidth = size * 0.07;
    ctx.stroke();

    // Colored arrow on top (slightly smaller)
    ctx.fillStyle = arrowColor;
    ctx.beginPath();
    ctx.moveTo(cx, size * 0.12);             // sharp tip
    ctx.lineTo(cx + size * 0.22, size * 0.44); // right wing
    ctx.lineTo(cx + size * 0.05, size * 0.38); // right notch
    ctx.lineTo(cx + size * 0.03, size * 0.82); // right tail
    ctx.lineTo(cx - size * 0.03, size * 0.82); // left tail
    ctx.lineTo(cx - size * 0.05, size * 0.38); // left notch
    ctx.lineTo(cx - size * 0.22, size * 0.44); // left wing
    ctx.closePath();
    ctx.fill();

    // Bright center line for depth
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, size * 0.18);
    ctx.lineTo(cx, size * 0.72);
    ctx.stroke();

    const img = new Image(size, size);
    img.onload = () => resolve(img);
    img.src = canvas.toDataURL('image/png');
  });
}

const paintedTones = new WeakMap<maplibregl.Map, readonly string[]>();

/**
 * Register all speed-level wind-arrow icons on the map.
 * Must be called once during map's onLoad callback.
 */
export async function registerWindArrowIcons(
  map: maplibregl.Map,
  size = 48,
): Promise<void> {
  // A change of base map or theme goes by style diff: the images survive and style.load still fires, so the ones
  // already there have to be repainted when the tones change, or they keep the palette of the map before.
  const tones = mapIsDark() ? WIND_TONES_ON_DARK : WIND_TONES_ON_LIGHT;
  const repaint = paintedTones.get(map) !== tones;
  paintedTones.set(map, tones);
  for (const level of SPEED_LEVELS) {
    if (map.hasImage(level.id) && !repaint) continue;
    const img = await createArrowIcon(size, tones[level.step]);
    if (map.hasImage(level.id)) map.updateImage(level.id, img);
    else map.addImage(level.id, img, { sdf: false });
  }
}

/**
 * GPU-accelerated wind field overlay.
 * Uses a single GeoJSON source + symbol layer instead of 240+ DOM Markers.
 * All arrows are rendered on the GPU — zero JS overhead during pan/zoom.
 *
 * Dynamic offset scaling:
 * As the user zooms in or out, `zoomScale = 2^(11 - zoom)` scales geographic
 * degree offsets so the 6 arrows maintain an optimal ~31px screen radius
 * around the station marker at any zoom level (8 to 16).
 */
/**
 * Build GeoJSON FeatureCollection containing 6-arrow hex clusters for all eligible wind sources.
 */
export function buildWindFieldGeoJSON(
  stations: NormalizedStation[],
  readings: Map<string, NormalizedReading>,
  buoys?: BuoyReading[],
  compact = false,
  zoom = REF_ZOOM,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  // Scale offset inversely with zoom so the screen distance stays ~31px
  const zoomScale = Math.pow(2, REF_ZOOM - zoom);
  const offsetScale = (compact ? 0.6 : 1.0) * zoomScale;

  // ── Station arrows ─────────────────────────────────
  // Cluster stations identically to StationSymbolLayer so arrows only appear
  // around visible standalone stations, never around clustered bubbles or empty spaces.
  const eligible = stations.filter((s) => !s.tempOnly && !isWindBlacklisted(s.id));
  const clusterItems = clusterStations(eligible, readings, zoom);
  const standaloneStations = clusterItems
    .filter((it): it is StationClusterPoint => it.type === 'station')
    .map((it) => it.station);

  // Allow readings up to 90 min (matches StationSymbolLayer freshness decay
  // so hourly stations like MeteoGalicia/AEMET/IPMA don't lose arrows after 30 min)
  const maxAgeMs = 90 * 60_000;
  const now = Date.now();
  const alphaForAge = (ageMs: number) => (ageMs < 45 * 60_000 ? 1.0 : 0.65);

  for (const station of standaloneStations) {
    const reading = readings.get(station.id);
    if (!reading || reading.windSpeed === null || !Number.isFinite(reading.windSpeed)) continue;

    // Skip stale stations (>90 min)
    const readingTime = reading.timestamp instanceof Date
      ? reading.timestamp.getTime()
      : typeof reading.timestamp === 'string'
        ? new Date(reading.timestamp).getTime()
        : 0;
    if (readingTime <= 0) continue;
    const ageMs = now - readingTime;
    if (ageMs > maxAgeMs) continue;

    pushHexArrows(
      features,
      station.lon,
      station.lat,
      reading.windSpeed,
      reading.windDirection ?? null,
      offsetScale,
      compact,
      alphaForAge(ageMs),
    );
  }

  // ── Buoy arrows ─────────────────────────────────────
  if (buoys) {
    for (const buoy of buoys) {
      if (buoy.windSpeed == null || !Number.isFinite(buoy.windSpeed)) continue;
      // The same anemometer as a land station already on the map (Ons, Cabo Udra): twelve arrows for one reading.
      if (isLandStationCopy(buoy.stationId)) continue;
      // A land station set aside for bad wind must not come back through the buoy list.
      const landId = buoyLandStationId(buoy.stationId);
      if (landId && isWindBlacklisted(landId)) continue;
      const coords = BUOY_COORDS_MAP.get(buoy.stationId);
      if (!coords) continue;
      // Same ceiling as the stations: a buoy that stopped publishing kept painting its last wind for ever.
      const ageMs = now - new Date(buoy.timestamp).getTime();
      if (!Number.isFinite(ageMs) || ageMs > maxAgeMs) continue;
      pushHexArrows(
        features,
        coords.lon,
        coords.lat,
        buoy.windSpeed,
        buoy.windDir ?? null,
        offsetScale,
        compact,
        alphaForAge(ageMs),
      );
    }
  }

  if (features.length === 0) return EMPTY_FC;

  return {
    type: 'FeatureCollection',
    features,
  };
}

export const WIND_ARROW_ICON_SIZE_REGULAR: maplibregl.ExpressionSpecification = [
  'interpolate', ['linear'], ['zoom'],
  8, ['interpolate', ['linear'], ['get', 'speed'], 0, 0.28, 3, 0.35, 6, 0.45, 10, 0.55],
  11, ['interpolate', ['linear'], ['get', 'speed'], 0, 0.55, 3, 0.7, 6, 0.9, 10, 1.1],
  14, ['interpolate', ['linear'], ['get', 'speed'], 0, 0.66, 3, 0.84, 6, 1.08, 10, 1.32],
];

export const WIND_ARROW_ICON_SIZE_COMPACT: maplibregl.ExpressionSpecification = [
  'interpolate', ['linear'], ['zoom'],
  8, ['interpolate', ['linear'], ['get', 'speed'], 0, 0.19, 3, 0.23, 6, 0.28, 10, 0.33],
  11, ['interpolate', ['linear'], ['get', 'speed'], 0, 0.38, 3, 0.45, 6, 0.55, 10, 0.65],
  14, ['interpolate', ['linear'], ['get', 'speed'], 0, 0.46, 3, 0.54, 6, 0.66, 10, 0.78],
];

export const WindFieldOverlay = memo(function WindFieldOverlay({
  stations,
  readings,
  buoys,
  compact = false,
  zoomLevel: propZoomLevel,
  muted = false,
}: WindFieldOverlayProps) {
  const { current: mapRef } = useMap();
  const [iconsReady, setIconsReady] = useState(false);

  // Dynamic zoom tracking, in steps (windFieldZoom) to avoid thrashing GeoJSON on tiny wheel ticks
  const [zoom, setZoom] = useState(() => windFieldZoom(mapRef?.getMap()?.getZoom() ?? propZoomLevel ?? REF_ZOOM));

  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;

    const onZoom = () => {
      const stepped = windFieldZoom(map.getZoom());
      setZoom((prev) => (prev === stepped ? prev : stepped));
    };
    map.on('zoom', onZoom);
    return () => { map.off('zoom', onZoom); };
  }, [mapRef]);

  // Wait until wind-arrow icons are registered on the map
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    const check = () => {
      if (map.hasImage('wind-arrow-0')) setIconsReady(true);
    };
    check();
    map.on('styledata', check);
    return () => { map.off('styledata', check); };
  }, [mapRef]);

  const geojson = useMemo<GeoJSON.FeatureCollection>(
    () => buildWindFieldGeoJSON(stations, readings, buoys, compact, zoom),
    [stations, readings, buoys, compact, zoom],
  );

  // Don't render until arrow icons are registered — prevents flash of fallback markers
  if (!iconsReady) return null;

  return (
    <Source id="wind-field" type="geojson" data={geojson}>
      <Layer
        id="wind-field-arrows"
        type="symbol"
        minzoom={8}
        layout={{
          'icon-image': ['concat', 'wind-arrow-', ['to-string', ['get', 'speedLevel']]],
          'icon-rotate': ['get', 'rotation'],
          'icon-size': arrowSize(compact ? WIND_ARROW_ICON_SIZE_COMPACT : WIND_ARROW_ICON_SIZE_REGULAR, muted),
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-rotation-alignment': 'map',
        }}
        paint={{ 'icon-opacity': arrowOpacity(muted) }}
      />
    </Source>
  );
});
