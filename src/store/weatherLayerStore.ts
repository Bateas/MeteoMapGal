import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

// ── Types ──────────────────────────────────────────────────

export type WeatherLayerType = 'none' | 'wind-particles' | 'humidity' | 'wrf';

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

interface WrfTimeStep {
  time: Date;
  label: string; // e.g. "Hoy 14:00" or "Mañana 08:00"
}

// ── State ──────────────────────────────────────────────────

interface WeatherLayerState {
  activeLayer: WeatherLayerType;
  layerOpacity: number; // 0..1

  // WRF-specific
  wrfVariable: WrfVariable;
  wrfTimeIndex: number;
  wrfAvailableTimes: WrfTimeStep[];
  wrfModelRun: string | null; // e.g. "20260227_0000"
  wrfLoading: boolean;

  // Actions
  setActiveLayer: (layer: WeatherLayerType) => void;
  cycleLayer: () => void;
  setLayerOpacity: (opacity: number) => void;
  setWrfVariable: (variable: WrfVariable) => void;
  setWrfTimeIndex: (index: number) => void;
  setWrfAvailableTimes: (times: WrfTimeStep[], modelRun: string) => void;
  setWrfLoading: (loading: boolean) => void;
}

const LAYER_CYCLE: WeatherLayerType[] = ['none', 'wind-particles', 'humidity', 'wrf'];

export const useWeatherLayerStore = create<WeatherLayerState>()(
  devtools(
    (set, get) => ({
      activeLayer: 'none',
      layerOpacity: 0.65,

      wrfVariable: 'prec',
      wrfTimeIndex: 0,
      wrfAvailableTimes: [],
      wrfModelRun: null,
      wrfLoading: false,

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

      setWrfVariable: (wrfVariable) =>
        set({ wrfVariable }, undefined, 'setWrfVariable'),

      setWrfTimeIndex: (wrfTimeIndex) =>
        set({ wrfTimeIndex }, undefined, 'setWrfTimeIndex'),

      setWrfAvailableTimes: (wrfAvailableTimes, wrfModelRun) =>
        set({ wrfAvailableTimes, wrfModelRun, wrfTimeIndex: 0 }, undefined, 'setWrfAvailableTimes'),

      setWrfLoading: (wrfLoading) =>
        set({ wrfLoading }, undefined, 'setWrfLoading'),
    }),
    { name: 'WeatherLayerStore' },
  ),
);
