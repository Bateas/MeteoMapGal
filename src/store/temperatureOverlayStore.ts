import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { ThermalProfile } from '../services/lapseRateService';

interface TemperatureOverlayState {
  /** Whether the temperature gradient overlay is visible on the map */
  showOverlay: boolean;
  /** Computed thermal profile from current station readings (regression-based) */
  thermalProfile: ThermalProfile | null;

  toggleOverlay: () => void;
  setThermalProfile: (profile: ThermalProfile) => void;
}

export const useTemperatureOverlayStore = create<TemperatureOverlayState>()(
  devtools(
    (set, get) => ({
      showOverlay: false,
      thermalProfile: null,

      toggleOverlay: () =>
        set({ showOverlay: !get().showOverlay }, undefined, 'toggleOverlay'),

      setThermalProfile: (thermalProfile) =>
        set({ thermalProfile }, undefined, 'setThermalProfile'),
    }),
    { name: 'TemperatureOverlayStore' },
  ),
);
