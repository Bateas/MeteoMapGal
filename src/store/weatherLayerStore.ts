import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

// ── Types ──────────────────────────────────────────────────

export type WeatherLayerType = 'none' | 'wind-particles' | 'humidity' | 'satellite' | 'wrf';

export type WrfVariable =
  | 'prec'      // precipitation (mm)
  | 'cft'       // cloud fraction total (0-1)
  | 'mod'       // wind speed (m/s)
  | 'rh'        // relative humidity (%)
  | 'cape'      // CAPE (J/kg)
  | 'visibility'; // visibility (m)

export const WRF_VARIABLES: { id: WrfVariable; label: string; icon: string; unit: string; range: [number, number] }[] = [
  { id: 'prec', label: 'Precipitación', icon: '🌧️', unit: 'mm', range: [0, 20] },
  { id: 'cft', label: 'Nubosidad', icon: '☁️', unit: '%', range: [0, 100] },
  { id: 'mod', label: 'Viento', icon: '💨', unit: 'm/s', range: [0, 20] },
  { id: 'rh', label: 'Humedad', icon: '💧', unit: '%', range: [0, 100] },
  { id: 'cape', label: 'CAPE', icon: '⚡', unit: 'J/kg', range: [0, 2000] },
  { id: 'visibility', label: 'Visibilidad', icon: '👁️', unit: 'km', range: [0, 50] },
];

// ── WRF time step type ────────────────────────────────────

export interface WrfTimeStep {
  time: Date;
  label: string;
}

// ── State ──────────────────────────────────────────────────

interface WeatherLayerState {
  activeLayer: WeatherLayerType;
  layerOpacity: number; // 0..1

  // WRF model state
  wrfVariable: WrfVariable;
  wrfTimeIndex: number;
  wrfAvailableTimes: WrfTimeStep[];
  wrfModelRun: string | null;
  wrfLoading: boolean;
  wrfError: string | null;

  // Actions
  setActiveLayer: (layer: WeatherLayerType) => void;
  cycleLayer: () => void;
  setLayerOpacity: (opacity: number) => void;

  // WRF actions
  setWrfVariable: (v: WrfVariable) => void;
  setWrfTimeIndex: (i: number) => void;
  setWrfAvailableTimes: (times: WrfTimeStep[]) => void;
  setWrfModelRun: (run: string | null) => void;
  setWrfLoading: (loading: boolean) => void;
  setWrfError: (error: string | null) => void;
}

// WRF removed from cycle — only real-time layers on map
const LAYER_CYCLE: WeatherLayerType[] = ['none', 'wind-particles', 'humidity', 'satellite'];

export const useWeatherLayerStore = create<WeatherLayerState>()(
  devtools(
    persist(
      (set, get) => ({
        activeLayer: 'none' as WeatherLayerType,
        layerOpacity: 0.75,

        // WRF defaults
        wrfVariable: 'cft' as WrfVariable,
        wrfTimeIndex: 0,
        wrfAvailableTimes: [],
        wrfModelRun: null,
        wrfLoading: false,
        wrfError: null,

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

        // WRF actions
        setWrfVariable: (wrfVariable) =>
          set({ wrfVariable }, undefined, 'setWrfVariable'),
        setWrfTimeIndex: (wrfTimeIndex) =>
          set({ wrfTimeIndex }, undefined, 'setWrfTimeIndex'),
        setWrfAvailableTimes: (wrfAvailableTimes) =>
          set({ wrfAvailableTimes }, undefined, 'setWrfAvailableTimes'),
        setWrfModelRun: (wrfModelRun) =>
          set({ wrfModelRun }, undefined, 'setWrfModelRun'),
        setWrfLoading: (wrfLoading) =>
          set({ wrfLoading }, undefined, 'setWrfLoading'),
        setWrfError: (wrfError) =>
          set({ wrfError }, undefined, 'setWrfError'),
      }),
      {
        name: 'meteomap-layer-prefs',
        partialize: (state) => ({
          layerOpacity: state.layerOpacity,
          wrfVariable: state.wrfVariable,
        }),
      },
    ),
    { name: 'WeatherLayerStore' },
  ),
);
