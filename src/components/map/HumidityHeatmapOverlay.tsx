import { useRef, useEffect, useCallback, memo } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { extractHumidityData, interpolateScalar } from '../../services/idwInterpolation';

// ── Configuration ──────────────────────────────────────────

const GRID_SIZE = 12; // px per cell — larger = faster, less detail
const DEBOUNCE_MS = 200;

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
  mapRef: React.RefObject<MapRef | null>;
}

export const HumidityHeatmapOverlay = memo(function HumidityHeatmapOverlay({ mapRef }: HumidityHeatmapOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tmpCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const activeLayer = useWeatherLayerStore((s) => s.activeLayer);
  const opacity = useWeatherLayerStore((s) => s.layerOpacity);
  const stations = useWeatherStore((s) => s.stations);
  const readings = useWeatherStore((s) => s.currentReadings);

  const isActive = activeLayer === 'humidity';

  // Draw heatmap grid — per-row unproject for Mercator-accurate coords
  const drawHeatmap = useCallback(() => {
    const canvas = canvasRef.current;
    const map = mapRef.current?.getMap();
    if (!canvas || !map) return;

    const humData = extractHumidityData(stations, readings);
    if (humData.length < 2) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cols = Math.ceil(w / GRID_SIZE);
    const rows = Math.ceil(h / GRID_SIZE);

    // Per-row unproject: 2 calls per row (~160 total) instead of 4 corners.
    // Eliminates Mercator projection error at any zoom level.
    const imgData = ctx.createImageData(cols, rows);
    const pixels = imgData.data;

    for (let row = 0; row < rows; row++) {
      const screenY = (row + 0.5) * GRID_SIZE;
      const leftGeo = map.unproject([0, screenY]);
      const rightGeo = map.unproject([w, screenY]);

      for (let col = 0; col < cols; col++) {
        const tx = (col + 0.5) / cols;
        const lng = leftGeo.lng + tx * (rightGeo.lng - leftGeo.lng);
        const lat = leftGeo.lat + tx * (rightGeo.lat - leftGeo.lat);

        const humidity = interpolateScalar(lat, lng, humData);

        const [r, g, b, a] = humidityColor(humidity);
        const idx = (row * cols + col) * 4;
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = Math.round(a * opacity);
      }
    }

    // Draw the small ImageData scaled up to full canvas (reuse canvas via ref)
    if (!tmpCanvasRef.current) tmpCanvasRef.current = document.createElement('canvas');
    const tmpCanvas = tmpCanvasRef.current;
    tmpCanvas.width = cols;
    tmpCanvas.height = rows;
    const tmpCtx = tmpCanvas.getContext('2d')!;
    tmpCtx.putImageData(imgData, 0, 0);

    // Scale up with smoothing for gradient effect
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tmpCanvas, 0, 0, cols, rows, 0, 0, canvas.width, canvas.height);
  }, [stations, readings, opacity, mapRef]);

  // Debounced redraw
  const scheduleRedraw = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(drawHeatmap, DEBOUNCE_MS);
  }, [drawHeatmap]);

  // Redraw on data change
  useEffect(() => {
    if (!isActive) return;
    drawHeatmap();
  }, [isActive, drawHeatmap]);

  // Redraw on map move/zoom (including during animation for smooth tracking)
  useEffect(() => {
    if (!isActive) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    // Redraw during movement (debounced) for visual continuity
    map.on('move', scheduleRedraw);
    map.on('zoom', scheduleRedraw);
    // Also redraw immediately at end of movement for final accuracy
    map.on('moveend', drawHeatmap);
    map.on('zoomend', drawHeatmap);

    const resizeObs = new ResizeObserver(scheduleRedraw);
    const canvas = canvasRef.current;
    if (canvas) resizeObs.observe(canvas);

    return () => {
      map.off('move', scheduleRedraw);
      map.off('zoom', scheduleRedraw);
      map.off('moveend', drawHeatmap);
      map.off('zoomend', drawHeatmap);
      resizeObs.disconnect();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isActive, mapRef, scheduleRedraw, drawHeatmap]);

  if (!isActive) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 14 }}
    />
  );
});
