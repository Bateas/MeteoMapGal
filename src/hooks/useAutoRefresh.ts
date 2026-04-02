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

  const executeRefresh = useCallback(async () => {
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
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        start(); // start() already calls executeRefresh()
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
