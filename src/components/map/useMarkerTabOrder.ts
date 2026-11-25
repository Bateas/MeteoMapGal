import { useEffect, type RefObject } from 'react';
import { orderMarkersForTab } from './markerA11y';

/**
 * Before the Tab key moves the focus, the markers of the map take the order of what is in view
 * (orderMarkersForTab). On the key and not on every move of the map: it costs nothing while nobody
 * uses the keyboard, and no marker is touched under a finger.
 */
export function useMarkerTabOrder(mapBoxRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      orderMarkersForTab(mapBoxRef.current?.querySelector<HTMLElement>('.maplibregl-canvas-container'));
    };
    // Capture: the order has to be in place before the browser picks the next stop
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [mapBoxRef]);
}
