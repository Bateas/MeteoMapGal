import { useRef, useEffect, useCallback, memo } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { useWeatherStore } from '../../store/weatherStore';
import { useWeatherLayerStore } from '../../store/weatherLayerStore';
import { extractWindData, interpolateWind } from '../../services/idwInterpolation';
import { windSpeedColor } from '../../services/windUtils';

// ── Configuration ──────────────────────────────────────────

const PARTICLE_COUNT = 500;
const FADE_ALPHA = 0.92; // trail fade per frame (higher = longer trails)
const PARTICLE_MAX_AGE = 100; // frames before respawn
const SPEED_SCALE = 0.004; // wind m/s → degree displacement per frame
const LINE_WIDTH = 1.6;
const HEAD_RADIUS = 2; // bright dot at particle head

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

  const isActive = activeLayer === 'wind-particles';

  // Build wind data for IDW
  const windDataRef = useRef(extractWindData(stations, readings));
  useEffect(() => {
    windDataRef.current = extractWindData(stations, readings);
  }, [stations, readings]);

  // Spawn a particle at random position within map bounds
  const spawnParticle = useCallback((): Particle => {
    const map = mapRef.current?.getMap();
    if (!map) {
      return { lon: -8.1, lat: 42.29, age: 0, maxAge: PARTICLE_MAX_AGE };
    }
    const bounds = map.getBounds();
    const lon = bounds.getWest() + Math.random() * (bounds.getEast() - bounds.getWest());
    const lat = bounds.getSouth() + Math.random() * (bounds.getNorth() - bounds.getSouth());
    const maxAge = PARTICLE_MAX_AGE * (0.6 + Math.random() * 0.8);
    return { lon, lat, age: 0, maxAge };
  }, [mapRef]);

  // Initialize particles
  useEffect(() => {
    if (!isActive) return;
    particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => spawnParticle());
  }, [isActive, spawnParticle]);

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

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      trailCanvas.width = canvas.width;
      trailCanvas.height = canvas.height;
    };
    resize();

    const ctx = canvas.getContext('2d');
    const trailCtx = trailCanvas.getContext('2d');
    if (!ctx || !trailCtx) return;

    const animate = () => {
      const dpr = window.devicePixelRatio || 1;
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

      // Update and draw particles on trail canvas
      const particles = particlesRef.current;
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

        // Project to screen
        const prev = map.project([prevLon, prevLat]);
        const curr = map.project([p.lon, p.lat]);

        // Draw trail line
        const color = windSpeedColor(wind.speed);
        const ageFade = 1 - p.age / p.maxAge;
        const px = prev.x * dpr;
        const py = prev.y * dpr;
        const cx = curr.x * dpr;
        const cy = curr.y * dpr;

        trailCtx.beginPath();
        trailCtx.moveTo(px, py);
        trailCtx.lineTo(cx, cy);
        trailCtx.strokeStyle = color;
        trailCtx.globalAlpha = Math.max(ageFade * 0.9, 0.15);
        trailCtx.lineWidth = LINE_WIDTH * dpr;
        trailCtx.lineCap = 'round';
        trailCtx.stroke();

        // Bright head dot for visibility
        if (ageFade > 0.3) {
          trailCtx.beginPath();
          trailCtx.arc(cx, cy, HEAD_RADIUS * dpr, 0, Math.PI * 2);
          trailCtx.fillStyle = color;
          trailCtx.globalAlpha = ageFade;
          trailCtx.fill();
        }

        // Respawn if too old or out of bounds
        const bounds = map.getBounds();
        if (
          p.age > p.maxAge ||
          p.lon < bounds.getWest() - 0.1 ||
          p.lon > bounds.getEast() + 0.1 ||
          p.lat < bounds.getSouth() - 0.1 ||
          p.lat > bounds.getNorth() + 0.1
        ) {
          particles[i] = spawnParticle();
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
  }, [isActive, opacity, mapRef, spawnParticle]);

  if (!isActive) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 15 }}
    />
  );
});
