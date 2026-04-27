/**
 * LightningRippleOverlay — concentric ripple animation on every NEW lightning
 * strike (last 30s). Visual narrative: "AHORA mismo cae aquí".
 *
 * Reactive philosophy: the existing StormClusterOverlay shows the static
 * dots/clusters. This adds the *temporal* layer — you can't help noticing
 * a fresh strike pulsing on the map. Auto-fades after 3s, no toggle.
 *
 * Implementation notes:
 * - Uses react-map-gl <Marker> with absolutely-positioned SVG.
 *   pointer-events: none so it never blocks interactions.
 * - Each ripple is rendered for 3s only; we keep the active list in state
 *   and prune expired ones every animation frame using a single timer.
 * - Deduplicates by strike.id so a re-render doesn't double-fire.
 */

import { memo, useEffect, useState, useRef } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import { useLightningStore } from '../../hooks/useLightningData';

interface ActiveRipple {
  id: number;
  lat: number;
  lon: number;
  spawnTime: number;
  /** Strike strength category drives ring size */
  big: boolean;
}

const RIPPLE_DURATION_MS = 3_000;
const FRESH_WINDOW_MS = 30_000; // only animate strikes <30s old

function LightningRippleInner() {
  const strikes = useLightningStore((s) => s.strikes);
  const [active, setActive] = useState<ActiveRipple[]>([]);
  const seenIdsRef = useRef<Set<number>>(new Set());

  // Detect new strikes and spawn ripples
  useEffect(() => {
    if (strikes.length === 0) return;
    const now = Date.now();
    const newRipples: ActiveRipple[] = [];

    for (const s of strikes) {
      if (seenIdsRef.current.has(s.id)) continue;
      // Only ripple recent strikes — the API might paginate older ones, we
      // don't want to retroactively pulse 30-min-old strikes when they first
      // load.
      if (now - s.timestamp > FRESH_WINDOW_MS) {
        seenIdsRef.current.add(s.id); // mark as seen but don't ripple
        continue;
      }
      seenIdsRef.current.add(s.id);
      newRipples.push({
        id: s.id,
        lat: s.lat,
        lon: s.lon,
        spawnTime: now,
        big: Math.abs(s.peakCurrent) >= 30 || !s.cloudToCloud, // CG strikes + big-current C2C
      });
    }

    if (newRipples.length === 0) return;
    setActive((prev) => [...prev, ...newRipples]);

    // Garbage-collect the seen set — keep last ~1000 entries
    if (seenIdsRef.current.size > 1500) {
      const arr = Array.from(seenIdsRef.current);
      seenIdsRef.current = new Set(arr.slice(arr.length - 1000));
    }
  }, [strikes]);

  // Prune expired ripples every 250ms
  useEffect(() => {
    if (active.length === 0) return;
    const t = setInterval(() => {
      const now = Date.now();
      setActive((prev) => prev.filter((r) => now - r.spawnTime < RIPPLE_DURATION_MS));
    }, 250);
    return () => clearInterval(t);
  }, [active.length]);

  if (active.length === 0) return null;

  return (
    <>
      {active.map((r) => (
        <Marker
          key={r.id}
          latitude={r.lat}
          longitude={r.lon}
          anchor="center"
          style={{ pointerEvents: 'none', zIndex: 8 }}
        >
          <Ripple big={r.big} />
        </Marker>
      ))}
    </>
  );
}

function Ripple({ big }: { big: boolean }) {
  // Two concentric rings, animated via inline keyframe-like state for SSR-safe
  // (no global CSS injection needed). Pure SVG.
  const size = big ? 110 : 70;
  const half = size / 2;
  const accent = big ? '#fbbf24' : '#fcd34d'; // yellow for CG/strong, light for C2C

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{
        overflow: 'visible',
        animation: 'lightning-ripple-fade 3s ease-out forwards',
      }}
      aria-hidden="true"
    >
      {/* Outer ring expands fastest */}
      <circle
        cx={half} cy={half} r="2"
        fill="none"
        stroke={accent}
        strokeWidth="2"
        opacity="0.85"
        style={{ animation: 'lightning-ripple-outer 3s ease-out forwards' }}
      />
      {/* Inner ring expands slower */}
      <circle
        cx={half} cy={half} r="2"
        fill="none"
        stroke={accent}
        strokeWidth="3"
        opacity="0.95"
        style={{ animation: 'lightning-ripple-inner 3s ease-out forwards' }}
      />
      {/* Bright core dot */}
      <circle
        cx={half} cy={half} r="3"
        fill={accent}
        opacity="1"
        style={{ animation: 'lightning-ripple-core 3s ease-out forwards' }}
      />
    </svg>
  );
}

export const LightningRippleOverlay = memo(LightningRippleInner);
