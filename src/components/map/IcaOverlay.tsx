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
 *
 * Performance: the canvas is repainted only when the data, the size or the
 * finished view changes — never per frame while the map is moving. It used
 * to repaint on every `move` event (~60 per second while panning) and to
 * re-assign canvas.width each time, which reallocates a full-screen backing
 * store per frame: invisible on a big GPU, a stuttering pan on a modest
 * laptop. While the map moves, the last painting is shifted and scaled with
 * a CSS transform (composited, no repaint) so the plumes stay glued to the
 * map, and it is repainted properly on moveend.
 */

import { useRef, useEffect, useCallback, useState, memo } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { useIcaStore } from '../../store/icaStore';

const PLUME_RADIUS_KM = 18; // 18km realistic airshed for Galician valley/urban basins
const ACTIVATION_THRESHOLD = 3; // ICA ≥ 3 → deficiente+ → overlay activates

/**
 * Plume color and intensity based on ICA level.
 */
function getIcaPlumeColor(ica: number): { rgb: [number, number, number]; maxAlpha: number } {
  if (ica >= 4.5) {
    // Muy mala: purple
    return { rgb: [124, 58, 237], maxAlpha: 0.45 };
  }
  if (ica >= 3.8) {
    // Mala: red
    return { rgb: [220, 38, 38], maxAlpha: 0.40 };
  }
  // Deficiente (PM10/PM2.5): warm amber/orange
  return { rgb: [249, 115, 22], maxAlpha: 0.35 };
}

interface IcaOverlayProps {
  mapRef: React.RefObject<MapRef | null>;
}

