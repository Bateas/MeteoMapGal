import { useMemo, memo, useState, useEffect } from 'react';
import { Source, Layer, useMap } from 'react-map-gl/maplibre';
import type maplibregl from 'maplibre-gl';
import type { NormalizedStation, NormalizedReading } from '../../types/station';
import type { BuoyReading } from '../../api/buoyClient';
import { BUOY_COORDS_MAP } from '../../api/buoyClient';
import { STALE_THRESHOLD_MIN } from '../../config/constants';

interface WindFieldOverlayProps {
  stations: NormalizedStation[];
  readings: Map<string, NormalizedReading>;
  /** Optional buoy readings — generates hex-pattern arrows around buoys too */
  buoys?: BuoyReading[];
  /** When true, uses smaller arrows and skips outer ring (for dense sectors). */
  compact?: boolean;
  /** Current map zoom level — used to filter low-wind arrows at low zoom */
  zoomLevel?: number;
}

/** Offset distance in degrees (~2km at lat 42°) */
const OFFSET_LAT = 0.018;
const OFFSET_LON = 0.024;

/** Positions around each station (hex pattern) */
const OFFSETS = [
  [0, 1],            // N
  [0.866, 0.5],      // NE
  [0.866, -0.5],     // SE
  [0, -1],           // S
  [-0.866, -0.5],    // SW
  [-0.866, 0.5],     // NW
] as const;

/** Second ring (farther, more transparent) */
const OFFSETS_OUTER = [
  [0.5, 0.866],      // NNE
  [1, 0],            // E
  [0.5, -0.866],     // SSE
  [-0.5, -0.866],    // SSW
  [-1, 0],           // W
  [-0.5, 0.866],     // NNW
] as const;

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/** Push hex-pattern arrow features for a single wind source (station or buoy). */
function pushHexArrows(
  features: GeoJSON.Feature[],
  lon: number,
  lat: number,
  windSpeed: number,
  windDir: number,
  offsetScale: number,
  compact: boolean,
): void {
  const rotation = (windDir + 180) % 360;
  const level = speedToLevel(windSpeed);

  // Inner ring (6 arrows)
  for (let i = 0; i < OFFSETS.length; i++) {
    const [dx, dy] = OFFSETS[i];
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [
          lon + dx * OFFSET_LON * offsetScale,
          lat + dy * OFFSET_LAT * offsetScale,
        ],
      },
      properties: {
        rotation,
        speed: windSpeed,
        speedLevel: level,
        opacity: compact ? 0.65 : 0.75,
      },
    });
  }

  // Outer ring — skip in compact mode
  if (!compact) {
    for (let i = 0; i < OFFSETS_OUTER.length; i++) {
      const [dx, dy] = OFFSETS_OUTER[i];
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [
            lon + dx * OFFSET_LON * 1.8,
            lat + dy * OFFSET_LAT * 1.8,
          ],
        },
        properties: {
          rotation,
          speed: windSpeed,
          speedLevel: level,
          opacity: 0.5,
        },
      });
    }
  }
}

/**
 * Speed-based color palette for wind arrows — matches windSpeedColor() in windUtils.ts.
 * Each level gets a unique icon registered on the map.
 */
/** Simplified wind arrow colors — aligned with windSpeedColor() scale.
 * 0-6kt = one blue (less visual noise in calm conditions). */
const SPEED_LEVELS = [
  { id: 'wind-arrow-0', color: '#64748b', maxSpeed: 0.5 },  // slate — calm (<1 kt)
  { id: 'wind-arrow-1', color: '#38bdf8', maxSpeed: 3.0 },  // sky-400 — flojo (1-6 kt, one blue)
  { id: 'wind-arrow-2', color: '#22c55e', maxSpeed: 4.5 },  // green-500 — gentle (6-9 kt)
  { id: 'wind-arrow-3', color: '#84cc16', maxSpeed: 6.5 },  // lime-500 — moderate (9-13 kt)
  { id: 'wind-arrow-4', color: '#eab308', maxSpeed: 9.0 },  // yellow-500 — fresh (13-18 kt)
  { id: 'wind-arrow-5', color: '#f97316', maxSpeed: 12 },   // orange-500 — strong (18-23 kt)
  { id: 'wind-arrow-6', color: '#ef4444', maxSpeed: 15 },   // red-500 — gale (23-30 kt)
  { id: 'wind-arrow-7', color: '#a855f7', maxSpeed: Infinity }, // violet — extreme (30+ kt)
] as const;

