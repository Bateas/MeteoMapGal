import { create } from 'zustand';

/** What the rain layer found, for the toolbar chip and its legend. Null while it is off. */
export interface RainNowSummary {
  /** Gauges that measured rain (passed the checks), wettest first */
  gauges: { id: string; name: string; mm: number }[];
  /** Spots it rains on now (etaMin 0) or where rain arrives within the hour, soonest first */
  arrivals: { spotId: string; spotName: string; etaMin: number; distanceKm: number }[];
  /** Stable motion of the rain, or null */
  motion: { kmh: number; toDeg: number } | null;
  /** Minutes since the newest radar frame; null without radar */
  radarAgeMin: number | null;
  /** Rain cells drawn */
  cells: number;
  sim: boolean;
}

const KEY = 'rainNow.dismissedDay';
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function readDismissed(): boolean {
  try { return localStorage.getItem(KEY) === today(); } catch { return false; }
}

interface RainNowState {
  summary: RainNowSummary | null;
  /** The user hid the layer for the rest of the day */
  dismissedToday: boolean;
  setSummary: (s: RainNowSummary | null) => void;
  dismissToday: () => void;
}

export const useRainNowStore = create<RainNowState>((set) => ({
  summary: null,
  dismissedToday: readDismissed(),
  setSummary: (summary) => set({ summary }),
  dismissToday: () => {
    try { localStorage.setItem(KEY, today()); } catch { /* private mode: hide for this session only */ }
    set({ dismissedToday: true, summary: null });
  },
}));
