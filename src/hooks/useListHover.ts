/**
 * A row of the side panel and its place on the map: passing over a row, or reaching it with the keyboard, marks
 * where it is (components/map/ListHoverRing). Desktop only: on a phone the panel covers the map.
 */
import { useEffect } from 'react';
import { useUIStore } from '../store/uiStore';

export function listHoverHandlers(lon: number, lat: number, offsetX = 0) {
  const on = () => {
    const ui = useUIStore.getState();
    if (!ui.isMobile) ui.setListHover({ lon, lat, offsetX });
  };
  const off = () => useUIStore.getState().setListHover(null);
  return { onMouseEnter: on, onMouseLeave: off, onFocus: on, onBlur: off };
}

/** A list that goes away (another tab, the panel folded) takes the mark with it. */
export function useClearListHover(): void {
  useEffect(() => () => useUIStore.getState().setListHover(null), []);
}