/** Map wind speed (m/s) to a speed-level index 0-5 */
function speedToLevel(speed: number): number {
  for (let i = 0; i < SPEED_LEVELS.length; i++) {
    if (speed < SPEED_LEVELS[i].maxSpeed) return i;
  }
  return SPEED_LEVELS.length - 1;
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

/**
 * Register all speed-level wind-arrow icons on the map.
 * Must be called once during map's onLoad callback.
 */
export async function registerWindArrowIcons(
  map: maplibregl.Map,
  size = 48,
): Promise<void> {
  for (const level of SPEED_LEVELS) {
    if (!map.hasImage(level.id)) {
      const img = await createArrowIcon(size, level.color);
      if (!map.hasImage(level.id)) {
        map.addImage(level.id, img, { sdf: false });
      }
    }
  }
}

/**
 * GPU-accelerated wind field overlay.
 * Uses a single GeoJSON source + symbol layer instead of 240+ DOM Markers.
 * All arrows are rendered on the GPU — zero JS overhead during pan/zoom.
 *
 * Each feature includes a `speedLevel` property (0-5) that selects the
 * matching icon color via a data-driven `icon-image` expression.
 *
 * NOTE: The wind-arrow-{0..5} icons must be registered on the map BEFORE
 * this component renders. This is done in WeatherMap's onLoad callback.
 */
export const WindFieldOverlay = memo(function WindFieldOverlay({
  stations,
  readings,
  buoys,
  compact = false,
  zoomLevel = 12,
}: WindFieldOverlayProps) {
  // Wait until wind-arrow icons are registered on the map to avoid flash of default markers
  const { current: mapRef } = useMap();
  const [iconsReady, setIconsReady] = useState(false);
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!map) return;
    const check = () => setIconsReady(map.hasImage('wind-arrow-0'));
    check();
    if (!iconsReady) {
      map.on('styledata', check);
      return () => { map.off('styledata', check); };
    }
  }, [mapRef, iconsReady]);

  const geojson = useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = [];
    const offsetScale = compact ? 0.6 : 1;
    const minWindMs = 0.1; // Filter is now handled by MapLibre expression on the layer

    // ── Station arrows ─────────────────────────────────
    const staleMs = STALE_THRESHOLD_MIN * 60_000;
    const now = Date.now();
    for (const station of stations) {
      if (station.tempOnly) continue;
      const reading = readings.get(station.id);
      if (!reading || reading.windDirection === null || reading.windSpeed === null || reading.windSpeed < minWindMs) continue;
      // Skip stale stations — no wind arrows for offline data
      if (now - reading.timestamp.getTime() > staleMs) continue;
      pushHexArrows(features, station.lon, station.lat, reading.windSpeed, reading.windDirection, offsetScale, compact);
    }

    // ── Buoy arrows ─────────────────────────────────────
    if (buoys) {
      for (const buoy of buoys) {
        if (buoy.windSpeed == null || buoy.windDir == null || buoy.windSpeed < 0.1) continue;
        const coords = BUOY_COORDS_MAP.get(buoy.stationId);
        if (!coords) continue;
        pushHexArrows(features, coords.lon, coords.lat, buoy.windSpeed, buoy.windDir, offsetScale, compact);
      }
    }

    if (features.length === 0) return EMPTY_FC;

    return {
      type: 'FeatureCollection',
      features,
    };
  }, [stations, readings, buoys, compact]);

  // Don't render until arrow icons are registered — prevents flash of fallback markers
  if (!iconsReady) return null;

  return (
    <Source id="wind-field" type="geojson" data={geojson}>
      <Layer
        id="wind-field-arrows"
        type="symbol"
        filter={[
          'any',
          ['>=', ['zoom'], 10],
          ['all', ['>=', ['zoom'], 9], ['>=', ['get', 'speed'], 1.03]],
          ['all', ['>=', ['zoom'], 8], ['>=', ['get', 'speed'], 2.06]],
        ]}
        layout={{
          'icon-image': ['concat', 'wind-arrow-', ['to-string', ['get', 'speedLevel']]],
          'icon-rotate': ['get', 'rotation'],
          // Grosor variable: calm=small, strong=large. Visual weight matches wind intensity.
          'icon-size': compact
            ? ['interpolate', ['linear'], ['get', 'speed'], 0, 0.35, 3, 0.45, 6, 0.55, 10, 0.65]
            : ['interpolate', ['linear'], ['get', 'speed'], 0, 0.55, 3, 0.7, 6, 0.9, 10, 1.1],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-rotation-alignment': 'map',
        }}
        paint={{
          'icon-opacity': ['interpolate', ['linear'], ['get', 'speed'],
            0, 0.3,   // calm: very subtle
            2, 0.5,   // light: visible
            5, 0.75,  // moderate: clear
            10, 0.9,  // strong: prominent
          ],
        }}
      />
    </Source>
  );
});
