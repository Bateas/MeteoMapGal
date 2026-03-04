import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

// ── Types ──────────────────────────────────────────────────

export type WeatherLayerType = 'none' | 'wind-particles' | 'humidity' | 'satellite' | 'radar';

// ── State ──────────────────────────────────────────────────

interface WeatherLayerState {
  activeLayer: WeatherLayerType;
  layerOpacity: number; // 0..1

  // Actions
  setActiveLayer: (layer: WeatherLayerType) => void;
  cycleLayer: () => void;
  setLayerOpacity: (opacity: number) => void;
}

const LAYER_CYCLE: WeatherLayerType[] = ['none', 'wind-particles', 'humidity', 'satellite', 'radar'];

export const useWeatherLayerStore = create<WeatherLayerState>()(
  devtools(
    persist(
      (set, get) => ({
        activeLayer: 'none' as WeatherLayerType,
        layerOpacity: 0.75,

        setActiveLayer: (activeLayer) =>
          set({ activeLayer }, undefined, 'setActiveLayer'),

        cycleLayer: () => {
          const current = get().activeLayer;
          const idx = LAYER_CYCLE.indexOf(current);
          const next = LAYER_CYCLE[(idx + 1) % LAYER_CYCLE.length];
          set({ activeLayer: next }, undefined, 'cycleLayer');
        },

        setLayerOpacity: (layerOpacity) =>
          set({ layerOpacity: Math.max(0, Math.min(1, layerOpacity)) }, undefined, 'setLayerOpacity'),
      }),
      {
        name: 'meteomap-layer-prefs',
        partialize: (state) => ({
          layerOpacity: state.layerOpacity,
        }),
      },
    ),
    { name: 'WeatherLayerStore' },
  ),
);
