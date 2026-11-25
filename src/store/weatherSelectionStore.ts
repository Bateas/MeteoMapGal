import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

/**
 * UI selection state extracted from weatherStore.
 *
 * Owns: which station is selected/highlighted, which one the History tab loads.
 * weatherStore.setStations([]) calls resetSelection() on sector switch.
 */
interface WeatherSelectionState {
  selectedStationId: string | null;
  highlightedStationId: string | null;
  /** Station ID to load in History tab (set by popup "Ver historial" or map click in history tab) */
  historyStationId: string | null;

  selectStation: (id: string | null) => void;
  highlightStation: (id: string | null) => void;
  openHistory: (stationId: string) => void;
  /** Reset all selection state (called on sector switch) */
  resetSelection: () => void;
}

export const useWeatherSelectionStore = create<WeatherSelectionState>()(devtools((set) => ({
  selectedStationId: null,
  highlightedStationId: null,
  historyStationId: null,

  selectStation: (id) => set({ selectedStationId: id }, undefined, 'selectStation'),
  highlightStation: (id) => set({ highlightedStationId: id }, undefined, 'highlightStation'),
  openHistory: (stationId) => set({ historyStationId: stationId }, undefined, 'openHistory'),

  resetSelection: () => set({
    selectedStationId: null,
    highlightedStationId: null,
    historyStationId: null,
  }, undefined, 'resetSelection'),
}), { name: 'WeatherSelectionStore' }));
