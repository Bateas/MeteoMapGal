import { useRef, useEffect, useCallback, memo } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { useUIStore } from '../../store/uiStore';
import { useBuoyStore } from '../../store/buoyStore';
import { extractWindData, extractBuoyWindData, buildWindGrid, lookupWindGrid } from '../../services/idwInterpolation';
import type { WindGrid } from '../../services/idwInterpolation';
import { windSpeedColor } from '../../services/windUtils';

// ── Configuration ──────────────────────────────────────────

const PARTICLE_COUNT_DESKTOP = 250; // was 400 — fewer particles, less project() calls
const PARTICLE_COUNT_MOBILE = 100; // was 150
const FADE_ALPHA = 0.94;
const PARTICLE_MAX_AGE = 100;
// Base speed calibrated for zoom ~10 (Galician scale ~50km viewport).
// Scaled down at higher zooms to prevent particles from racing across screen.
const SPEED_SCALE_BASE = 0.0006;
const SPEED_SCALE_REF_ZOOM = 10;
const LINE_WIDTH_BASE = 1.8;
const LINE_WIDTH_MAX = 3.5;

// ── Particle type ──────────────────────────────────────────

interface Particle {
  lon: number;
  lat: number;
  age: number;
  maxAge: number;
}

// ── Component ──────────────────────────────────────────────

interface WindParticleOverlayProps {
  mapRef: React.RefObject<MapRef | null>;
}

