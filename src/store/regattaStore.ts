/**
 * Regatta / Event Mode store.
 * Manages event zone, timer, virtual buoy markers, and zone weather.
 */
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export interface ZoneBounds {
  ne: [number, number]; // [lon, lat] northeast corner
  sw: [number, number]; // [lon, lat] southwest corner
}

export interface BuoyMarker {
  id: string;
  lon: number;
  lat: number;
  label: string; // A, B, C...
}

export type DrawingPhase = 'idle' | 'first' | 'second';
export type SemaphoreLevel = 'green' | 'yellow' | 'red';

export interface ZoneConditions {
  avgWindKt: number;
  maxGustKt: number;
  windDir: number | null;
  stationsInZone: number;
  semaphore: SemaphoreLevel;
  alerts: string[];
  // Extended (optional)
  avgHumidity?: number;
  maxTemp?: number;
  minTemp?: number;
  waveHeight?: number;
  swellHeight?: number;
  wavePeriod?: number;
  waterTemp?: number;
  interpolated?: boolean;
}

interface RegattaState {
  active: boolean;
  minimized: boolean;
  drawingPhase: DrawingPhase;
  firstCorner: [number, number] | null;
  zone: ZoneBounds | null;
  timerRunning: boolean;
  timerStartMs: number;
  elapsedMs: number;
  buoyMarkers: BuoyMarker[];
  conditions: ZoneConditions | null;

  startDrawing: () => void;
  setFirstCorner: (lonLat: [number, number]) => void;
  setZone: (bounds: ZoneBounds) => void;
  addBuoy: (lon: number, lat: number) => void;
  moveBuoy: (id: string, lon: number, lat: number) => void;
  removeBuoy: (id: string) => void;
  toggleTimer: () => void;
  resetTimer: () => void;
  setConditions: (c: ZoneConditions) => void;
  toggleMinimize: () => void;
  deactivate: () => void;
}

const BUOY_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const useRegattaStore = create<RegattaState>()(
  devtools(
    (set, get) => ({
      active: false,
      minimized: false,
      drawingPhase: 'idle',
      firstCorner: null,
      zone: null,
      timerRunning: false,
      timerStartMs: 0,
      elapsedMs: 0,
      buoyMarkers: [],
      conditions: null,

      startDrawing: () => set({
        active: true,
        minimized: false,
        drawingPhase: 'first',
        firstCorner: null,
        zone: null,
        buoyMarkers: [],
        conditions: null,
        timerRunning: false,
        elapsedMs: 0,
      }),

      setFirstCorner: (lonLat) => set({ firstCorner: lonLat, drawingPhase: 'second' }),

      setZone: (bounds) => set({ zone: bounds, drawingPhase: 'idle' }),

      addBuoy: (lon, lat) => {
        const markers = get().buoyMarkers;
        const z = get().zone;
        // Clamp to zone bounds
        if (z) {
          lon = Math.max(Math.min(z.ne[0], z.sw[0]), Math.min(lon, Math.max(z.ne[0], z.sw[0])));
          lat = Math.max(Math.min(z.ne[1], z.sw[1]), Math.min(lat, Math.max(z.ne[1], z.sw[1])));
        }
        const label = BUOY_LABELS[markers.length % 26];
        set({ buoyMarkers: [...markers, { id: `buoy-${Date.now()}`, lon, lat, label }] });
      },

      moveBuoy: (id, lon, lat) => {
        const z = get().zone;
        // Clamp drag to zone bounds
        if (z) {
          lon = Math.max(Math.min(z.ne[0], z.sw[0]), Math.min(lon, Math.max(z.ne[0], z.sw[0])));
          lat = Math.max(Math.min(z.ne[1], z.sw[1]), Math.min(lat, Math.max(z.ne[1], z.sw[1])));
        }
        set({ buoyMarkers: get().buoyMarkers.map((b) => b.id === id ? { ...b, lon, lat } : b) });
      },

      removeBuoy: (id) => set({
        buoyMarkers: get().buoyMarkers.filter((b) => b.id !== id),
      }),

      toggleTimer: () => {
        const s = get();
        if (s.timerRunning) {
          set({ timerRunning: false, elapsedMs: s.elapsedMs + (Date.now() - s.timerStartMs) });
        } else {
          set({ timerRunning: true, timerStartMs: Date.now() });
        }
      },

      resetTimer: () => set({ timerRunning: false, timerStartMs: 0, elapsedMs: 0 }),

      setConditions: (conditions) => set({ conditions }),

      toggleMinimize: () => set((s) => ({ minimized: !s.minimized })),

      deactivate: () => set({
        active: false,
        minimized: false,
        drawingPhase: 'idle',
        firstCorner: null,
        zone: null,
        timerRunning: false,
        timerStartMs: 0,
        elapsedMs: 0,
        buoyMarkers: [],
        conditions: null,
      }),
    }),
    { name: 'RegattaStore' },
  ),
);
