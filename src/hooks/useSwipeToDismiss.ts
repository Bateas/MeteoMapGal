import { useRef, useCallback } from 'react';

/**
 * Swipe-down-to-dismiss for mobile bottom sheets.
 * Returns handlers to spread on the drag handle or sheet container.
 * Calls `onDismiss` when user swipes down > threshold (80px).
 */
export function useSwipeToDismiss(onDismiss: () => void, threshold = 80) {
  const startY = useRef(0);
  const currentY = useRef(0);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
    currentY.current = startY.current;
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'none';
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    currentY.current = e.touches[0].clientY;
    const dy = currentY.current - startY.current;
    if (dy > 0 && sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${dy}px)`;
      sheetRef.current.style.opacity = `${Math.max(0.3, 1 - dy / 300)}`;
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    const dy = currentY.current - startY.current;
    if (sheetRef.current) {
      sheetRef.current.style.transition = 'transform 0.2s ease-out, opacity 0.2s ease-out';
      if (dy > threshold) {
        sheetRef.current.style.transform = 'translateY(100%)';
        sheetRef.current.style.opacity = '0';
        setTimeout(onDismiss, 200);
      } else {
        sheetRef.current.style.transform = 'translateY(0)';
        sheetRef.current.style.opacity = '1';
      }
    }
  }, [onDismiss, threshold]);

  return { sheetRef, onTouchStart, onTouchMove, onTouchEnd };
}
