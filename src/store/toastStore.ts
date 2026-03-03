/**
 * Toast notification store — lightweight ephemeral alerts for user feedback.
 */
import { create } from 'zustand';

export type ToastSeverity = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  message: string;
  severity: ToastSeverity;
  createdAt: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (message: string, severity?: ToastSeverity) => void;
  removeToast: (id: string) => void;
}

let nextId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (message, severity = 'info') => {
    const id = `toast-${++nextId}`;
    set((s) => ({
      toasts: [...s.toasts.slice(-4), { id, message, severity, createdAt: Date.now() }],
    }));
    // Auto-dismiss after 4 seconds
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
