/**
 * ICA (Índice de Calidade do Aire) heatmap overlay.
 *
 * Reactive map: auto-activates ONLY when any Galician air-quality station
 * reports value ≥ 3 ("Deficiente" or worse). When the air is clean
 * (1=Buena / 2=Aceptable everywhere) the overlay stays hidden — no
 * decoration, only signal.
 *
 * Spatial interpolation:
 *   ~30 ICA stations across Galicia → IDW with maxRadius 50km gives a
 *   smooth surface that highlights problematic zones. Power 2.5 keeps
 *   peaks (a single bad station) visible without bleeding into clean
 *   neighbors.
 *
 * Colors: matches the official Spanish ICA scale
 *   1 buena      → green   #16a34a
 *   2 aceptable  → yellow  #fde047
 *   3 deficiente → orange  #f97316
 *   4 mala       → red     #dc2626
 *   5 muy mala   → purple  #7c3aed
 *
 * Coverage: regional (Galicia-wide). Renders in BOTH sectors when active —
 * pollution events affect both Embalse interior and Rías coast simultaneously.
 *
 * Pattern based on HumidityHeatmapOverlay: per-row unproject + small
 * ImageData scaled up for smooth gradient at 12px grid cells.
 */

import { useRef, useEffect, useCallback, useState, memo } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { useIcaStore } from '../../store/icaStore';
import { interpolateScalar } from '../../services/idwInterpolation';
import type { StationScalarData } from '../../services/idwInterpolation';

const GRID_SIZE = 14; // px per cell
const DEBOUNCE_MS = 200;
const MAX_RADIUS_KM = 50; // ~30 stations / Galicia → wider radius than humidity
const ACTIVATION_THRESHOLD = 3; // ICA ≥ 3 → deficiente+ → overlay activates

/**
 * Color scale mapping decimal ICA (1-5) to RGBA. Continuous gradient
 * between bucket boundaries to avoid stripey banding.
 */
function icaColor(value: number): [number, number, number, number] {
  // Clamp 1-5
  const v = Math.max(1, Math.min(5, value));

  if (v < 2) {
    // 1-2: green → yellow  [22,163,74] → [253,224,71]
    const t = v - 1;
    return [22 + t * 231, 163 + t * 61, 74 - t * 3, 110 + t * 30];
  }
  if (v < 3) {
    // 2-3: yellow → orange  [253,224,71] → [249,115,22]
    const t = v - 2;
    return [253 - t * 4, 224 - t * 109, 71 - t * 49, 140 + t * 30];
  }
  if (v < 4) {
    // 3-4: orange → red  [249,115,22] → [220,38,38]
    const t = v - 3;
    return [249 - t * 29, 115 - t * 77, 22 + t * 16, 170 + t * 25];
  }
  // 4-5: red → purple  [220,38,38] → [124,58,237]
  const t = Math.min(v - 4, 1);
  return [220 - t * 96, 38 + t * 20, 38 + t * 199, 195 + t * 30];
}

/** Build IDW input from ICA readings — straight mapping, no freshness decay
 *  (ICA cadence is hourly, all readings within 1h are equally fresh). */
function buildIcaScalarData(readings: { lat: number; lon: number; ica: number }[]): StationScalarData[] {
  return readings.map((r) => ({
    lat: r.lat,
    lon: r.lon,
    value: r.ica,
    freshness: 1.0,
  }));
}

interface IcaOverlayProps {
  mapRef: React.RefObject<MapRef | null>;
}

