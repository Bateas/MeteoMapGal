import { describe, it, expect, vi, afterEach } from 'vitest';
import { installIdleAnimations, pageIsIdle, IDLE_MS } from './idleAnimations';

describe('installIdleAnimations', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('tells the loops run from script what it told the stylesheet', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const remove = installIdleAnimations(root, () => Date.now());
    expect(pageIsIdle(root)).toBe(false);
    vi.advanceTimersByTime(IDLE_MS + 60_000);
    expect(pageIsIdle(root)).toBe(true);
    window.dispatchEvent(new Event('pointerdown'));
    expect(pageIsIdle(root)).toBe(false);
    remove();
  });

  it('marks the page idle after IDLE_MS without activity and wakes it on a gesture', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const remove = installIdleAnimations(root, () => Date.now());
    vi.advanceTimersByTime(IDLE_MS - 60_000);
    expect(root.hasAttribute('data-idle')).toBe(false);
    vi.advanceTimersByTime(90_000);
    expect(root.hasAttribute('data-idle')).toBe(true);
    window.dispatchEvent(new Event('pointerdown'));
    expect(root.hasAttribute('data-idle')).toBe(false);
    remove();
  });

  it('activity keeps it awake', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const remove = installIdleAnimations(root, () => Date.now());
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(IDLE_MS / 2);
      window.dispatchEvent(new Event('keydown'));
    }
    expect(root.hasAttribute('data-idle')).toBe(false);
    remove();
  });

  it('the cleanup removes the mark and stops the timer', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const remove = installIdleAnimations(root, () => Date.now());
    vi.advanceTimersByTime(IDLE_MS + 60_000);
    expect(root.hasAttribute('data-idle')).toBe(true);
    remove();
    expect(root.hasAttribute('data-idle')).toBe(false);
    vi.advanceTimersByTime(IDLE_MS * 2);
    expect(root.hasAttribute('data-idle')).toBe(false);
  });
});
