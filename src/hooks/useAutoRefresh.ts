import { useEffect, useRef, useCallback, useState } from 'react';

interface AutoRefreshState {
  lastRefresh: Date | null;
  isPolling: boolean;
  forceRefresh: () => void;
}

export function useAutoRefresh(
  callback: () => Promise<void>,
  intervalMs: number,
  /** Delay first execution to stagger startup API calls (ms). Default 0 = immediate. */
  initialDelayMs = 0,
): AutoRefreshState {
  const timerRef = useRef<number>(undefined);
  const callbackRef = useRef(callback);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [isPolling, setIsPolling] = useState(true);

  callbackRef.current = callback;
  /** When the last refresh started. Coming back to the tab waits out what is left of the interval
   *  instead of asking again (same rule as useVisibilityPolling; 15-oct audit). */
  const lastRunRef = useRef(0);
  const resumeTimerRef = useRef<number>(undefined);

  const executeRefresh = useCallback(async () => {
    lastRunRef.current = Date.now();
    try {
      await callbackRef.current();
      setLastRefresh(new Date());
    } catch (err) {
      console.error('[AutoRefresh] Error:', err);
    }
  }, []);

  const forceRefresh = useCallback(() => {
    executeRefresh();
  }, [executeRefresh]);

  useEffect(() => {
    const start = () => {
      if (timerRef.current) clearInterval(timerRef.current);
      setIsPolling(true);
      executeRefresh();
      timerRef.current = window.setInterval(executeRefresh, intervalMs);
    };

    const stop = () => {
      setIsPolling(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = undefined;
      }
      if (resumeTimerRef.current) {
        clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = undefined;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const age = Date.now() - lastRunRef.current;
        if (lastRunRef.current === 0 || age >= intervalMs) {
          start(); // start() already calls executeRefresh()
        } else {
          setIsPolling(true);
          if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
          resumeTimerRef.current = window.setTimeout(() => { resumeTimerRef.current = undefined; start(); }, intervalMs - age);
        }
      } else {
        stop();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    // Stagger startup: delay first execution to avoid thundering herd
    if (initialDelayMs > 0) {
      const delayTimer = window.setTimeout(start, initialDelayMs);
      return () => { stop(); clearTimeout(delayTimer); document.removeEventListener('visibilitychange', onVisibilityChange); };
    }

    start();
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibilityChange); };
  }, [intervalMs, initialDelayMs, executeRefresh]);

  return { lastRefresh, isPolling, forceRefresh };
}
