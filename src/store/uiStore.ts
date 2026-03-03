import { create } from 'zustand';

interface UIState {
  sidebarOpen: boolean;
  guideOpen: boolean;
  isMobile: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleGuide: () => void;
  setGuideOpen: (open: boolean) => void;
  setIsMobile: (mobile: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: false,
  guideOpen: false,
  isMobile: typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleGuide: () => set((s) => ({ guideOpen: !s.guideOpen })),
  setGuideOpen: (open) => set({ guideOpen: open }),
  setIsMobile: (mobile) => set({ isMobile: mobile }),
}));
