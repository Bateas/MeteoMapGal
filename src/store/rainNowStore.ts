import { create } from 'zustand';
import type { ArrivalCheck } from '../services/rainArrivalChecks';

/** What the rain layer found, for the toolbar chip and its legend. Null while it is off. */
export interface RainNowSummary {
  /** Gauges that measured rain (passed the checks), wettest first */
  gauges: { id: string; name: string; mm: number }[];
  /** Spots it rains on now (etaMin 0) or where rain arrives within ARRIVAL_MAX_MIN, soonest first */
  arrivals: { spotId: string; spotName: string; etaMin: number; distanceKm: number }[];
  /** Rain outside the sector heading into it, soonest first */
  approaching: { fromDeg: number; distanceKm: number; kmh: number; toDeg: number; etaMin: number }[];
  /** Stable motion of the whole radar picture, or null */
  motion: { kmh: number; toDeg: number } | null;
  /** Minutes since the newest radar frame; null without radar */
  radarAgeMin: number | null;
  /** Rain cells drawn */
  cells: number;
  sim: boolean;
}

/** Last analysis, for `__meteomapDebug.rainNow()` on the first rainy days (calibration). */
export interface RainNowDebug {
  at: string;
  frames: number;
  motion: { kmh: number; toDeg: number; stable: boolean } | null;
  cells: { lat: number; lon: number; px: number; dbz: number; ground: string; kind: string; kmh: number; toDeg: number; steady: boolean; growth: number | null; drawn: boolean }[];
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
  /** Announced arrivals and whether they came (this session only) */
  checks: ArrivalCheck[];
  debug: RainNowDebug | null;
  /** The user hid the layer for the rest of the day */
  dismissedToday: boolean;
  setSummary: (s: RainNowSummary | null) => void;
  setChecks: (c: ArrivalCheck[]) => void;
  setDebug: (d: RainNowDebug | null) => void;
  dismissToday: () => void;
}

export const useRainNowStore = create<RainNowState>((set) => ({
  summary: null,
  checks: [],
  debug: null,
  dismissedToday: readDismissed(),
  setSummary: (summary) => set({ summary }),
  setChecks: (checks) => set({ checks }),
  setDebug: (debug) => set({ debug }),
  dismissToday: () => {
    try { localStorage.setItem(KEY, today()); } catch { /* private mode: hide for this session only */ }
    set({ dismissedToday: true, summary: null });
  },
}));