export const IcaOverlay = memo(function IcaOverlay({ mapRef }: IcaOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tmpCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const readings = useIcaStore((s) => s.readings);

  // Session-wide dismiss: user can hide the overlay even when auto-active
  // (S136+3+3 user feedback "no lo puedo desactivar"). Re-shows on a NEW
  // reading set (e.g. air quality worsens further to a new max ICA).
  const [dismissedAtMaxIca, setDismissedAtMaxIca] = useState<number | null>(null);

  // Auto-activate: only when at least one station reports ICA ≥ 3.
  // Debug override: ?icaDebug=1 forces the overlay on for visual QA when
  // air is clean (galicia averages 1-2 most days). Read once at mount —
  // no need to react to URL changes.
  const debugForce = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('icaDebug') === '1';
  const maxIca = readings.length > 0
    ? readings.reduce((m, r) => (r.ica > m ? r.ica : m), 0)
    : 0;
  const shouldAutoActivate = debugForce
    ? readings.length >= 2
    : maxIca >= ACTIVATION_THRESHOLD;
  // If dismissed at a given max-ICA, stay hidden until air quality WORSENS
  // beyond that point. Prevents the overlay re-appearing on every refresh
  // for the same event the user already acknowledged.
  const isActive = shouldAutoActivate
    && (dismissedAtMaxIca === null || maxIca > dismissedAtMaxIca + 0.3);

  const drawHeatmap = useCallback(() => {
    const canvas = canvasRef.current;
    const map = mapRef.current?.getMap();
    if (!canvas || !map) return;

    const data = buildIcaScalarData(readings);
    if (data.length < 2) return;

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

        const value = interpolateScalar(lat, lng, data, 2.5, MAX_RADIUS_KM);
        // PAINT_THRESHOLD = only show cells where the interpolated value is
        // at or above "aceptable+" (≥ 2.5). Below that the air is "good
        // enough" and the overlay was effectively painting all of Galicia
        // with a green/yellow gradient even when only ONE station had ICA≥3.
        // Reactive-map philosophy (S136+3+3 user feedback): if it doesn't
        // change my decision RIGHT NOW, don't show it.
        const PAINT_THRESHOLD = 2.5;
        if (value < PAINT_THRESHOLD) {
          const idx = (row * cols + col) * 4;
          pixels[idx + 3] = 0;
          continue;
        }

        const [r, g, b, a] = icaColor(value);
        const idx = (row * cols + col) * 4;
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        // Dim 50% — much less intrusive than original 110-225 alpha.
        // Combined with the threshold above, the overlay now ONLY highlights
        // problematic zones (deficiente+) with a subtle tint instead of
        // tinting the entire region.
        pixels[idx + 3] = Math.round(a * 0.5);
      }
    }

    if (!tmpCanvasRef.current) tmpCanvasRef.current = document.createElement('canvas');
    const tmpCanvas = tmpCanvasRef.current;
    tmpCanvas.width = cols;
    tmpCanvas.height = rows;
    const tmpCtx = tmpCanvas.getContext('2d')!;
    tmpCtx.putImageData(imgData, 0, 0);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tmpCanvas, 0, 0, cols, rows, 0, 0, canvas.width, canvas.height);
  }, [readings, mapRef]);

  const scheduleRedraw = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(drawHeatmap, DEBOUNCE_MS);
  }, [drawHeatmap]);

  // Redraw on data change
  useEffect(() => {
    if (!isActive) return;
    drawHeatmap();
  }, [isActive, drawHeatmap]);

  // Redraw on map move/zoom
  useEffect(() => {
    if (!isActive) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    map.on('moveend', drawHeatmap);
    map.on('zoomend', drawHeatmap);

    const resizeObs = new ResizeObserver(scheduleRedraw);
    const canvas = canvasRef.current;
    if (canvas) resizeObs.observe(canvas);

    return () => {
      map.off('moveend', drawHeatmap);
      map.off('zoomend', drawHeatmap);
      resizeObs.disconnect();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isActive, mapRef, drawHeatmap, scheduleRedraw]);

  if (!isActive) return null;

  // Worst station for the badge — auto-active overlays must SIGNAL what
  // they are (S136+3+3 user feedback: "¿qué es esto verde/amarillo? ¿CAPE?").
  // The label clarifies the user isn't looking at radiation or convection.
  const worst = readings.length > 0
    ? readings.reduce((max, r) => (r.ica > max.ica ? r : max), readings[0])
    : null;
  const worstLabel = worst === null ? '—'
    : worst.ica >= 4 ? 'Mala'
    : worst.ica >= 3 ? 'Deficiente'
    : worst.ica >= 2 ? 'Aceptable'
    : 'Buena';
  const labelColor = worst !== null && worst.ica >= 4 ? 'bg-red-600/85 border-red-400/70'
    : worst !== null && worst.ica >= 3 ? 'bg-orange-600/80 border-orange-400/70'
    : 'bg-amber-600/75 border-amber-400/70';
  const pollutant = worst?.dominantPollutant ? ` · ${worst.dominantPollutant}` : '';

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ zIndex: 13 }}
      />
      {/* Active overlay badge — discreet identifier + dismiss button.
          Position history: bottom-left collided with the layers toolbar; top-2
          collided with the SectorSelector pills (Rías/Embalse, absolute top-2
          left-2 on desktop). Parked at top-14 left-2 → sits BELOW the sector
          pills on desktop and over empty map on mobile (selector is hidden
          there). Zoom + style selector live top-right, alert banner top-center,
          toolbar bottom — this gap is clear. */}
      <div
        className={`absolute top-14 left-2 text-[10px] font-semibold text-white pl-2 pr-1 py-1 rounded border flex items-center gap-2 ${labelColor}`}
        style={{ zIndex: 14, pointerEvents: 'auto' }}
      >
        <span>Calidad aire (ICA) · {worstLabel}{pollutant}</span>
        <button
          onClick={() => setDismissedAtMaxIca(maxIca)}
          className="text-white/80 hover:text-white text-[12px] leading-none px-1.5 py-0.5 rounded hover:bg-black/30 transition-colors"
          title="Ocultar (vuelve a aparecer si empeora)"
          aria-label="Ocultar capa de calidad del aire"
        >
          ×
        </button>
      </div>
    </>
  );
});
