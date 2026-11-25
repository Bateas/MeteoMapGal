/**
 * Pause the endless animations of a page nobody is touching.
 *
 * What loops (a pulsing dot, the wind particles) never stops by itself, so an open tab repaints every
 * frame for as long as it stays open. On 15-oct a tab left open 27 h took the browser's GPU process to
 * ~200 GB. After IDLE_MS without a pointer, key, wheel or touch, `data-idle` goes on <html> and index.css
 * pauses every CSS animation (the page looks the same, it only stops moving). Loops run from script ask
 * pageIsIdle. Any gesture, or coming back to the tab, takes it off at once.
 */

export const IDLE_MS = 10 * 60_000;
const CHECK_MS = 30_000;
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

/** For loops run from script: the rule of index.css only reaches CSS. */
export function pageIsIdle(root: HTMLElement = document.documentElement): boolean {
  return root.hasAttribute('data-idle');
}

/** The reduced-motion rule of index.css does not reach what script moves, so it is asked here. */
export function prefersReducedMotion(): boolean {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Installs the listeners once; returns the function that removes them (tests). */
export function installIdleAnimations(root: HTMLElement = document.documentElement, now: () => number = Date.now): () => void {
  let lastActivity = now();
  const wake = () => {
    lastActivity = now();
    if (root.hasAttribute('data-idle')) root.removeAttribute('data-idle');
  };
  const onVisibility = () => { if (document.visibilityState === 'visible') wake(); };
  for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, wake, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  const timer = window.setInterval(() => {
    if (now() - lastActivity >= IDLE_MS && !root.hasAttribute('data-idle')) root.setAttribute('data-idle', '');
  }, CHECK_MS);
  return () => {
    for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, wake);
    document.removeEventListener('visibilitychange', onVisibility);
    window.clearInterval(timer);
    root.removeAttribute('data-idle');
  };
}
