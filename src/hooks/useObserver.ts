/**
 * The observer with a personal link on this device (name + their recent reports), or null.
 * One request per page load, shared by every popup (see fetchObserver); `refresh` asks again
 * after the code changes or a report is sent.
 */
import { useCallback, useEffect, useState } from 'react';
import { fetchObserver, takeObserverGreeting } from '../api/fieldReportClient';
import { useToastStore } from '../store/toastStore';
import type { ObserverInfo } from '../services/fieldReport';

export function useObserver(): { observer: ObserverInfo | null; refresh: () => Promise<ObserverInfo | null> } {
  const [observer, setObserver] = useState<ObserverInfo | null>(null);
  useEffect(() => {
    let alive = true;
    fetchObserver().then((o) => { if (alive) setObserver(o); });
    return () => { alive = false; };
  }, []);
  const refresh = useCallback(async () => {
    const o = await fetchObserver();
    setObserver(o);
    return o;
  }, []);
  return { observer, refresh };
}

/** Says hello once, the visit a personal link is opened (mounted with the deferred hooks, when
 *  the map is already on screen). */
export function useObserverGreeting(): void {
  useEffect(() => {
    if (!takeObserverGreeting()) return;
    let alive = true;
    fetchObserver().then((o) => {
      if (alive && o) useToastStore.getState().addToast(`Hola, ${o.name}. Tus reportes cuentan como observador de confianza.`, 'success');
    });
    return () => { alive = false; };
  }, []);
}
