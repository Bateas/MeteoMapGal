/**
 * Twenty polling loops hang off this hook, and several of them fan out to one
 * request per station or per webcam. So what it does when someone alt-tabs is
 * not a detail: it used to ask for everything again on every return to the
 * tab, which is how a handful of people kept a provider busy at 174 requests
 * a minute. These tests pin the rule — mount asks, returning to the tab only
 * asks if the answer is older than its own interval.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVisibilityPolling } from './useVisibilityPolling';

let visibility: DocumentVisibilityState = 'visible';

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const MINUTE = 60_000;

describe('useVisibilityPolling', () => {
  it('asks once on mount', () => {
    const poll = vi.fn();
    renderHook(() => useVisibilityPolling(poll, 10 * MINUTE));
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('keeps its rhythm while the tab stays open', () => {
    const poll = vi.fn();
    renderHook(() => useVisibilityPolling(poll, 10 * MINUTE));
    vi.advanceTimersByTime(30 * MINUTE);
    expect(poll).toHaveBeenCalledTimes(4); // mount + three intervals
  });

  it('does not ask again when the tab comes back with a fresh answer', () => {
    const poll = vi.fn();
    renderHook(() => useVisibilityPolling(poll, 10 * MINUTE));
    expect(poll).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 20; i++) {
      setVisibility('hidden');
      vi.advanceTimersByTime(1_000);
      setVisibility('visible');
    }
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('asks when the tab comes back and the answer has expired', () => {
    const poll = vi.fn();
    renderHook(() => useVisibilityPolling(poll, 10 * MINUTE));

    setVisibility('hidden');
    vi.advanceTimersByTime(11 * MINUTE);
    setVisibility('visible');
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('picks the rhythm back up when what was left of the interval runs out', () => {
    const poll = vi.fn();
    renderHook(() => useVisibilityPolling(poll, 10 * MINUTE));

    setVisibility('hidden');
    vi.advanceTimersByTime(6 * MINUTE);
    setVisibility('visible');
    expect(poll).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4 * MINUTE); // the four minutes still owed
    expect(poll).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10 * MINUTE);
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('asks straight away when the sector changes, however recent the answer', () => {
    // useBuoyData passes enabled=isCoastal: leaving Rias empties the buoys, so
    // coming back has to fetch even though the last answer is a minute old.
    const poll = vi.fn();
    const { rerender } = renderHook(
      ({ enabled }) => useVisibilityPolling(poll, 10 * MINUTE, enabled),
      { initialProps: { enabled: true } },
    );
    expect(poll).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });
    vi.advanceTimersByTime(MINUTE);
    rerender({ enabled: true });
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('stops asking while the tab is hidden', () => {
    const poll = vi.fn();
    renderHook(() => useVisibilityPolling(poll, 2 * MINUTE));
    poll.mockClear();

    setVisibility('hidden');
    vi.advanceTimersByTime(60 * MINUTE);
    expect(poll).not.toHaveBeenCalled();
  });
});
