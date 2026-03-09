/**
 * useVisibilityPolling — visibility-aware interval polling.
 *
 * Pauses when the browser tab is hidden, resumes when visible.
 * Uses a callback ref so the interval never needs re-creation
 * when the callback identity changes.
 *
 * This saves significant CPU in background tabs: lightning (2min),
 * forecast (30min), atmospheric (15min), airspace (30min) all stop
 * processing when the user isn't looking.
 */

import { useEffect, useRef } from 'react';

export function useVisibilityPolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  /** When false, polling is completely paused. Defaults to true. */
  enabled: boolean = true,
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;        // ← do nothing when disabled

    let timer: ReturnType<typeof setInterval> | null = null;

    function start() {
      callbackRef.current();
      if (timer) clearInterval(timer);
      timer = setInterval(() => callbackRef.current(), intervalMs);
    }

    function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        start();
      } else {
        stop();
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);

    // Start immediately if tab is visible
    if (document.visibilityState === 'visible') {
      start();
    }

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs, enabled]);
}
