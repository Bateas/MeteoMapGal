import { useRef, useEffect, useCallback, memo } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { useUIStore } from '../../store/uiStore';
import { extractWindData, interpolateWind } from '../../services/idwInterpolation';
import { windSpeedColor } from '../../services/windUtils';

// ── Configuration ──────────────────────────────────────────

const PARTICLE_COUNT_DESKTOP = 400;
const PARTICLE_COUNT_MOBILE = 150;
const FADE_ALPHA = 0.94;
const PARTICLE_MAX_AGE = 100;
const SPEED_SCALE = 0.002;
const LINE_WIDTH_BASE = 1.8;
const LINE_WIDTH_MAX = 3.5;
const HEAD_RADIUS = 2.5;

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
  const isMobile = useUIStore((s) => s.isMobile);

  const isActive = activeLayer === 'wind-particles';
  const particleCount = isMobile ? PARTICLE_COUNT_MOBILE : PARTICLE_COUNT_DESKTOP;

  // Build wind data for IDW
  const windDataRef = useRef(extractWindData(stations, readings));
  useEffect(() => {
    windDataRef.current = extractWindData(stations, readings);
  }, [stations, readings]);

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

      // ── PERF: Cache bounds ONCE per frame (was called 500x/frame!) ──
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

      // Update and draw particles on trail canvas
      const particles = particlesRef.current;

      // ── PERF: Batch path operations ──
      trailCtx.lineCap = 'round';

      // Detect 3D pitch — particles projected behind camera need respawn
      const hasPitch = map.getPitch() > 5;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Get wind at particle position
        const wind = interpolateWind(p.lat, p.lon, windData);

        // Move particle
        const prevLon = p.lon;
        const prevLat = p.lat;
        p.lon += wind.vx * SPEED_SCALE;
        p.lat += wind.vy * SPEED_SCALE;
        p.age++;

        // Respawn check BEFORE projecting (saves 2 project() calls for dead particles)
        if (
          p.age > p.maxAge ||
          p.lon < bw || p.lon > be ||
          p.lat < bs || p.lat > bn
        ) {
          particles[i] = spawnParticle(cachedBounds);
          continue; // skip drawing this frame
        }

        // Project to screen
        const prev = map.project([prevLon, prevLat]);
        const curr = map.project([p.lon, p.lat]);

        // ── 3D pitch safety: respawn if projected behind camera or off-viewport ──
        if (hasPitch) {
          const margin = 50; // px tolerance
          if (
            curr.x < -margin || curr.x > w / dpr + margin ||
            curr.y < -margin || curr.y > h / dpr + margin ||
            prev.x < -margin || prev.x > w / dpr + margin ||
            prev.y < -margin || prev.y > h / dpr + margin
          ) {
            particles[i] = spawnParticle(cachedBounds);
            continue;
          }
        }

        // Draw trail line — width scales with wind speed for visual distinction
        const color = windSpeedColor(wind.speed);
        const ageFade = 1 - p.age / p.maxAge;
        const px = prev.x * dpr;
        const py = prev.y * dpr;
        const cx = curr.x * dpr;
        const cy = curr.y * dpr;

        // Speed-proportional line width: calm=thin, strong=thick
        const speedFactor = Math.min(wind.speed / 8, 1); // 0-1 over 0-8 m/s (~16kt)
        const lineWidth = (LINE_WIDTH_BASE + speedFactor * (LINE_WIDTH_MAX - LINE_WIDTH_BASE)) * dpr;

        trailCtx.beginPath();
        trailCtx.moveTo(px, py);
        trailCtx.lineTo(cx, cy);
        trailCtx.lineWidth = lineWidth;
        trailCtx.strokeStyle = color;
        trailCtx.globalAlpha = Math.max(ageFade * 0.95, 0.25);
        trailCtx.stroke();

        // Bright head dot for visibility (skip on mobile to reduce draw calls)
        if (!isMobile && ageFade > 0.25) {
          trailCtx.beginPath();
          trailCtx.arc(cx, cy, HEAD_RADIUS * dpr, 0, Math.PI * 2);
          trailCtx.fillStyle = color;
          trailCtx.globalAlpha = Math.min(ageFade + 0.1, 1);
          trailCtx.fill();
        }
      }

      // Composite trail canvas onto main canvas
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = opacity;
      ctx.drawImage(trailCanvas, 0, 0);
      ctx.globalAlpha = 1;

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    // Re-spawn particles on map move (zoom/pan) to avoid stale positions
    const handleMoveEnd = () => {
      const particles = particlesRef.current;
      for (let i = 0; i < particles.length; i++) {
        if (Math.random() > 0.7) {
          particles[i] = spawnParticle();
        }
      }
    };
    map.on('moveend', handleMoveEnd);

    const resizeObs = new ResizeObserver(resize);
    resizeObs.observe(canvas);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
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
