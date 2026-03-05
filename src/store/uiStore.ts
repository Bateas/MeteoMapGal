import { create } from 'zustand';

interface FlyToTarget {
  lon: number;
  lat: number;
  zoom?: number;
}

interface UIState {
  sidebarOpen: boolean;
  guideOpen: boolean;
  isMobile: boolean;
  droneTabActive: boolean;
  flyToTarget: FlyToTarget | null;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleGuide: () => void;
  setGuideOpen: (open: boolean) => void;
  setIsMobile: (mobile: boolean) => void;
  setDroneTabActive: (active: boolean) => void;
  setFlyToTarget: (target: FlyToTarget | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: false,
  guideOpen: false,
  isMobile: typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  droneTabActive: false,
  flyToTarget: null,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleGuide: () => set((s) => ({ guideOpen: !s.guideOpen })),
  setGuideOpen: (open) => set({ guideOpen: open }),
  setIsMobile: (mobile) => set({ isMobile: mobile }),
  setDroneTabActive: (active) => set({ droneTabActive: active }),
  setFlyToTarget: (target) => set({ flyToTarget: target }),
}));
