import { useEffect, useRef, useCallback, useState } from 'react';

interface AutoRefreshState {
  lastRefresh: Date | null;
  isPolling: boolean;
  forceRefresh: () => void;
}

export function useAutoRefresh(
  callback: () => Promise<void>,
  intervalMs: number
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
      setIsPolling(true);
      executeRefresh(); // Immediate first fetch
      timerRef.current = window.setInterval(executeRefresh, intervalMs);
    };

    const stop = () => {
      setIsPolling(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        executeRefresh(); // Fetch immediately when tab becomes visible
        start();
      } else {
        stop();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    start();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs, executeRefresh]);

  return { lastRefresh, isPolling, forceRefresh };
}
