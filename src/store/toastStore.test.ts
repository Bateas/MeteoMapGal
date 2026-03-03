/**
 * Toast Store tests — add, remove, auto-dismiss, max stack.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useToastStore } from './toastStore';

describe('toastStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useToastStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with empty toasts', () => {
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('adds a toast with default severity "info"', () => {
    useToastStore.getState().addToast('Hello');
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('Hello');
    expect(toasts[0].severity).toBe('info');
  });

  it('adds a toast with specific severity', () => {
    useToastStore.getState().addToast('Error occurred', 'error');
    const toasts = useToastStore.getState().toasts;
    expect(toasts[0].severity).toBe('error');
  });

  it('assigns unique IDs to toasts', () => {
    const { addToast } = useToastStore.getState();
    addToast('First');
    addToast('Second');
    const toasts = useToastStore.getState().toasts;
    expect(toasts[0].id).not.toBe(toasts[1].id);
  });

  it('removes a toast by ID', () => {
    useToastStore.getState().addToast('Will be removed');
    const toast = useToastStore.getState().toasts[0];
    useToastStore.getState().removeToast(toast.id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('auto-dismisses toast after 4 seconds', () => {
    useToastStore.getState().addToast('Auto dismiss');
    expect(useToastStore.getState().toasts).toHaveLength(1);

    vi.advanceTimersByTime(4000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('caps stack at 5 toasts maximum', () => {
    const { addToast } = useToastStore.getState();
    for (let i = 0; i < 8; i++) {
      addToast(`Toast ${i}`);
    }
    // Should keep only the latest 5 (slice -4 keeps 4 + 1 new = 5 max)
    expect(useToastStore.getState().toasts.length).toBeLessThanOrEqual(5);
  });
});
