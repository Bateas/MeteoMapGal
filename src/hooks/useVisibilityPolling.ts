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
 *
 * Coming back to the tab does NOT refetch. It used to: returning to the tab
 * ran the callback again whatever the clock said, so someone switching
 * windows twenty times in a minute asked for everything twenty times, across
 * the twenty loops that use this hook. Now the age of the last answer decides:
 * older than the interval, ask again; younger, wait out what is left of it.
 * Mounting and changing sector still ask straight away — there the data on
 * screen is not the data being asked for.
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
  /** When the callback last ran. Survives the tab going away and coming back. */
  const lastRunRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    let delayTimer: ReturnType<typeof setTimeout> | null = null;

    function run() {
      lastRunRef.current = Date.now();
      callbackRef.current();
    }

    function startInterval() {
      if (timer) clearInterval(timer);
      timer = setInterval(run, intervalMs);
    }

    /** @param force ask now whatever the age — a mount or a sector change. */
    function start(force: boolean) {
      if (delayTimer) { clearTimeout(delayTimer); delayTimer = null; }
      const age = Date.now() - lastRunRef.current;
      if (force || age >= intervalMs) {
        run();
        startInterval();
        return;
      }
      // The answer on screen is still within its interval: keep it and pick
      // the rhythm back up when it actually expires.
      delayTimer = setTimeout(() => {
        delayTimer = null;
        run();
        startInterval();
      }, intervalMs - age);
    }

    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
      if (delayTimer) { clearTimeout(delayTimer); delayTimer = null; }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        start(false);
      } else {
        stop();
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);

    // Start immediately or after delay (staggers startup API calls)
    if (document.visibilityState === 'visible') {
      if (initialDelayMs > 0) {
        delayTimer = setTimeout(() => start(true), initialDelayMs);
      } else {
        start(true);
      }
    }

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs, enabled, initialDelayMs]);
}
