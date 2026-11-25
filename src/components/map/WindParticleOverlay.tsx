import { useRef, useEffect, useCallback, useState, memo } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { useUIStore } from '../../store/uiStore';
import { useBuoyStore } from '../../store/buoyStore';
import { extractWindData, extractBuoyWindData, buildWindGrid, lookupWindGrid, BUOY_FIELD_WEIGHT } from '../../services/idwInterpolation';
import type { WindGrid, StationExposureMap, StationWindData } from '../../services/idwInterpolation';
import { freeStreamDirection } from '../../services/spotScoringEngine';
import { fetchStationExposure } from '../../api/stationExposureClient';
import { windSpeedColor } from '../../services/windUtils';
import { pageIsIdle } from '../../services/idleAnimations';
import { mapIsDark } from '../../hooks/useMapInk';

// ── Configuration ──────────────────────────────────────────

const PARTICLE_COUNT_DESKTOP = 250; // was 400 — fewer particles, less project() calls
const PARTICLE_COUNT_MOBILE = 100; // was 150
const FADE_ALPHA = 0.86;
const PARTICLE_MAX_AGE = 100;
// Base speed calibrated for zoom ~10 (Galician scale ~50km viewport).
// Scaled down at higher zooms to prevent particles from racing across screen.
const SPEED_SCALE_BASE = 0.0006;
const SPEED_SCALE_REF_ZOOM = 10;
const LINE_WIDTH = 1.8;
/**
 * Every particle moves at the speed of 8 kt and leaves the same short trail: they show where the wind goes, the
 * colour says how much (18-nov, chosen by eye against a speed that grew with the wind). Before, a station with 25 kt
 * among calm ones threw long, thick, glowing streaks four times faster than the rest: a comet, not a field.
 */
