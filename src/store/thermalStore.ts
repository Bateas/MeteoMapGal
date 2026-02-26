import { create } from 'zustand';
import type {
  MicroZone, MicroZoneId, ThermalWindRule,
  RuleScore, ZoneAlert, PropagationEvent,
  ForecastPoint, ForecastAlert,
} from '../types/thermal';
import { MICRO_ZONES, DEFAULT_THERMAL_RULES } from '../config/thermalZones';

interface ThermalState {
  // Configuration
  zones: MicroZone[];
  rules: ThermalWindRule[];

  // Live scoring
  ruleScores: RuleScore[];
  zoneAlerts: Map<MicroZoneId, ZoneAlert>;

  // Propagation
  propagationEvents: PropagationEvent[];

  // Forecast
  zoneForecast: Map<MicroZoneId, ForecastPoint[]>;
  forecastAlerts: ForecastAlert[];

  // Station → zone mapping (built at runtime)
  stationToZone: Map<string, MicroZoneId>;

  // UI state
  showZoneOverlays: boolean;
  selectedZoneId: MicroZoneId | null;

  // Actions
  setRuleScores: (scores: RuleScore[]) => void;
  setZoneAlerts: (alerts: Map<MicroZoneId, ZoneAlert>) => void;
  setPropagationEvents: (events: PropagationEvent[]) => void;
  setZoneForecast: (forecast: Map<MicroZoneId, ForecastPoint[]>) => void;
  setForecastAlerts: (alerts: ForecastAlert[]) => void;
  setStationToZone: (mapping: Map<string, MicroZoneId>) => void;
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
  propagationEvents: [],
  zoneForecast: new Map(),
  forecastAlerts: [],
  stationToZone: new Map(),
  showZoneOverlays: true,
  selectedZoneId: null,

  setRuleScores: (ruleScores) => set({ ruleScores }),
  setZoneAlerts: (zoneAlerts) => set({ zoneAlerts }),
  setPropagationEvents: (propagationEvents) => set({ propagationEvents }),
  setZoneForecast: (zoneForecast) => set({ zoneForecast }),
  setForecastAlerts: (forecastAlerts) => set({ forecastAlerts }),
  setStationToZone: (stationToZone) => set({ stationToZone }),

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
