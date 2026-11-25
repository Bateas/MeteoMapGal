import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  MicroZone, MicroZoneId, ThermalWindRule,
  DailyContext, TendencySignal, AtmosphericContext,
} from '../types/thermal';
import { MICRO_ZONES, DEFAULT_THERMAL_RULES } from '../config/thermalZones';

interface ThermalState {
  // Configuration
  zones: MicroZone[];
  rules: ThermalWindRule[];

  // Tendency detection (precursor signals)
  tendencySignals: Map<MicroZoneId, TendencySignal>;

  // Station → zone mapping (built at runtime)
  stationToZone: Map<string, MicroZoneId>;

  // Daily context (ΔT from Open-Meteo)
  dailyContext: DailyContext | null;

  // Atmospheric context (cloud, radiation, CAPE)
  atmosphericContext: AtmosphericContext | null;


  // Actions
  setTendencySignals: (signals: Map<MicroZoneId, TendencySignal>) => void;
  setStationToZone: (mapping: Map<string, MicroZoneId>) => void;
  setDailyContext: (ctx: DailyContext) => void;
  setAtmosphericContext: (ctx: AtmosphericContext) => void;
  /** Leaving the Embalse: drop what describes its valley (ΔT, atmosphere, tendencies). */
  clearEmbalseContext: () => void;
}

export const useThermalStore = create<ThermalState>()(devtools((set) => ({
  zones: MICRO_ZONES,
  rules: DEFAULT_THERMAL_RULES,
  tendencySignals: new Map(),
  stationToZone: new Map(),
  dailyContext: null,
  atmosphericContext: null,

  setTendencySignals: (tendencySignals) => set({ tendencySignals }),
  setStationToZone: (stationToZone) => set({ stationToZone }),
  setDailyContext: (dailyContext) => set({ dailyContext }),
  setAtmosphericContext: (atmosphericContext) => set({ atmosphericContext }),
  clearEmbalseContext: () => set({ dailyContext: null, atmosphericContext: null, tendencySignals: new Map() }),
}), { name: 'ThermalStore' }));