const SCREEN_SPEED_MS = 4.1;
/** Under this the air is still: the particle stays where it is. */
const STILL_MS = 0.3;

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

  // Build wind data when stations/readings/buoys change — merges weather stations + marine buoys.
  // hasWind restarts the animation loop: saved on, the layer mounts before the readings arrive, the
  // first frame found nothing to draw and the loop ended for good until the user toggled it.
  const windDataRef = useRef<StationWindData[]>([]);
  const [hasWind, setHasWind] = useState(false);
  const windGridRef = useRef<WindGrid | null>(null);
  const gridBoundsRef = useRef<string>('');
  const mapMovingRef = useRef(false);

  // Measured exposure of each land station: sheltered gardens stop painting calm and crossed
  // arrows next to an exposed station. Only while the layer is on; one request an hour.
  const [exposure, setExposure] = useState<StationExposureMap | undefined>(undefined);
  useEffect(() => {
    if (!isActive) return;
    let alive = true;
    fetchStationExposure().then((m) => { if (alive && m.size > 0) setExposure(m); });
    return () => { alive = false; };
  }, [isActive]);

  useEffect(() => {
    // Direction of the free stream (the buoys, when they agree): the sector each station's
    // exposure is read in. Without it, each station's own reading.
    const freeDir = freeStreamDirection(buoys.map((buoy) => ({ buoy, distKm: 0 })));
    const stationWind = extractWindData(stations, readings, exposure, freeDir);
    const buoyWind = extractBuoyWindData(buoys, BUOY_FIELD_WEIGHT);
    windDataRef.current = [...stationWind, ...buoyWind];
    // Invalidate grid — will be rebuilt on next frame with current viewport
    windGridRef.current = null;
    setHasWind(windDataRef.current.length > 0);
  }, [stations, readings, buoys, exposure]);

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
    if (!isActive || !hasWind) {
      cancelAnimationFrame(animFrameRef.current);
      // A sector switch empties the readings: the other sector's trails must not stay frozen on screen.
      const c = canvasRef.current;
      if (c) c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
      const t = trailCanvasRef.current;
      if (t) t.getContext('2d')?.clearRect(0, 0, t.width, t.height);
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

    // Throttle particle animation to ~30fps (33ms gate). 250 particles × ~10
    // ops/particle/frame at 60fps was the dominant CPU cost when wind layer
    // was active. Visual perception of fluid
    // motion is preserved above ~24fps; 30fps cuts the cost ~50% with no
    // perceptible quality loss.
    const FRAME_GATE_MS = 33;
    let lastAnimateAt = 0;

    const animate = () => {
      // Tab hidden, or nobody touching it for 10 min → skip the particle work entirely.
      // The browser already throttles rAF to ~1fps when backgrounded, but this also avoids
      // the heavy per-frame draw. Cheap reschedule keeps the loop alive for return.
      if (document.hidden || pageIsIdle()) {
        animFrameRef.current = requestAnimationFrame(animate);
        return;
      }
      const nowMs = Date.now();
      // Skip animation during map pan/zoom — frees frame budget for smooth dragging
      if (mapMovingRef.current) {
        animFrameRef.current = requestAnimationFrame(animate);
        return;
      }
      // Frame-rate gate: only do the heavy work every ~33ms
      if (nowMs - lastAnimateAt < FRAME_GATE_MS) {
        animFrameRef.current = requestAnimationFrame(animate);
        return;
      }
      lastAnimateAt = nowMs;

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
      // No data, no frames. hasWind brings the loop back when the wind arrives.
      if (windData.length === 0) return;

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

      // The map is always flat (maxPitch 0): linear interpolation from two corners, O(1) per particle.
      const nw = map.project([cachedBounds.w, cachedBounds.n]);
      const se = map.project([cachedBounds.e, cachedBounds.s]);
      const lonRange = cachedBounds.e - cachedBounds.w;
      const latRange = cachedBounds.n - cachedBounds.s;
      const projX = (lon: number) => ((lon - cachedBounds.w) / lonRange) * (se.x - nw.x) + nw.x;
      const projY = (lat: number) => ((cachedBounds.n - lat) / latRange) * (se.y - nw.y) + nw.y;

      // Update particles and draw directly (no intermediate array)
      const particles = particlesRef.current;
      trailCtx.lineCap = 'round';

      // Group by color for fewer ctx state changes
      const onDarkMap = mapIsDark();
      const colorBuckets = new Map<string, { px: number; py: number; cx: number; cy: number; alpha: number; lw: number }[]>();

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const wind = lookupWindGrid(grid, p.lat, p.lon);

        const prevLon = p.lon;
        const prevLat = p.lat;
        const k = wind.speed > STILL_MS ? SCREEN_SPEED_MS / wind.speed : 0;
        p.lon += wind.vx * k * speedScale;
        p.lat += wind.vy * k * speedScale;
        p.age++;

        if (
          p.age > p.maxAge ||
          p.lon < bw || p.lon > be ||
          p.lat < bs || p.lat > bn
        ) {
          particles[i] = spawnParticle(cachedBounds);
          continue;
        }

        const px = projX(prevLon) * dpr;
        const py = projY(prevLat) * dpr;
        const cx = projX(p.lon) * dpr;
        const cy = projY(p.lat) * dpr;

        // Skip off-viewport
        if (cx < -50 || cx > w + 50 || cy < -50 || cy > h + 50) {
          particles[i] = spawnParticle(cachedBounds);
          continue;
        }

        const ageFade = 1 - p.age / p.maxAge;
        const color = windSpeedColor(wind.speed, onDarkMap);
        const seg = {
          px, py, cx, cy,
          alpha: Math.max(ageFade * 0.95, 0.25),
          lw: LINE_WIDTH * dpr,
        };

        let bucket = colorBuckets.get(color);
        if (!bucket) { bucket = []; colorBuckets.set(color, bucket); }
        bucket.push(seg);
      }

      // ── PERF: Draw batched by color (1 beginPath/stroke per color, not per particle) ──
      for (const [color, segs] of colorBuckets) {
        trailCtx.strokeStyle = color;
        trailCtx.beginPath();
        for (const seg of segs) {
          trailCtx.lineWidth = seg.lw;
          trailCtx.globalAlpha = seg.alpha;
          trailCtx.moveTo(seg.px, seg.py);
          trailCtx.lineTo(seg.cx, seg.cy);
        }
        trailCtx.stroke();
      }

      // Composite trail canvas onto main canvas
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = opacity;
      ctx.drawImage(trailCanvas, 0, 0);
      ctx.globalAlpha = 1;

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    // Pause animation during pan/zoom for smoother map interaction
    const handleMoveStart = () => {
      mapMovingRef.current = true;
      // Clear frozen trails during pan so stale streaks don't stay fixed on screen
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
    };

    // Re-spawn particles on map move (zoom/pan) to avoid stale positions.
    // perf: removed forced `windGridRef.current = null` — the boundsKey
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
  }, [isActive, hasWind, opacity, mapRef, isMobile, spawnParticle]);

  if (!isActive) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 15 }}
    />
  );
});
