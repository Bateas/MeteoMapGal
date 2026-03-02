import { useRef, useEffect, useCallback, memo } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { extractHumidityData, interpolateScalar } from '../../services/idwInterpolation';

// ── Configuration ──────────────────────────────────────────

const GRID_SIZE = 12; // px per cell — larger = faster, less detail
const DEBOUNCE_MS = 200;

// ── Color scale: dry (green) → humid (blue) → saturated (red) ──

function humidityColor(humidity: number): [number, number, number, number] {
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

  // Draw heatmap grid — optimized to avoid per-cell unproject()
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

    // Pre-compute geo bounds from map corners (only 4 unproject calls)
    const topLeft = map.unproject([0, 0]);
    const topRight = map.unproject([w, 0]);
    const bottomLeft = map.unproject([0, h]);
    const bottomRight = map.unproject([w, h]);

    // Bilinear interpolation factors for lat/lon per cell
    // This avoids 60,000+ unproject() calls
    const lngLeft = (topLeft.lng + bottomLeft.lng) / 2;
    const lngRight = (topRight.lng + bottomRight.lng) / 2;
    const latTop = (topLeft.lat + topRight.lat) / 2;
    const latBottom = (bottomLeft.lat + bottomRight.lat) / 2;

    // Create ImageData for fast pixel manipulation
    const imgData = ctx.createImageData(cols, rows);
    const pixels = imgData.data;

    for (let row = 0; row < rows; row++) {
      const ty = (row + 0.5) / rows; // 0..1 from top to bottom
      const lat = latTop + ty * (latBottom - latTop);

      for (let col = 0; col < cols; col++) {
        const tx = (col + 0.5) / cols; // 0..1 from left to right
        const lng = lngLeft + tx * (lngRight - lngLeft);

        const humidity = interpolateScalar(lat, lng, humData);

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
