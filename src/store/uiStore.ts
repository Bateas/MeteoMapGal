import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
  bathymetryVisible: boolean;
  sstVisible: boolean;
  flyToTarget: FlyToTarget | null;
  feedbackOpen: boolean;
  onboardingStep: number | null;
  onboardingCompleted: boolean;
  /** Requested sidebar tab — set by external components to switch tabs */
  requestedTab: string | null;
  /** FieldDrawer open state (mobile bottom sheet for conditions/alerts) */
  fieldDrawerOpen: boolean;
  setFieldDrawerOpen: (open: boolean) => void;
  toggleFieldDrawer: () => void;
  /** Active bottom nav tab (mobile only) */
  activeBottomTab: 'map' | 'spots' | 'datos' | 'prevision' | 'mas' | null;
  setActiveBottomTab: (tab: 'map' | 'spots' | 'datos' | 'prevision' | 'mas' | null) => void;
  /** Forecast panel expanded (overlay/fullscreen) */
  forecastPanelOpen: boolean;
  setForecastPanelOpen: (open: boolean) => void;
  /** Desktop sidebar collapsed to icon strip (persisted) */
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setFeedbackOpen: (open: boolean) => void;
  setRequestedTab: (tab: string | null) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleGuide: () => void;
  setGuideOpen: (open: boolean) => void;
  setIsMobile: (mobile: boolean) => void;
  setDroneTabActive: (active: boolean) => void;
  toggleBathymetry: () => void;
  toggleSST: () => void;
  setFlyToTarget: (target: FlyToTarget | null) => void;
  setOnboardingStep: (step: number | null) => void;
  completeOnboarding: () => void;
  resetOnboarding: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: false,
      guideOpen: false,
      isMobile: typeof window !== 'undefined' ? window.innerWidth < 768 : false,
      droneTabActive: false,
      bathymetryVisible: false,
      sstVisible: false,
      flyToTarget: null,
      feedbackOpen: false,
      onboardingStep: null,
      onboardingCompleted: false,
      requestedTab: null,
      fieldDrawerOpen: false,
      setFieldDrawerOpen: (open) => set((s) => {
        if (open && s.isMobile) return { fieldDrawerOpen: true, sidebarOpen: false };
        return { fieldDrawerOpen: open };
      }),
      toggleFieldDrawer: () => set((s) => {
        if (!s.fieldDrawerOpen && s.isMobile) return { fieldDrawerOpen: true, sidebarOpen: false };
        return { fieldDrawerOpen: !s.fieldDrawerOpen };
      }),
      activeBottomTab: null,
      setActiveBottomTab: (tab) => set({ activeBottomTab: tab }),
      forecastPanelOpen: false,
      setForecastPanelOpen: (open) => set((s) => {
        // Close sidebar on mobile when opening forecast panel
        if (open && s.isMobile) return { forecastPanelOpen: true, sidebarOpen: false, fieldDrawerOpen: false };
        return { forecastPanelOpen: open };
      }),
      sidebarCollapsed: true, // collapsed by default — map-first
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setFeedbackOpen: (open) => set({ feedbackOpen: open }),
      setRequestedTab: (tab) => set({ requestedTab: tab }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleGuide: () => set((s) => ({ guideOpen: !s.guideOpen })),
      setGuideOpen: (open) => set({ guideOpen: open }),
      setIsMobile: (mobile) => set({ isMobile: mobile }),
      setDroneTabActive: (active) => set({ droneTabActive: active }),
      toggleBathymetry: () => set((s) => ({ bathymetryVisible: !s.bathymetryVisible })),
      toggleSST: () => set((s) => ({ sstVisible: !s.sstVisible })),
      setFlyToTarget: (target) => set({ flyToTarget: target }),
      setOnboardingStep: (step) => set({ onboardingStep: step }),
      completeOnboarding: () => set({ onboardingStep: null, onboardingCompleted: true }),
      resetOnboarding: () => set({ onboardingStep: 0, onboardingCompleted: false }),
    }),
    {
      name: 'meteomap-ui',
      partialize: (state) => ({
        onboardingCompleted: state.onboardingCompleted,
        bathymetryVisible: state.bathymetryVisible,
        sstVisible: state.sstVisible,
      }),
    },
  ),
);
