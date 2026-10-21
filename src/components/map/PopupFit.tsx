/**
 * Keeps a desktop map popup inside the visible map. The popups open above their marker
 * (anchor="bottom"), so a spot near the top of the screen opened its card under the banner and
 * the ticker, cut off, and you had to drag the map to read it (21-oct, reported). This pans the
 * map just enough, when the card opens and whenever it grows (a section unfolded).
 *
 * Render it anywhere inside the popup's content. It draws nothing.
 */
import { useEffect, useRef } from 'react';
import { useMap } from 'react-map-gl/maplibre';

/** Room kept clear at each edge of the map, in px: the alert banner and ticker sit over the top. */
export const POPUP_FIT_MARGIN = { top: 110, bottom: 56, left: 12, right: 12 };

/** How far to pan (px, map convention: positive y moves the view down) so `box` fits in `frame`. */
export function popupFitShift(
  box: { top: number; bottom: number; left: number; right: number },
  frame: { top: number; bottom: number; left: number; right: number },
  margin = POPUP_FIT_MARGIN,
): { x: number; y: number } {
  const room = (frame.bottom - margin.bottom) - (frame.top + margin.top);
  let y = 0;
  if (box.top < frame.top + margin.top) y = box.top - (frame.top + margin.top);
  else if (box.bottom > frame.bottom - margin.bottom && box.bottom - box.top <= room) {
    y = box.bottom - (frame.bottom - margin.bottom);
  }
  let x = 0;
  if (box.left < frame.left + margin.left) x = box.left - (frame.left + margin.left);
  else if (box.right > frame.right - margin.right) x = box.right - (frame.right - margin.right);
  return { x: Math.round(x), y: Math.round(y) };
}

export function PopupFit() {
  const ref = useRef<HTMLSpanElement>(null);
  const { current: map } = useMap();

  useEffect(() => {
    if (!map) return;
    // The content is mounted before react-map-gl hands it to the popup (a child effect runs
    // first): poll briefly (timers, not animation frames) until it sits inside the popup element.
    let wait: ReturnType<typeof setTimeout> | undefined, tries = 0, ro: ResizeObserver | null = null;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const fit = (popup: HTMLElement) => {
      const frame = map.getContainer().getBoundingClientRect();
      const s = popupFitShift(popup.getBoundingClientRect(), frame);
      if (s.x !== 0 || s.y !== 0) map.panBy([s.x, s.y], { duration: 250 });
    };
    const attach = () => {
      const popup = ref.current?.closest('.maplibregl-popup') as HTMLElement | null;
      if (!popup) {
        if (++tries < 40) wait = setTimeout(attach, 50);
        return;
      }
      fit(popup);
      // Refit only when the card really grew or shrank (a section unfolded), not on a live
      // refresh that moves a figure by a line: that would yank back a map the user panned away.
      let lastH = popup.getBoundingClientRect().height;
      ro = new ResizeObserver(() => {
        const h = popup.getBoundingClientRect().height;
        if (Math.abs(h - lastH) < 24) return;
        lastH = h;
        clearTimeout(pending); pending = setTimeout(() => fit(popup), 120);
      });
      ro.observe(popup);
    };
    wait = setTimeout(attach, 0);
    return () => { clearTimeout(wait); clearTimeout(pending); ro?.disconnect(); };
  }, [map]);

  return <span ref={ref} hidden aria-hidden="true" />;
}
