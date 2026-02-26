import { create } from 'zustand';
import type {
  MicroZone, MicroZoneId, ThermalWindRule,
  RuleScore, ZoneAlert, PropagationEvent,
  ForecastPoint, ForecastAlert, DailyContext,
  TendencySignal, AtmosphericContext,
} from '../types/thermal';
import { MICRO_ZONES, DEFAULT_THERMAL_RULES } from '../config/thermalZones';
import type { HumidityAssessment } from '../services/humidityWindAnalyzer';

interface ThermalState {
  // Configuration
  zones: MicroZone[];
  rules: ThermalWindRule[];

  // Live scoring
  ruleScores: RuleScore[];
  zoneAlerts: Map<MicroZoneId, ZoneAlert>;

  // Tendency detection (precursor signals)
  tendencySignals: Map<MicroZoneId, TendencySignal>;

  // Propagation
  propagationEvents: PropagationEvent[];

  // Forecast
  zoneForecast: Map<MicroZoneId, ForecastPoint[]>;
  forecastAlerts: ForecastAlert[];

  // Station → zone mapping (built at runtime)
  stationToZone: Map<string, MicroZoneId>;

  // Daily context (ΔT from Open-Meteo)
  dailyContext: DailyContext | null;

  // Atmospheric context (cloud, radiation, CAPE)
  atmosphericContext: AtmosphericContext | null;

  // Humidity cross-validation per zone
  humidityAssessments: Map<MicroZoneId, HumidityAssessment>;

  // UI state
  showZoneOverlays: boolean;
  selectedZoneId: MicroZoneId | null;

  // Actions
  setRuleScores: (scores: RuleScore[]) => void;
  setZoneAlerts: (alerts: Map<MicroZoneId, ZoneAlert>) => void;
  setTendencySignals: (signals: Map<MicroZoneId, TendencySignal>) => void;
  setPropagationEvents: (events: PropagationEvent[]) => void;
  setZoneForecast: (forecast: Map<MicroZoneId, ForecastPoint[]>) => void;
  setForecastAlerts: (alerts: ForecastAlert[]) => void;
  setStationToZone: (mapping: Map<string, MicroZoneId>) => void;
  setDailyContext: (ctx: DailyContext) => void;
  setAtmosphericContext: (ctx: AtmosphericContext) => void;
  setHumidityAssessments: (assessments: Map<MicroZoneId, HumidityAssessment>) => void;
  toggleZoneOverlays: () => void;
  selectZone: (id: MicroZoneId | null) => void;
  toggleRule: (ruleId: string) => void;
  addRules: (rules: ThermalWindRule[]) => void;
}

export const useThermalStore = create<ThermalState>((set, get) => ({
  zones: MICRO_ZONES,
  rules: DEFAULT_THERMAL_RULES,
  ruleScores: [],
  zoneAlerts: new Map(),
  tendencySignals: new Map(),
  propagationEvents: [],
  zoneForecast: new Map(),
  forecastAlerts: [],
  stationToZone: new Map(),
  dailyContext: null,
  atmosphericContext: null,
  humidityAssessments: new Map(),
  showZoneOverlays: true,
  selectedZoneId: null,

  setRuleScores: (ruleScores) => set({ ruleScores }),
  setZoneAlerts: (zoneAlerts) => set({ zoneAlerts }),
  setTendencySignals: (tendencySignals) => set({ tendencySignals }),
  setPropagationEvents: (propagationEvents) => set({ propagationEvents }),
  setZoneForecast: (zoneForecast) => set({ zoneForecast }),
  setForecastAlerts: (forecastAlerts) => set({ forecastAlerts }),
  setStationToZone: (stationToZone) => set({ stationToZone }),
  setDailyContext: (dailyContext) => set({ dailyContext }),
  setAtmosphericContext: (atmosphericContext) => set({ atmosphericContext }),
  setHumidityAssessments: (humidityAssessments) => set({ humidityAssessments }),

  toggleZoneOverlays: () => set({ showZoneOverlays: !get().showZoneOverlays }),

  selectZone: (selectedZoneId) => set({ selectedZoneId }),

  toggleRule: (ruleId) => {
    const { rules } = get();
    set({
      rules: rules.map((r) =>
        r.id === ruleId ? { ...r, enabled: !r.enabled } : r
      ),
    });
  },

  addRules: (newRules) => {
    const { rules } = get();
    // Merge: replace existing by id, add new ones
    const ruleMap = new Map(rules.map((r) => [r.id, r]));
    for (const rule of newRules) {
      ruleMap.set(rule.id, rule);
    }
    set({ rules: Array.from(ruleMap.values()) });
  },
}));

/**
 * Get the highest alert level across all zones.
 * Useful for the header badge.
 */
export function getMaxAlertLevel(
  alerts: Map<MicroZoneId, ZoneAlert>
): { level: string; score: number } {
  let maxScore = 0;
  let maxLevel = 'none';

  for (const alert of alerts.values()) {
    if (alert.maxScore > maxScore) {
      maxScore = alert.maxScore;
      maxLevel = alert.alertLevel;
    }
  }

  return { level: maxLevel, score: maxScore };
}
