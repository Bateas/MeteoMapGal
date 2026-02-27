import { useRef, useEffect, useCallback, memo } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { extractHumidityData, interpolateScalar } from '../../services/idwInterpolation';

// ── Configuration ──────────────────────────────────────────

const GRID_SIZE = 4; // px per cell (4×4 grid)
const DEBOUNCE_MS = 250;

// ── Color scale: dry (green) → humid (blue) → saturated (red) ──

function humidityColor(humidity: number): [number, number, number, number] {
  // 0-30%: dry — green
  // 30-60%: moderate — blue
  // 60-85%: humid — purple
  // 85-100%: saturated — red
  if (humidity < 30) {
    const t = humidity / 30;
    return [34 + t * 20, 197 - t * 40, 94 - t * 30, 120 + t * 40];
  }
  if (humidity < 60) {
    const t = (humidity - 30) / 30;
    return [54 - t * 20, 157 - t * 60, 64 + t * 100, 150 + t * 20];
  }
  if (humidity < 85) {
    const t = (humidity - 60) / 25;
    return [34 + t * 120, 97 - t * 50, 164 + t * 20, 160 + t * 30];
  }
  const t = Math.min((humidity - 85) / 15, 1);
  return [154 + t * 85, 47 - t * 20, 184 - t * 120, 180 + t * 40];
}

// ── Component ──────────────────────────────────────────────

interface HumidityHeatmapOverlayProps {
  mapRef: React.RefObject<MapRef | null>;
}

export const HumidityHeatmapOverlay = memo(function HumidityHeatmapOverlay({ mapRef }: HumidityHeatmapOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(0 as unknown as ReturnType<typeof setTimeout>);

  const activeLayer = useWeatherLayerStore((s) => s.activeLayer);
  const opacity = useWeatherLayerStore((s) => s.layerOpacity);
  const stations = useWeatherStore((s) => s.stations);
  const readings = useWeatherStore((s) => s.currentReadings);

  const isActive = activeLayer === 'humidity';

  // Draw heatmap grid
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

    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cols = Math.ceil(w / GRID_SIZE);
    const rows = Math.ceil(h / GRID_SIZE);

    // Create ImageData for fast pixel manipulation
    const imgData = ctx.createImageData(cols, rows);
    const pixels = imgData.data;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // Screen center of this grid cell
        const sx = (col + 0.5) * GRID_SIZE;
        const sy = (row + 0.5) * GRID_SIZE;

        // Unproject screen → geo
        const lngLat = map.unproject([sx, sy]);
        const humidity = interpolateScalar(lngLat.lat, lngLat.lng, humData);

        const [r, g, b, a] = humidityColor(humidity);
        const idx = (row * cols + col) * 4;
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = Math.round(a * opacity);
      }
    }

    // Draw the small ImageData scaled up to full canvas
    const tmpCanvas = document.createElement('canvas');
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
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(drawHeatmap, DEBOUNCE_MS);
  }, [drawHeatmap]);

  // Redraw on data change
  useEffect(() => {
    if (!isActive) return;
    drawHeatmap();
  }, [isActive, drawHeatmap]);

  // Redraw on map move
  useEffect(() => {
    if (!isActive) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    map.on('moveend', scheduleRedraw);
    map.on('zoomend', scheduleRedraw);

    const resizeObs = new ResizeObserver(scheduleRedraw);
    const canvas = canvasRef.current;
    if (canvas) resizeObs.observe(canvas);

    return () => {
      map.off('moveend', scheduleRedraw);
      map.off('zoomend', scheduleRedraw);
      resizeObs.disconnect();
      clearTimeout(timerRef.current);
    };
  }, [isActive, mapRef, scheduleRedraw]);

  if (!isActive) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 14 }}
    />
  );
});
