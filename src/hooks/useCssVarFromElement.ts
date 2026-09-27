import { useLayoutEffect, type RefObject } from 'react';

/**
 * Keep a CSS custom property on :root in step with an element's top edge or
 * height, without re-rendering React: a ResizeObserver writes the value
 * straight onto the document, and anything positioned with `var(...)` follows.
 *
 * Why: on a phone the map starts wherever the stack above it ends — header,
 * simple-mode bar, official warnings, ticker, favourable window — and that
 * stack changes height with the day's warnings. Notices pinned at a fixed
 * distance from the top of the SCREEN landed on those banners. They now read
 * `--map-top`, measured from the map itself.
 *
 * `top` is re-measured whenever the element resizes: the map is the flexible
 * part of the column, so anything growing above it shrinks it. The property is
 * removed on unmount, so a stale value never outlives its element.
 */
export function useCssVarFromElement(
  ref: RefObject<HTMLElement | null>,
  varName: string,
  measure: 'top' | 'height',
  enabled = true,
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const root = document.documentElement;
    let last = '';
    const update = () => {
      const px = measure === 'top' ? el.getBoundingClientRect().top : el.offsetHeight;
      const value = `${Math.round(px)}px`;
      if (value !== last) {
        last = value;
        root.style.setProperty(varName, value);
      }
    };
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
      root.style.removeProperty(varName);
    };
  }, [ref, varName, measure, enabled]);
}