export const IcaOverlay = memo(function IcaOverlay({ mapRef }: IcaOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Where the current painting was made: the map centre, its pixel position,
   *  zoom and bearing. The move handler maps the painting onto the live view
   *  from these, without repainting. */
  const paintedAtRef = useRef<{ lng: number; lat: number; x: number; y: number; zoom: number; bearing: number } | null>(null);
  const moveFrameRef = useRef<number | null>(null);

  const readings = useIcaStore((s) => s.readings);

  // Session-wide dismiss: user can hide the overlay even when auto-active
  const [dismissedAtMaxIca, setDismissedAtMaxIca] = useState<number | null>(null);

  // Auto-activate: only when at least one station reports ICA ≥ 3.
  const debugForce = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('icaDebug') === '1';
  const maxIca = readings.length > 0
    ? readings.reduce((m, r) => (r.ica > m ? r.ica : m), 0)
    : 0;
  const shouldAutoActivate = debugForce
    ? readings.length >= 2
    : maxIca >= ACTIVATION_THRESHOLD;

  const isActive = shouldAutoActivate
    && (dismissedAtMaxIca === null || maxIca > dismissedAtMaxIca + 0.3);

  const drawHeatmap = useCallback(() => {
    const canvas = canvasRef.current;
    const map = mapRef.current?.getMap();
    if (!canvas || !map) return;

    // Filter stations that have elevated ICA (Deficiente or worse)
    const affectedStations = debugForce
      ? [...readings].sort((a, b) => b.ica - a.ica).slice(0, 2)
      : readings.filter((r) => r.ica >= 2.8);

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    // Assigning width/height reallocates the backing store (and clears it):
    // only when the size really changed.
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // The painting now matches the live view exactly.
    const c = map.getCenter();
    const cp = map.project(c);
    paintedAtRef.current = { lng: c.lng, lat: c.lat, x: cp.x, y: cp.y, zoom: map.getZoom(), bearing: map.getBearing() };
    canvas.style.transform = '';
    canvas.style.opacity = '';

    if (affectedStations.length === 0) return;

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Draw smooth atmospheric plumes for each affected station
    for (const r of affectedStations) {
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;

      const p0 = map.project([r.lon, r.lat]);
      const kmPerDegreeLon = 111 * Math.cos((r.lat * Math.PI) / 180);
      const pEdge = map.project([r.lon + PLUME_RADIUS_KM / kmPerDegreeLon, r.lat]);
      const radiusPx = Math.max(30, Math.hypot(pEdge.x - p0.x, pEdge.y - p0.y));

      // Skip if completely out of viewport bounds
      if (p0.x + radiusPx < 0 || p0.x - radiusPx > w || p0.y + radiusPx < 0 || p0.y - radiusPx > h) {
        continue;
      }

      const { rgb, maxAlpha } = getIcaPlumeColor(r.ica);
      const [cr, cg, cb] = rgb;

      const grad = ctx.createRadialGradient(p0.x, p0.y, 0, p0.x, p0.y, radiusPx);
      grad.addColorStop(0.0, `rgba(${cr}, ${cg}, ${cb}, ${maxAlpha})`);
      grad.addColorStop(0.35, `rgba(${cr}, ${cg}, ${cb}, ${maxAlpha * 0.70})`);
      grad.addColorStop(0.65, `rgba(${cr}, ${cg}, ${cb}, ${maxAlpha * 0.28})`);
      grad.addColorStop(0.85, `rgba(${cr}, ${cg}, ${cb}, ${maxAlpha * 0.08})`);
      grad.addColorStop(1.0, `rgba(${cr}, ${cg}, ${cb}, 0)`); // Completely transparent at edge

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p0.x, p0.y, radiusPx, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. Draw station pins and informative tags on top
    for (const r of affectedStations) {
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) continue;

      const p0 = map.project([r.lon, r.lat]);
      if (p0.x < -50 || p0.x > w + 50 || p0.y < -50 || p0.y > h + 50) continue;

      const { rgb } = getIcaPlumeColor(r.ica);
      const [cr, cg, cb] = rgb;

      // Outer halo
      ctx.beginPath();
      ctx.arc(p0.x, p0.y, 9, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, 0.6)`;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Center dot
      ctx.beginPath();
      ctx.arc(p0.x, p0.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${cr}, ${cg}, ${cb})`;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Station pill tag: e.g. "Ourense · PM10 Deficiente"
      const pollutant = r.dominantPollutant ? r.dominantPollutant.toUpperCase() : 'PM10';
      const label = `${r.station} · ${pollutant} ${r.categoryEs || 'Deficiente'}`;
      ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      const textW = ctx.measureText(label).width;
      const pillW = textW + 14;
      const pillH = 18;
      const pillX = p0.x - pillW / 2;
      const pillY = p0.y + 11;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
      ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, 0.85)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (typeof (ctx as any).roundRect === 'function') {
        (ctx as any).roundRect(pillX, pillY, pillW, pillH, 9);
      } else {
        ctx.rect(pillX, pillY, pillW, pillH);
      }
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, p0.x, pillY + pillH / 2);
    }

    ctx.restore();
  }, [readings, mapRef, debugForce]);

  const scheduleRedraw = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(drawHeatmap, 50);
  }, [drawHeatmap]);

  // Redraw on data change
  useEffect(() => {
    if (!isActive) return;
    drawHeatmap();
  }, [isActive, drawHeatmap]);

  // While the map moves: shift and scale the last painting to follow it (one
  // project() per frame, composited transform). Repaint only on moveend.
  useEffect(() => {
    if (!isActive) return;
    const map = mapRef.current?.getMap();
    if (!map) return;

    const followMap = () => {
      moveFrameRef.current = null;
      const canvas = canvasRef.current;
      const at = paintedAtRef.current;
      if (!canvas || !at) return;
      if (Math.abs(map.getBearing() - at.bearing) > 0.01) {
        // A rotation cannot be followed with this transform: hide until the
        // repaint at moveend rather than show plumes in the wrong place.
        canvas.style.opacity = '0';
        return;
      }
      const p = map.project([at.lng, at.lat]);
      const k = Math.pow(2, map.getZoom() - at.zoom);
      canvas.style.transformOrigin = '0 0';
      canvas.style.transform = `translate(${p.x - k * at.x}px, ${p.y - k * at.y}px) scale(${k})`;
    };
    const onMove = () => {
      if (moveFrameRef.current === null) moveFrameRef.current = requestAnimationFrame(followMap);
    };

    map.on('move', onMove);
    map.on('moveend', drawHeatmap);

    const resizeObs = new ResizeObserver(scheduleRedraw);
    const canvas = canvasRef.current;
    if (canvas) resizeObs.observe(canvas);

    return () => {
      map.off('move', onMove);
      map.off('moveend', drawHeatmap);
      resizeObs.disconnect();
      if (timerRef.current) clearTimeout(timerRef.current);
      if (moveFrameRef.current !== null) cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = null;
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
