/**
 * UVHazeOverlay — zone-based atmospheric effects that auto-activate.
 *
 * Two independent effects over the sector viewport:
 *
 * 1. **UV Glow**: Golden semi-transparent tint when UV index ≥ 8 (very high/extreme).
 *    Visual cue for skin protection — relevant for 4h+ on water.
 *
 * 2. **Haze/Calima**: Brown-gray semi-transparent overlay when PM2.5 > 35 or PM10 > 80.
 *    Represents reduced visibility — relevant for navigation safety.
 *    NOT about "air quality numbers" — about SEEING things on the water.
 *
 * Both use sector bbox as coverage zone. Intensity scales with severity.
 * No buttons — auto-reactive from airQualityStore data.
 */

import { memo, useMemo } from 'react';
import { Source, Layer } from 'react-map-gl/maplibre';
import { useSectorStore } from '../../store/sectorStore';
import { useAirQualityStore } from '../../store/airQualityStore';
import { SECTORS } from '../../config/sectors';

// Expanded bbox per sector (slightly larger than sector radius)
const SECTOR_BBOX = {
  embalse: { west: -8.35, east: -7.85, south: 42.10, north: 42.48 },
  rias: { west: -9.15, east: -8.30, south: 41.95, north: 42.70 },
} as const;

// UV glow config
const UV_THRESHOLD = 8;        // WHO "very high" — skin damage in <20min
const UV_EXTREME = 11;         // WHO "extreme"
const UV_COLOR_HIGH = 'rgba(251, 191, 36, 0.08)';      // amber-400 subtle
const UV_COLOR_EXTREME = 'rgba(245, 158, 11, 0.14)';   // amber-500 stronger

// Haze/calima config — based on visibility impact, not health
const PM25_THRESHOLD = 35;     // noticeable visibility reduction
const PM10_THRESHOLD = 80;     // calima/dust haze visible
const PM25_HEAVY = 75;         // thick haze
const HAZE_COLOR_LIGHT = 'rgba(168, 162, 138, 0.10)';  // warm gray
const HAZE_COLOR_HEAVY = 'rgba(148, 130, 100, 0.18)';  // brown haze

export const UVHazeOverlay = memo(function UVHazeOverlay() {
  const sectorId = useSectorStore((s) => s.activeSector.id);
  const current = useAirQualityStore((s) => s.current[sectorId]);

  const bbox = SECTOR_BBOX[sectorId as keyof typeof SECTOR_BBOX];

  // Determine UV effect
  const uvActive = (current?.uvIndex ?? 0) >= UV_THRESHOLD;
  const uvExtreme = (current?.uvIndex ?? 0) >= UV_EXTREME;
  const uvColor = uvExtreme ? UV_COLOR_EXTREME : UV_COLOR_HIGH;

  // Determine haze effect
  const pm25 = current?.pm2_5 ?? 0;
  const pm10 = current?.pm10 ?? 0;
  const hazeActive = pm25 > PM25_THRESHOLD || pm10 > PM10_THRESHOLD;
  const hazeHeavy = pm25 > PM25_HEAVY;
  const hazeColor = hazeHeavy ? HAZE_COLOR_HEAVY : HAZE_COLOR_LIGHT;

  // GeoJSON polygons for each effect
  const uvGeoJson = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!uvActive || !bbox) return null;
    return bboxPolygon(bbox, 'uv');
  }, [uvActive, bbox]);

  const hazeGeoJson = useMemo<GeoJSON.FeatureCollection | null>(() => {
    if (!hazeActive || !bbox) return null;
    return bboxPolygon(bbox, 'haze');
  }, [hazeActive, bbox]);

  if (!uvActive && !hazeActive) return null;

  return (
    <>
      {/* UV glow — golden tint */}
      {uvGeoJson && (
        <Source id="uv-glow-src" type="geojson" data={uvGeoJson}>
          <Layer
            id="uv-glow-fill"
            type="fill"
            paint={{
              'fill-color': uvColor,
              'fill-antialias': false,
            }}
          />
        </Source>
      )}

      {/* Haze/calima — visibility reduction tint */}
      {hazeGeoJson && (
        <Source id="haze-src" type="geojson" data={hazeGeoJson}>
          <Layer
            id="haze-fill"
            type="fill"
            paint={{
              'fill-color': hazeColor,
              'fill-antialias': false,
            }}
          />
        </Source>
      )}
    </>
  );
});

function bboxPolygon(
  bbox: { west: number; east: number; south: number; north: number },
  id: string,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { id },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [bbox.west, bbox.south],
          [bbox.east, bbox.south],
          [bbox.east, bbox.north],
          [bbox.west, bbox.north],
          [bbox.west, bbox.south],
        ]],
      },
    }],
  };
}
