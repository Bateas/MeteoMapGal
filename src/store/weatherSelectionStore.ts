import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

/**
 * UI selection state extracted from weatherStore.
 *
 * Owns: which station is selected/highlighted, which stations appear in charts.
 * weatherStore.setStations([]) calls resetSelection() on sector switch.
 */
interface WeatherSelectionState {
  selectedStationId: string | null;
  highlightedStationId: string | null;
  chartSelectedStations: string[];

  selectStation: (id: string | null) => void;
  highlightStation: (id: string | null) => void;
  toggleChartStation: (id: string) => void;
  /** Reset all selection state (called on sector switch) */
  resetSelection: () => void;
}

export const useWeatherSelectionStore = create<WeatherSelectionState>()(devtools((set, get) => ({
  selectedStationId: null,
  highlightedStationId: null,
  chartSelectedStations: [],

  selectStation: (id) => set({ selectedStationId: id }, undefined, 'selectStation'),
  highlightStation: (id) => set({ highlightedStationId: id }, undefined, 'highlightStation'),

  toggleChartStation: (id) => {
    const { chartSelectedStations } = get();
    const index = chartSelectedStations.indexOf(id);
    if (index >= 0) {
      set({ chartSelectedStations: chartSelectedStations.filter((s) => s !== id) }, undefined, 'toggleChartStation');
    } else {
      set({ chartSelectedStations: [...chartSelectedStations, id] }, undefined, 'toggleChartStation');
    }
  },

  resetSelection: () => set({
    selectedStationId: null,
    highlightedStationId: null,
    chartSelectedStations: [],
  }, undefined, 'resetSelection'),
}), { name: 'WeatherSelectionStore' }));
