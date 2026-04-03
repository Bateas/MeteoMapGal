import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'dark' | 'light';

interface ThemeStore {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

/** Detect system preference — only used on first visit (before localStorage has a value) */
const systemTheme: ThemeMode =
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches
    ? 'light' : 'dark';

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      theme: systemTheme,
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
    }),
    { name: 'meteomap-theme' },
  ),
);
