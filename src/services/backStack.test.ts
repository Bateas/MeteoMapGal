import { describe, expect, it, vi } from 'vitest';
import { createBackStack } from './backStack';

/** A window whose history is a list we can walk by hand: `press()` is the back button. */
function fakeWindow() {
  const entries: string[] = ['/'];
  let at = 0;
  let onPop: (() => void) | null = null;
  const timers: Array<() => void> = [];
  const win = {
    history: {
      pushState: (_d: unknown, _u: string, url?: string | URL | null) => { entries.length = at + 1; entries.push(String(url ?? entries[at])); at++; },
      replaceState: (_d: unknown, _u: string, url?: string | URL | null) => { entries[at] = String(url ?? entries[at]); },
      back: () => { at--; onPop?.(); },
    },
    addEventListener: (_t: 'popstate', l: () => void) => { onPop = l; },
    location: { get href() { return entries[at]; } },
    setTimeout: (h: () => void) => { timers.push(h); return timers.length; },
    clearTimeout: (id: never) => { timers[(id as unknown as number) - 1] = () => {}; },
  };
  return {
    win,
    press: () => { if (at > 0) { at--; onPop?.(); } },
    tick: () => { for (const t of timers.splice(0)) t(); },
    url: () => entries[at],
    depth: () => at,
  };
}

describe('backStack', () => {
  it('a card with no address after one with it puts the map address back (P3 review, 19-nov)', () => {
    const w = fakeWindow();
    const stack = createBackStack(w.win);
    const releaseSpot = stack.hold('ficha', vi.fn(), { url: '/?spot=cesantes' });
    expect(w.url()).toBe('/?spot=cesantes');
    releaseSpot();
    stack.hold('ficha', vi.fn());
    w.tick();
    expect(w.url()).toBe('/');
    expect(w.depth()).toBe(1);
  });

  it('back closes what is open and stays in the app', () => {
    const w = fakeWindow();
    const stack = createBackStack(w.win);
    const close = vi.fn();
    stack.hold('ficha', close, { url: '/?spot=cesantes' });
    expect(w.url()).toBe('/?spot=cesantes');
    w.press();
    expect(close).toHaveBeenCalledTimes(1);
    expect(w.depth()).toBe(0);
    expect(stack.depth()).toBe(0);
  });

  it('closing from the interface takes its entry out, without calling close again', () => {
    const w = fakeWindow();
    const stack = createBackStack(w.win);
    const close = vi.fn();
    const released = vi.fn();
    const release = stack.hold('ficha', close, { onReleased: released });
    release();
    w.tick();
    expect(close).not.toHaveBeenCalled();
    expect(released).toHaveBeenCalledTimes(1);
    expect(w.depth()).toBe(0);
  });

  it('swapping one card for another keeps one entry and takes the new address', () => {
    const w = fakeWindow();
    const stack = createBackStack(w.win);
    const closeA = vi.fn();
    const closeB = vi.fn();
    const releaseA = stack.hold('ficha', closeA, { url: '/?spot=a' });
    releaseA();
    stack.hold('ficha', closeB, { url: '/?spot=b' });
    w.tick();
    expect(w.depth()).toBe(1);
    expect(w.url()).toBe('/?spot=b');
    w.press();
    expect(closeB).toHaveBeenCalledTimes(1);
    expect(closeA).not.toHaveBeenCalled();
  });

  it('back closes the newest first: the menu, then the card', () => {
    const w = fakeWindow();
    const stack = createBackStack(w.win);
    const order: string[] = [];
    stack.hold('ficha', () => order.push('ficha'));
    stack.hold('menu', () => order.push('menu'));
    w.press();
    w.press();
    expect(order).toEqual(['menu', 'ficha']);
    expect(w.depth()).toBe(0);
  });

  it('a menu that closes itself to open the guide leaves the guide its address, and one back still empties it', () => {
    const w = fakeWindow();
    const stack = createBackStack(w.win);
    const closeGuide = vi.fn();
    const releaseMenu = stack.hold('menu', () => {});
    releaseMenu();
    stack.hold('guide', closeGuide);
    w.win.history.replaceState(null, '', '/#guia/spots');
    w.tick();
    expect(w.url()).toBe('/#guia/spots');
    w.press();
    expect(closeGuide).toHaveBeenCalledTimes(1);
    expect(w.depth()).toBe(0);
    expect(w.url()).toBe('/');
  });

  it('the guide closed from its own button also empties what was left under it', () => {
    const w = fakeWindow();
    const stack = createBackStack(w.win);
    const releaseMenu = stack.hold('menu', () => {});
    releaseMenu();
    const releaseGuide = stack.hold('guide', () => {});
    w.tick();
    releaseGuide();
    w.tick();
    expect(w.depth()).toBe(0);
    expect(stack.depth()).toBe(0);
  });

  it('a release after a back press does nothing', () => {
    const w = fakeWindow();
    const stack = createBackStack(w.win);
    const release = stack.hold('ficha', () => {});
    w.press();
    release();
    w.tick();
    expect(w.depth()).toBe(0);
  });

  it('a stale release of a card already replaced leaves the new one alone', () => {
    const w = fakeWindow();
    const stack = createBackStack(w.win);
    const releaseA = stack.hold('ficha', () => {});
    stack.hold('ficha', () => {});
    releaseA();
    w.tick();
    expect(stack.depth()).toBe(1);
    expect(w.depth()).toBe(1);
  });
});
