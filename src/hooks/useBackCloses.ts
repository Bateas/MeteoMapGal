/**
 * While `open` is true, the back button (phone or browser) closes this instead of leaving the app.
 * See services/backStack.ts. `slot` names the place: things that replace each other share one.
 */
import { useEffect, useRef } from 'react';
import { holdBackSlot, type BackSlotOptions } from '../services/backStack';

export function useBackCloses(open: boolean, close: () => void, slot: string, options?: BackSlotOptions): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  const releasedRef = useRef(options?.onReleased);
  releasedRef.current = options?.onReleased;
  const url = options?.url;
  useEffect(() => {
    if (!open) return;
    return holdBackSlot(slot, () => closeRef.current(), { url, onReleased: () => releasedRef.current?.() });
  }, [open, slot, url]);
}
