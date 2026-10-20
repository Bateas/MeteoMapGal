import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

// ── Types ──────────────────────────────────────────────────

export type WeatherLayerType = 'none' | 'wind-particles' | 'radar';

// ── State ──────────────────────────────────────────────────

interface WeatherLayerState {
  activeLayer: WeatherLayerType;
  layerOpacity: number; // 0..1

  // Actions
  setActiveLayer: (layer: WeatherLayerType) => void;
  cycleLayer: () => void;
  setLayerOpacity: (opacity: number) => void;
}

const LAYER_CYCLE: WeatherLayerType[] = ['none', 'wind-particles', 'radar'];

export const DEFAULT_LAYER_OPACITY = 0.75;
/** Below this a layer is on but invisible, and the choice is saved: the radar looked broken (its
 *  animation ran with nothing on the map). Turning a layer off is the layer button's job. */
export const MIN_LAYER_OPACITY = 0.1;

const clampOpacity = (v: number) => Math.max(MIN_LAYER_OPACITY, Math.min(1, v));

export const useWeatherLayerStore = create<WeatherLayerState>()(
  devtools(
    persist(
      (set, get) => ({
        activeLayer: 'none' as WeatherLayerType,
        layerOpacity: DEFAULT_LAYER_OPACITY,

        setActiveLayer: (activeLayer) =>
          set({ activeLayer }, undefined, 'setActiveLayer'),

        cycleLayer: () => {
          const current = get().activeLayer;
          const idx = LAYER_CYCLE.indexOf(current);
          const next = LAYER_CYCLE[(idx + 1) % LAYER_CYCLE.length];
          set({ activeLayer: next }, undefined, 'cycleLayer');
        },

        setLayerOpacity: (layerOpacity) =>
          set({ layerOpacity: clampOpacity(layerOpacity) }, undefined, 'setLayerOpacity'),
      }),
      {
        name: 'meteomap-layer-prefs',
        // v1: the humidity layer was removed. A saved 'humidity' falls back to no layer.
        // v2: a saved opacity under the floor (an invisible layer) goes back to the default.
        version: 2,
        migrate: (persisted) => {
          const s = (persisted ?? {}) as { activeLayer?: string; layerOpacity?: number };
          if (s.activeLayer === 'humidity') s.activeLayer = 'none';
          if (typeof s.layerOpacity !== 'number' || s.layerOpacity < MIN_LAYER_OPACITY) s.layerOpacity = DEFAULT_LAYER_OPACITY;
          return s as { activeLayer: WeatherLayerType; layerOpacity: number };
        },
        partialize: (state) => ({
          activeLayer: state.activeLayer,
          layerOpacity: state.layerOpacity,
        }),
      },
    ),
    { name: 'WeatherLayerStore' },
  ),
);
