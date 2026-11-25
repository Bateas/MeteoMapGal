import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../../services/idleAnimations';

/** Asymmetric like real fog: it forms quickly once detected and lifts slowly. */
const FADE_IN_MS = 2000;
const FADE_OUT_MS = 5000;
/** 20 fps: each step re-renders the overlay and makes MapLibre re-process its source. */
const STEP_MS = 50;

/**
 * Opacity that ramps to 1 when `show` turns on and back to 0 when it turns off. It runs from script, out of reach of
 * the reduced-motion rule of index.css, so it asks: with reduced motion it jumps straight to the end.
 */
export function useFade(show: boolean): number {
  const [opacity, setOpacity] = useState(0);
  const current = useRef(0);

  useEffect(() => {
    const paint = (value: number) => {
      current.current = value;
      setOpacity(value);
    };
    const target = show ? 1 : 0;
    const start = current.current;
    const delta = target - start;
    if (Math.abs(delta) < 0.01) return;
    if (prefersReducedMotion()) { paint(target); return; }

    const startedAt = Date.now();
    const duration = delta > 0 ? FADE_IN_MS : FADE_OUT_MS;
    let frame: number;
    let lastStep = 0;
    const tick = () => {
      if (document.hidden) { frame = requestAnimationFrame(tick); return; }
      const now = Date.now();
      if (now - lastStep >= STEP_MS) {
        lastStep = now;
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
        paint(start + delta * eased);
        if (progress >= 1) return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [show]);

  return opacity;
}
