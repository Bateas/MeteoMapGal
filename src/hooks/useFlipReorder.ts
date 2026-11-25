/**
 * A row of a list that changes place slides to it in 200 ms instead of jumping, so the eye can follow
 * who moved. FLIP with the browser's own Web Animations, no dependency.
 *
 * Rows carry data-flip-key. Positions come from offsetTop, so scrolling is not a move (the list must be
 * their offsetParent: position: relative). Only runs when the order changes. The reduced-motion rule of
 * index.css does not reach animations started from script, so it is asked here.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { prefersReducedMotion } from '../services/idleAnimations';

const DURATION_MS = 200;
/** Same curve as --g-ease */
const EASING = 'cubic-bezier(.2, 0, 0, 1)';

export function useFlipReorder(listRef: RefObject<HTMLElement | null>, order: string): void {
  const positions = useRef(new Map<string, number>());
  const lastOrder = useRef(order);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const rows = list.querySelectorAll<HTMLElement>('[data-flip-key]');
    const next = new Map<string, number>();
    rows.forEach((el) => next.set(el.dataset.flipKey!, el.offsetTop));

    if (lastOrder.current !== order && !prefersReducedMotion()) {
      rows.forEach((el) => {
        const before = positions.current.get(el.dataset.flipKey!);
        const after = next.get(el.dataset.flipKey!);
        if (before == null || after == null || before === after) return;
        el.animate?.(
          [{ transform: `translateY(${before - after}px)` }, { transform: 'none' }],
          { duration: DURATION_MS, easing: EASING },
        );
      });
    }
    positions.current = next;
    lastOrder.current = order;
  });
}
