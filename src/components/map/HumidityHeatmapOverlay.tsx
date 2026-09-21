import { useRef, useEffect, useCallback, memo } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import type maplibregl from 'maplibre-gl';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { extractHumidityData, interpolateScalar } from '../../services/idwInterpolation';

// ── Configuration ──────────────────────────────────────────

const DEBOUNCE_MS = 250;
const COLS = 120;
const ROWS = 90;
const BUFFER_RATIO = 0.30; // 30% padding around viewport so panning stays seamlessly textured

const SOURCE_ID = 'humidity-heatmap-source';
const LAYER_ID = 'humidity-heatmap-layer';

// ── Color scale: dry (orange/red) → moderate (yellow/green) → humid (blue/dark blue) ──

function humidityColor(humidity: number): [number, number, number, number] {
  if (humidity < 30) {
    // Very dry: red-orange → orange  [239,115,22] → [245,158,11]
    const t = humidity / 30;
    return [239 + t * 6, 115 + t * 43, 22 - t * 11, 100 + t * 40];
  }
  if (humidity < 50) {
    // Dry: orange → yellow  [245,158,11] → [234,179,8]
    const t = (humidity - 30) / 20;
    return [245 - t * 11, 158 + t * 21, 11 - t * 3, 130 + t * 20];
  }
  if (humidity < 70) {
    // Moderate: yellow → green  [234,179,8] → [34,197,94]
    const t = (humidity - 50) / 20;
    return [234 - t * 200, 179 + t * 18, 8 + t * 86, 140 + t * 20];
  }
  if (humidity < 85) {
    // Humid: green → blue  [34,197,94] → [59,130,246]
    const t = (humidity - 70) / 15;
    return [34 + t * 25, 197 - t * 67, 94 + t * 152, 155 + t * 25];
  }
  // Very humid: blue → dark blue  [59,130,246] → [30,64,175]
  const t = Math.min((humidity - 85) / 15, 1);
  return [59 - t * 29, 130 - t * 66, 246 - t * 71, 175 + t * 40];
}

// ── Component ──────────────────────────────────────────────

interface HumidityHeatmapOverlayProps {
  mapRef?: React.RefObject<MapRef | null>;
}

export const HumidityHeatmapOverlay = memo(function HumidityHeatmapOverlay({ mapRef: propMapRef }: HumidityHeatmapOverlayProps) {
  const { current: contextMapRef } = useMap();
  const mapRef = propMapRef ?? { current: contextMapRef };

  const activeLayer = useWeatherLayerStore((s) => s.activeLayer);
  const opacity = useWeatherLayerStore((s) => s.layerOpacity);
  const stations = useWeatherStore((s) => s.stations);
  const readings = useWeatherStore((s) => s.currentReadings);

  const isActive = activeLayer === 'humidity';

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const cleanupLayers = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    try {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    } catch {
      // Map may be destroying or style not loaded
    }
  }, [mapRef]);

  const computeHeatmapRaster = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || !map.getStyle()) return;

    const humData = extractHumidityData(stations, readings);
    if (humData.length < 2) {
      if (map.getLayer(LAYER_ID)) {
        try { map.setLayoutProperty(LAYER_ID, 'visibility', 'none'); } catch { /* ignore */ }
      }
      return;
    }

    const b = map.getBounds();
    const lonSpan = b.getEast() - b.getWest();
    const latSpan = b.getNorth() - b.getSouth();
    const padLon = lonSpan * BUFFER_RATIO;
    const padLat = latSpan * BUFFER_RATIO;

    const west = b.getWest() - padLon;
    const east = b.getEast() + padLon;
    const south = b.getSouth() - padLat;
    const north = b.getNorth() + padLat;

    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }
    const canvas = canvasRef.current;
    canvas.width = COLS;
    canvas.height = ROWS;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imgData = ctx.createImageData(COLS, ROWS);
    const pixels = imgData.data;

    const spanLon = east - west;
    const spanLat = north - south;

    for (let row = 0; row < ROWS; row++) {
      // row 0 is North (top of image), row (ROWS-1) is South
      const lat = north - ((row + 0.5) / ROWS) * spanLat;
      const rowOffset = row * COLS * 4;

      for (let col = 0; col < COLS; col++) {
        const lon = west + ((col + 0.5) / COLS) * spanLon;
        const humidity = interpolateScalar(lat, lon, humData);
        const [r, g, b, a] = humidityColor(humidity);

        const idx = rowOffset + col * 4;
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = a;
      }
    }

    ctx.putImageData(imgData, 0, 0);

    const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
      [west, north], // top-left
      [east, north], // top-right
      [east, south], // bottom-right
      [west, south], // bottom-left
    ];

    try {
      const existingSource = map.getSource(SOURCE_ID) as maplibregl.CanvasSource | undefined;
      if (existingSource) {
        existingSource.setCoordinates(coordinates);
        if (typeof existingSource.play === 'function' && typeof existingSource.pause === 'function') {
          existingSource.play();
          existingSource.pause();
        }
        if (map.getLayer(LAYER_ID)) {
          map.setLayoutProperty(LAYER_ID, 'visibility', 'visible');
          map.setPaintProperty(LAYER_ID, 'raster-opacity', opacity);
        }
        map.triggerRepaint();
      } else {
        // Add native canvas source directly bound to offscreen canvas — zero fetch(), zero CSP issues
        map.addSource(SOURCE_ID, {
          type: 'canvas',
          canvas,
          coordinates,
          animate: false,
        });

        // Insert under station symbols and wind arrows
        const candidateLayers = ['stations-source-ring', 'stations-icons', 'wind-field-arrows', 'spot-markers'];
        const beforeId = candidateLayers.find((id) => map.getLayer(id));

        map.addLayer(
          {
            id: LAYER_ID,
            type: 'raster',
            source: SOURCE_ID,
            paint: {
              'raster-opacity': opacity,
              'raster-fade-duration': 0,
              'raster-resampling': 'linear',
            },
          },
          beforeId,
        );
      }
    } catch (err) {
      console.warn('[HumidityHeatmap] Error updating canvas source:', err);
    }
  }, [stations, readings, opacity, mapRef]);

  const scheduleUpdate = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(computeHeatmapRaster, DEBOUNCE_MS);
  }, [computeHeatmapRaster]);

  // Compute raster when active or when stations/readings change
  useEffect(() => {
    if (!isActive) {
      cleanupLayers();
      return;
    }
    computeHeatmapRaster();
  }, [isActive, computeHeatmapRaster, cleanupLayers]);

  // Fast opacity update without recomputing IDW
  useEffect(() => {
    if (!isActive) return;
    const map = mapRef.current?.getMap();
    if (!map || !map.getLayer(LAYER_ID)) return;
    try {
      map.setPaintProperty(LAYER_ID, 'raster-opacity', opacity);
    } catch { /* ignore */ }
  }, [isActive, opacity, mapRef]);

  // Recompute texture when map movement ends
  useEffect(() => {
    if (!isActive) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    map.on('moveend', scheduleUpdate);

    return () => {
      map.off('moveend', scheduleUpdate);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isActive, mapRef, scheduleUpdate]);

  // Re-attach layer if map style reloads while overlay is active
  useEffect(() => {
    if (!isActive) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    const handleStyleData = () => {
      if (!map.getSource(SOURCE_ID)) {
        computeHeatmapRaster();
      }
    };

    map.on('styledata', handleStyleData);
    return () => {
      map.off('styledata', handleStyleData);
    };
  }, [isActive, mapRef, computeHeatmapRaster]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupLayers();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [cleanupLayers]);

  return null;
});
