/**
 * The side panel of the phone: slides over the map with a dark backdrop. Escape closes it from the document,
 * not from the backdrop: a backdrop never takes the focus, so its own key handler never ran (P3 review, 19-nov).
 * Like the cards, it yields the key to a modal dialog open on top and to a text field.
 */
import { useEffect, type ReactNode } from 'react';

export function MobileSidePanel({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-30 gc-fade-in" onClick={onClose} role="presentation" />
      <aside className="g-theme gc-aside gc-aside--sheet fixed inset-y-0 left-0 z-40 w-[min(320px,calc(100vw-40px))] shadow-2xl animate-slide-in-left">
        {children}
      </aside>
    </>
  );
}
