/**
 * The loading screen once React is running. It is the same picture as #loading-skeleton in index.html, in
 * the same place and with the same classes (they live there, so they exist before any CSS file arrives):
 * the page swaps one for the other without a jump, and what was «Cargando» starts saying what is going on.
 *
 * It leaves with a fade as soon as there are readings to show, or something failed, or after MAX_WAIT_MS at
 * most: the map is worth more than a screen that waits. It can never stay on: if the data has not come by
 * then, the map says so itself (spots «Calculando», the header's «Actualizando», AppShell's notice on error).
 */
import { useEffect, useRef, useState } from 'react';
import { useWeatherStore } from '../../store/weatherStore';

/** Longest this stays on screen after React has started. */
export const MAX_WAIT_MS = 3000;
/** If the end of the fade is never reported (a hidden tab), it still goes. */
const FADE_FALLBACK_MS = 400;

/** What the bar shows: only what has really happened. The fill of the page before this is carried on. */
export function loadProgress(start: number, stations: number, readings: number): number {
  if (readings > 0) return 1;
  if (stations > 0) return Math.max(start, 0.65);
  return Math.max(start, 0.35);
}

/** How far the fill of #loading-skeleton had gone, so the bar does not go back when this one replaces it. */
function skeletonFill(): number {
  try {
    const bar = document.querySelector('#loading-skeleton .gc-boot-bar i');
    return bar ? new DOMMatrixReadOnly(getComputedStyle(bar).transform).a : 0;
  } catch {
    return 0;
  }
}

interface LoadingScreenProps {
  error: string | null;
  /** The fade has ended: it can be unmounted. */
  onDone: () => void;
}

export function LoadingScreen({ error, onDone }: LoadingScreenProps) {
  const stations = useWeatherStore((s) => s.stations.length);
  const readings = useWeatherStore((s) => s.currentReadings.size);
  const [start] = useState(skeletonFill);
  const [timedOut, setTimedOut] = useState(false);
  // One frame at the fill it inherited, so the bar goes on from there instead of jumping
  const [painted, setPainted] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), MAX_WAIT_MS);
    const frame = requestAnimationFrame(() => setPainted(true));
    return () => { clearTimeout(t); cancelAnimationFrame(frame); };
  }, []);

  const leaving = readings > 0 || !!error || timedOut;
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => doneRef.current(), FADE_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  return (
    <div
      className="gc-boot gc-boot--app"
      role="status"
      data-leaving={leaving ? '' : undefined}
      onTransitionEnd={(e) => { if (e.target === e.currentTarget && e.propertyName === 'opacity') doneRef.current(); }}
    >
      {/* Same drawing as index.html and the icons; its colours are in the CSS of index.html */}
      <svg className="gc-boot-mark" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden="true">
        <path d="M18 16 Q30 12, 40 16 Q45 18, 43 13 Q41 9, 36 12" strokeWidth="3.5" />
        <path d="M14 28 Q30 22, 46 28 Q53 31, 50 24 Q47 18, 42 22" strokeWidth="4" />
        <path d="M10 40 Q28 33, 50 40 Q56 42, 54 36 Q51 30, 46 34" strokeWidth="4.5" />
        <path d="M8 52 Q16 46, 24 52 Q32 58, 40 52 Q48 46, 56 52" strokeWidth="3" />
      </svg>
      <p className="gc-boot-name">MeteoMapGal</p>
      <p className="gc-boot-state">{stations > 0 ? `Leyendo ${stations} estaciones…` : 'Cargando…'}</p>
      <div className="gc-boot-bar" aria-hidden="true">
        <i style={{ transform: `scaleX(${painted ? loadProgress(start, stations, readings) : start})` }} />
      </div>
    </div>
  );
}
