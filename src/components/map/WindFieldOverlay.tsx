import { useMemo, memo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import type maplibregl from 'maplibre-gl';
import type { NormalizedStation, NormalizedReading } from '../../types/station';

interface WindFieldOverlayProps {
  stations: NormalizedStation[];
  readings: Map<string, NormalizedReading>;
  /** When true, uses smaller arrows and skips outer ring (for dense sectors). */
  compact?: boolean;
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

/**
 * Speed-based color palette for wind arrows.
 * Each level gets a unique icon registered on the map.
 */
const SPEED_LEVELS = [
  { id: 'wind-arrow-0', color: '#60a5fa', maxSpeed: 1.5 },  // blue-400  — calm
  { id: 'wind-arrow-1', color: '#38bdf8', maxSpeed: 3 },    // sky-400   — light
  { id: 'wind-arrow-2', color: '#34d399', maxSpeed: 5 },    // emerald   — moderate
  { id: 'wind-arrow-3', color: '#fbbf24', maxSpeed: 8 },    // amber-400 — fresh
  { id: 'wind-arrow-4', color: '#f97316', maxSpeed: 12 },   // orange-500— strong
  { id: 'wind-arrow-5', color: '#ef4444', maxSpeed: Infinity }, // red-500 — gale
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
    const cy = size / 2;
    const outlineW = Math.max(2, size / 14);
    const shaftW = Math.max(4, size / 9);

    // --- Draw dark outline (thicker, behind the colored fill) ---
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Outline: shaft
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = shaftW + outlineW * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy + size * 0.22);
    ctx.lineTo(cx, cy - size * 0.12);
    ctx.stroke();

    // Outline: arrowhead
    ctx.lineWidth = outlineW * 2;
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.22, cy - size * 0.08);
    ctx.lineTo(cx, cy - size * 0.42);
    ctx.lineTo(cx + size * 0.22, cy - size * 0.08);
    ctx.closePath();
    ctx.stroke();

    // --- Draw colored arrow on top ---
    // Shaft
    ctx.strokeStyle = arrowColor;
    ctx.lineWidth = shaftW;
    ctx.beginPath();
    ctx.moveTo(cx, cy + size * 0.22);
    ctx.lineTo(cx, cy - size * 0.12);
    ctx.stroke();

    // Arrowhead
    ctx.fillStyle = arrowColor;
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.22, cy - size * 0.08);
    ctx.lineTo(cx, cy - size * 0.42);
    ctx.lineTo(cx + size * 0.22, cy - size * 0.08);
    ctx.closePath();
    ctx.fill();

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
  compact = false,
}: WindFieldOverlayProps) {
  const geojson = useMemo<GeoJSON.FeatureCollection>(() => {
    const features: GeoJSON.Feature[] = [];
    const offsetScale = compact ? 0.6 : 1;

    for (const station of stations) {
      if (station.tempOnly) continue; // no wind sensor → no arrows
      const reading = readings.get(station.id);
      if (
        !reading ||
        reading.windDirection === null ||
        reading.windSpeed === null ||
        reading.windSpeed < 0.1
      ) {
        continue;
      }

      // Arrow points where wind goes TO
      const rotation = (reading.windDirection + 180) % 360;
      const level = speedToLevel(reading.windSpeed);

      // Inner ring
      for (let i = 0; i < OFFSETS.length; i++) {
        const [dx, dy] = OFFSETS[i];
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [
              station.lon + dx * OFFSET_LON * offsetScale,
              station.lat + dy * OFFSET_LAT * offsetScale,
            ],
          },
          properties: {
            rotation,
            speed: reading.windSpeed,
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
                station.lon + dx * OFFSET_LON * 1.8,
                station.lat + dy * OFFSET_LAT * 1.8,
              ],
            },
            properties: {
              rotation,
              speed: reading.windSpeed,
              speedLevel: level,
              opacity: 0.5,
            },
          });
        }
      }
    }

    if (features.length === 0) return EMPTY_FC;

    return {
      type: 'FeatureCollection',
      features,
    };
  }, [stations, readings, compact]);

  return (
    <Source id="wind-field" type="geojson" data={geojson}>
      <Layer
        id="wind-field-arrows"
        type="symbol"
        layout={{
          'icon-image': ['concat', 'wind-arrow-', ['to-string', ['get', 'speedLevel']]],
          'icon-rotate': ['get', 'rotation'],
          'icon-size': compact ? 0.55 : 0.9,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-rotation-alignment': 'map',
        }}
        paint={{
          'icon-opacity': ['get', 'opacity'],
        }}
      />
    </Source>
  );
});