export const WindParticleOverlay = memo(function WindParticleOverlay({ mapRef }: WindParticleOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const trailCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const activeLayer = useWeatherLayerStore((s) => s.activeLayer);
  const opacity = useWeatherLayerStore((s) => s.layerOpacity);
  const stations = useWeatherStore((s) => s.stations);
  const readings = useWeatherStore((s) => s.currentReadings);
  const buoys = useBuoyStore((s) => s.buoys);
  const isMobile = useUIStore((s) => s.isMobile);

  const isActive = activeLayer === 'wind-particles';
  const particleCount = isMobile ? PARTICLE_COUNT_MOBILE : PARTICLE_COUNT_DESKTOP;

  // Build wind data when stations/readings/buoys change — merges weather stations + marine buoys
  const windDataRef = useRef(extractWindData(stations, readings));
  const windGridRef = useRef<WindGrid | null>(null);
  const gridBoundsRef = useRef<string>('');
  const mapMovingRef = useRef(false);

  useEffect(() => {
    const stationWind = extractWindData(stations, readings);
    const buoyWind = extractBuoyWindData(buoys);
    windDataRef.current = [...stationWind, ...buoyWind];
    // Invalidate grid — will be rebuilt on next frame with current viewport
    windGridRef.current = null;
  }, [stations, readings, buoys]);

  // Spawn a particle at random position within map bounds
  const spawnParticle = useCallback((bounds?: { w: number; e: number; s: number; n: number }): Particle => {
    const map = mapRef.current?.getMap();
    if (!map) {
      return { lon: -8.1, lat: 42.29, age: 0, maxAge: PARTICLE_MAX_AGE };
    }
    // Use cached bounds if provided, otherwise fetch
    let w: number, e: number, s: number, n: number;
    if (bounds) {
      ({ w, e, s, n } = bounds);
    } else {
      const b = map.getBounds();
      w = b.getWest(); e = b.getEast(); s = b.getSouth(); n = b.getNorth();
    }
    const lon = w + Math.random() * (e - w);
    const lat = s + Math.random() * (n - s);
    const maxAge = PARTICLE_MAX_AGE * (0.6 + Math.random() * 0.8);
    return { lon, lat, age: 0, maxAge };
  }, [mapRef]);

  // Initialize particles
  useEffect(() => {
    if (!isActive) return;
    particlesRef.current = Array.from({ length: particleCount }, () => spawnParticle());
  }, [isActive, particleCount, spawnParticle]);

  // Animation loop
  useEffect(() => {
    if (!isActive) {
      cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const canvas = canvasRef.current;
    const map = mapRef.current?.getMap();
    if (!canvas || !map) return;

    // Create off-screen trail canvas for fade effect
    if (!trailCanvasRef.current) {
      trailCanvasRef.current = document.createElement('canvas');
    }
    const trailCanvas = trailCanvasRef.current;

    // On mobile, use DPR=1 for performance (halves canvas pixel count)
    const effectiveDpr = isMobile ? 1 : (window.devicePixelRatio || 1);

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * effectiveDpr;
      canvas.height = h * effectiveDpr;
      trailCanvas.width = canvas.width;
      trailCanvas.height = canvas.height;
    };
    resize();

    const ctx = canvas.getContext('2d');
    const trailCtx = trailCanvas.getContext('2d');
    if (!ctx || !trailCtx) return;

    const animate = () => {
      // Skip animation during map pan/zoom — frees frame budget for smooth dragging
      if (mapMovingRef.current) {
        animFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      const dpr = effectiveDpr;
      const w = canvas.width;
      const h = canvas.height;

      // Check canvas size
      const actualW = canvas.clientWidth * dpr;
      const actualH = canvas.clientHeight * dpr;
      if (w !== actualW || h !== actualH) {
        canvas.width = actualW;
        canvas.height = actualH;
        trailCanvas.width = actualW;
        trailCanvas.height = actualH;
      }

      const windData = windDataRef.current;
      if (windData.length === 0) {
        animFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      // Fade trails on trail canvas
      trailCtx.globalCompositeOperation = 'destination-in';
      trailCtx.fillStyle = `rgba(0, 0, 0, ${FADE_ALPHA})`;
      trailCtx.fillRect(0, 0, w, h);
      trailCtx.globalCompositeOperation = 'source-over';

      // ── PERF: Cache bounds ONCE per frame ──
      const mapBounds = map.getBounds();
      const bw = mapBounds.getWest() - 0.1;
      const be = mapBounds.getEast() + 0.1;
      const bs = mapBounds.getSouth() - 0.1;
      const bn = mapBounds.getNorth() + 0.1;
      const cachedBounds = {
        w: mapBounds.getWest(),
        e: mapBounds.getEast(),
        s: mapBounds.getSouth(),
        n: mapBounds.getNorth(),
      };

      // ── PERF: Pre-compute wind grid (rebuild only when bounds/data change) ──
      // Replaces per-particle IDW (O(particles × stations) → O(1) bilinear lookup).
      // Grid: 24×24 = 576 IDW calls on rebuild vs 24,000 IDW calls/sec before.
      const boundsKey = `${bw.toFixed(3)},${be.toFixed(3)},${bs.toFixed(3)},${bn.toFixed(3)}`;
      if (!windGridRef.current || gridBoundsRef.current !== boundsKey) {
        windGridRef.current = buildWindGrid(
          { w: bw, e: be, s: bs, n: bn },
          windData,
        );
        gridBoundsRef.current = boundsKey;
      }
      const grid = windGridRef.current;

      // ── PERF: Cache projection math ONCE per frame ──
      // map.project() with 3D terrain is O(expensive) per call (ray-mesh intersection).
      // Instead: project 4 corners once → linear interpolation per particle = O(1).
      const zoomFactor = Math.pow(2, SPEED_SCALE_REF_ZOOM - map.getZoom());
      const speedScale = SPEED_SCALE_BASE * zoomFactor;

      // Pitch-aware projection strategy:
      // - Low pitch (<15°): fast linear interpolation from 4 corner projections (O(1) per particle)
      // - High pitch: fall back to map.project() (expensive but correct perspective)
      const pitch = map.getPitch();
      const useFastProj = pitch < 15;

      let projX: (lon: number) => number;
      let projY: (lat: number) => number;

      if (useFastProj) {
        const nw = map.project([cachedBounds.w, cachedBounds.n]);
        const se = map.project([cachedBounds.e, cachedBounds.s]);
        const lonRange = cachedBounds.e - cachedBounds.w;
        const latRange = cachedBounds.n - cachedBounds.s;
        projX = (lon: number) => ((lon - cachedBounds.w) / lonRange) * (se.x - nw.x) + nw.x;
        projY = (lat: number) => ((cachedBounds.n - lat) / latRange) * (se.y - nw.y) + nw.y;
      } else {
        // High pitch: use map.project() but with reduced particle count for perf
        projX = () => 0; // placeholder — we use projectPt below
        projY = () => 0;
      }

      // Update particles and draw directly (no intermediate array)
      const particles = particlesRef.current;
      trailCtx.lineCap = 'round';

      // Group by color for fewer ctx state changes
      const colorBuckets = new Map<string, { px: number; py: number; cx: number; cy: number; alpha: number; lw: number }[]>();

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const wind = lookupWindGrid(grid, p.lat, p.lon);

        const prevLon = p.lon;
        const prevLat = p.lat;
        p.lon += wind.vx * speedScale;
        p.lat += wind.vy * speedScale;
        p.age++;

        if (
          p.age > p.maxAge ||
          p.lon < bw || p.lon > be ||
          p.lat < bs || p.lat > bn
        ) {
          particles[i] = spawnParticle(cachedBounds);
          continue;
        }

        // ── PERF: Projection (fast linear or map.project for pitched view) ──
        let px: number, py: number, cx: number, cy: number;
        if (useFastProj) {
          px = projX(prevLon) * dpr;
          py = projY(prevLat) * dpr;
          cx = projX(p.lon) * dpr;
          cy = projY(p.lat) * dpr;
        } else {
          const prev = map.project([prevLon, prevLat]);
          const curr = map.project([p.lon, p.lat]);
          px = prev.x * dpr; py = prev.y * dpr;
          cx = curr.x * dpr; cy = curr.y * dpr;
        }

        // Skip off-viewport
        if (cx < -50 || cx > w + 50 || cy < -50 || cy > h + 50) {
          particles[i] = spawnParticle(cachedBounds);
          continue;
        }

        const ageFade = 1 - p.age / p.maxAge;
        const speedFactor = Math.min(wind.speed / 8, 1);
        const color = windSpeedColor(wind.speed);
        const seg = {
          px, py, cx, cy,
          alpha: Math.max(ageFade * 0.95, 0.25),
          lw: (LINE_WIDTH_BASE + speedFactor * (LINE_WIDTH_MAX - LINE_WIDTH_BASE)) * dpr,
        };

        let bucket = colorBuckets.get(color);
        if (!bucket) { bucket = []; colorBuckets.set(color, bucket); }
        bucket.push(seg);
      }

      // ── PERF: Draw batched by color (1 beginPath/stroke per color, not per particle) ──
      // Strong wind colors get a pulsing glow (shadowBlur)
      const gustGlowColors = new Set(['#f97316', '#ef4444']); // orange-500, red-500 (>=15kt)
      const glowPulse = Math.sin(Date.now() / 400) * 3 + 5; // oscillates 2-8px

      for (const [color, segs] of colorBuckets) {
        const isGust = gustGlowColors.has(color);
        trailCtx.strokeStyle = color;
        if (isGust) {
          trailCtx.shadowColor = color;
          trailCtx.shadowBlur = glowPulse * dpr;
        } else {
          trailCtx.shadowColor = 'transparent';
          trailCtx.shadowBlur = 0;
        }
        trailCtx.beginPath();
        for (const seg of segs) {
          trailCtx.lineWidth = seg.lw;
          trailCtx.globalAlpha = seg.alpha;
          trailCtx.moveTo(seg.px, seg.py);
          trailCtx.lineTo(seg.cx, seg.cy);
        }
        trailCtx.stroke();
      }
      // Reset shadow
      trailCtx.shadowBlur = 0;

      // Composite trail canvas onto main canvas
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = opacity;
      ctx.drawImage(trailCanvas, 0, 0);
      ctx.globalAlpha = 1;

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    // Pause animation during pan/zoom for smoother map interaction
    const handleMoveStart = () => { mapMovingRef.current = true; };

    // Re-spawn particles on map move (zoom/pan) to avoid stale positions.
    // S123 perf: removed forced `windGridRef.current = null` — the boundsKey
    // check in animate() already rebuilds when bounds change. Forcing null on
    // every moveend caused redundant 576-cell IDW rebuilds during smooth zoom
    // (each wheel tick fires moveend) even when bounds were nearly identical.
    const handleMoveEnd = () => {
      mapMovingRef.current = false;
      const particles = particlesRef.current;
      for (let i = 0; i < particles.length; i++) {
        if (Math.random() > 0.7) {
          particles[i] = spawnParticle();
        }
      }
    };
    map.on('movestart', handleMoveStart);
    map.on('moveend', handleMoveEnd);

    const resizeObs = new ResizeObserver(resize);
    resizeObs.observe(canvas);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      map.off('movestart', handleMoveStart);
      map.off('moveend', handleMoveEnd);
      resizeObs.disconnect();
    };
  }, [isActive, opacity, mapRef, isMobile, spawnParticle]);

  if (!isActive) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 15 }}
    />
  );
});
