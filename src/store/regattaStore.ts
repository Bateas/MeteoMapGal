/**
 * Regatta / Event Mode store.
 * Manages event zone, timer, virtual buoy markers, and zone weather.
 */
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { getZoneById, zoneToBounds } from '../config/waterZones';

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

export interface SafetyLogEntry {
  timestamp: number;
  type: 'semaphore' | 'alert' | 'wind' | 'timer' | 'zone';
  message: string;
}

interface RegattaState {
  active: boolean;
  minimized: boolean;
  showZoneSelector: boolean;
  selectedZoneId: string | null;
  drawingPhase: DrawingPhase;
  firstCorner: [number, number] | null;
  zone: ZoneBounds | null;
  zonePolygon: [number, number][] | null;
  timerRunning: boolean;
  timerStartMs: number;
  elapsedMs: number;
  buoyMarkers: BuoyMarker[];
  conditions: ZoneConditions | null;
  safetyLog: SafetyLogEntry[];

  startEvent: () => void; // show zone selector
  selectPredefinedZone: (zoneId: string) => void;
  startDrawing: () => void; // custom zone drawing
  setFirstCorner: (lonLat: [number, number]) => void;
  setZone: (bounds: ZoneBounds) => void;
  addBuoy: (lon: number, lat: number) => void;
  moveBuoy: (id: string, lon: number, lat: number) => void;
  removeBuoy: (id: string) => void;
  toggleTimer: () => void;
  resetTimer: () => void;
  setConditions: (c: ZoneConditions) => void;
  addLogEntry: (type: SafetyLogEntry['type'], message: string) => void;
  toggleMinimize: () => void;
  deactivate: () => void;
}

const BUOY_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const useRegattaStore = create<RegattaState>()(
  devtools(
    (set, get) => ({
      active: false,
      minimized: false,
      showZoneSelector: false,
      selectedZoneId: null,
      drawingPhase: 'idle',
      firstCorner: null,
      zone: null,
      zonePolygon: null,
      timerRunning: false,
      timerStartMs: 0,
      elapsedMs: 0,
      buoyMarkers: [],
      conditions: null,
      safetyLog: [],

      startEvent: () => set({
        active: true,
        minimized: false,
        showZoneSelector: true,
        selectedZoneId: null,
        drawingPhase: 'idle',
        zone: null,
        zonePolygon: null,
        buoyMarkers: [],
        conditions: null,
        timerRunning: false,
        elapsedMs: 0,
      }),

      selectPredefinedZone: (zoneId) => {
        const wz = getZoneById(zoneId);
        if (!wz) return;
        const bounds = zoneToBounds(wz);
        set({
          selectedZoneId: zoneId,
          showZoneSelector: false,
          zone: bounds,
          zonePolygon: wz.polygon,
          drawingPhase: 'idle',
        });
      },

      startDrawing: () => set({
        showZoneSelector: false,
        selectedZoneId: null,
        drawingPhase: 'first',
        firstCorner: null,
        zone: null,
        zonePolygon: null,
      }),

      setFirstCorner: (lonLat) => set({ firstCorner: lonLat, drawingPhase: 'second' }),

      setZone: (bounds) => {
        // Custom rectangle → generate polygon from bounds
        const { ne, sw } = bounds;
        set({
          zone: bounds,
          zonePolygon: [sw, [ne[0], sw[1]], ne, [sw[0], ne[1]], sw],
          drawingPhase: 'idle',
        });
      },

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
          const elapsed = s.elapsedMs + (Date.now() - s.timerStartMs);
          const mins = Math.floor(elapsed / 60000);
          set({
            timerRunning: false,
            elapsedMs: elapsed,
            safetyLog: [...s.safetyLog, { timestamp: Date.now(), type: 'timer', message: `Cronometro pausado (${mins}min)` }],
          });
        } else {
          set({
            timerRunning: true,
            timerStartMs: Date.now(),
            safetyLog: [...s.safetyLog, { timestamp: Date.now(), type: 'timer', message: 'Cronometro iniciado' }],
          });
        }
      },

      resetTimer: () => set({ timerRunning: false, timerStartMs: 0, elapsedMs: 0 }),

      setConditions: (conditions) => {
        // Auto-log semaphore changes
        const prev = get().conditions;
        if (prev && prev.semaphore !== conditions.semaphore) {
          const msg = `Semaforo: ${prev.semaphore.toUpperCase()} → ${conditions.semaphore.toUpperCase()}`;
          const log = [...get().safetyLog, { timestamp: Date.now(), type: 'semaphore' as const, message: msg }];
          set({ conditions, safetyLog: log });
          return;
        }
        // Auto-log new alerts
        if (conditions.alerts.length > 0 && prev) {
          const newAlerts = conditions.alerts.filter((a) => !prev.alerts.includes(a));
          if (newAlerts.length > 0) {
            const entries: SafetyLogEntry[] = newAlerts.map((a) => ({ timestamp: Date.now(), type: 'alert' as const, message: a }));
            set({ conditions, safetyLog: [...get().safetyLog, ...entries] });
            return;
          }
        }
        set({ conditions });
      },

      addLogEntry: (type, message) => set({
        safetyLog: [...get().safetyLog, { timestamp: Date.now(), type, message }],
      }),

      toggleMinimize: () => set((s) => ({ minimized: !s.minimized })),

      deactivate: () => set({
        active: false,
        minimized: false,
        showZoneSelector: false,
        selectedZoneId: null,
        drawingPhase: 'idle',
        firstCorner: null,
        zone: null,
        zonePolygon: null,
        timerRunning: false,
        timerStartMs: 0,
        elapsedMs: 0,
        buoyMarkers: [],
        conditions: null,
        safetyLog: [],
      }),
    }),
    { name: 'RegattaStore' },
  ),
);
