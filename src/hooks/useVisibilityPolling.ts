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
  /** Delay first execution to stagger startup API calls (ms). Default 0 = immediate. */
  initialDelayMs = 0,
) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    let delayTimer: ReturnType<typeof setTimeout> | null = null;

    function start() {
      callbackRef.current();
      if (timer) clearInterval(timer);
      timer = setInterval(() => callbackRef.current(), intervalMs);
    }

    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
      if (delayTimer) { clearTimeout(delayTimer); delayTimer = null; }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        start();
      } else {
        stop();
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);

    // Start immediately or after delay (staggers startup API calls)
    if (document.visibilityState === 'visible') {
      if (initialDelayMs > 0) {
        delayTimer = setTimeout(start, initialDelayMs);
      } else {
        start();
      }
    }

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs, enabled, initialDelayMs]);
}
