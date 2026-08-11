/**
 * Zustand store for sailing spot selection (multi-sector).
 *
 * Tracks active spot, per-spot scoring results, and loading state.
 * Persisted to localStorage so spot selection survives page refresh.
 */
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { ALL_SPOTS, DEFAULT_SPOT_ID, type SailingSpot } from '../config/spots';
import type { SpotScore } from '../services/spotScoringEngine';
import type { SpotWindowResult } from '../services/sailingWindowService';
import type { ThermalPrecursorResult } from '../services/thermalPrecursorService';
import type { WebcamVisionResult } from '../services/webcamVisionService';
import type { HourlyForecast } from '../types/forecast';

/** Historical wind speed entry for sparkline */
/** Points older than this are dropped when rehydrating: the sparkline is
 *  labelled "2h" and must not splice yesterday onto today. Matches MAX_HISTORY
 *  (24 points at five-minute intervals) from the other end. */
export const WIND_HISTORY_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export interface SpotWindSnapshot {
  ts: number;
  kt: number;
}

interface SpotState {
  /** Currently selected spot ID */
  activeSpotId: string;
  /** Resolved spot object */
  activeSpot: SailingSpot;
  /** User's favorite spot ID (persisted, auto-flyto on load) */
  favoriteSpotId: string | null;
  /** Per-spot scoring results (keyed by spot.id) */
  scores: Map<string, SpotScore>;
  /** Last scoring computation timestamp */
  lastScored: number;
  /** Per-spot wind speed history for sparklines (keyed by spot.id, last ~2h) */
  windHistory: Map<string, SpotWindSnapshot[]>;
  /** Per-spot sailing window results (keyed by spot.id) */
  sailingWindows: Map<string, SpotWindowResult>;
  /** Last sailing window computation timestamp */
  windowsFetchedAt: number;
  /** Raw sector forecast (for forecast vs observation delta) */
  sectorForecast: HourlyForecast[];
  /** Per-spot thermal precursor results (keyed by spot.id) */
  thermalPrecursors: Map<string, ThermalPrecursorResult>;
  /** Last thermal precursor computation timestamp */
  precursorsFetchedAt: number;
  /** Per-spot webcam vision results (keyed by spot.id) */
  webcamVision: Map<string, WebcamVisionResult>;
  /** Last webcam vision analysis timestamp */
  visionAnalyzedAt: number;
  /** Per-surf-spot wave data + computed verdict from Open-Meteo Marine (keyed by spot.id) */
  surfWaveCache: Map<string, { waveHeight: number; swellHeight: number | null; period: number; verdictLabel?: string; verdictColor?: string }>;
  /** Per-spot WRF 1km forecast cache (keyed by spot.id, fetched on popup open) */
  spotForecasts: Map<string, { data: HourlyForecast[]; fetchedAt: number }>;
}

interface SpotActions {
  selectSpot: (spotId: string) => void;
  toggleFavorite: (spotId: string) => void;
  setScores: (scores: Map<string, SpotScore>) => void;
  setSailingWindows: (windows: Map<string, SpotWindowResult>) => void;
  setSectorForecast: (forecast: HourlyForecast[]) => void;
  setThermalPrecursors: (precursors: Map<string, ThermalPrecursorResult>) => void;
  setWebcamVision: (results: Map<string, WebcamVisionResult>) => void;
  setSurfWave: (spotId: string, data: { waveHeight: number; swellHeight: number | null; period: number; verdictLabel?: string; verdictColor?: string }) => void;
  setSpotForecast: (spotId: string, data: HourlyForecast[]) => void;
}

export const useSpotStore = create<SpotState & SpotActions>()(
  devtools(
    persist(
      (set) => ({
        // activeSpotId starts empty so no popup auto-opens on first visit
        // (user reported: "estoy en zona embalse y se me activa el popup del
        //  spot cesantes" — Cesantes is a Rías spot, leaked from hardcoded
        //  DEFAULT_SPOT_ID across sectors). activeSpot remains the
        // Cesantes object only as a type fallback — it is never displayed
        // because WeatherMap gates the popup on `activeSpotId !== ''`.
        activeSpotId: '',
        activeSpot: ALL_SPOTS.find((s) => s.id === DEFAULT_SPOT_ID)!,
        favoriteSpotId: null,
        scores: new Map(),
        lastScored: 0,
        windHistory: new Map(),
        sailingWindows: new Map(),
        windowsFetchedAt: 0,
        sectorForecast: [],
        thermalPrecursors: new Map(),
        precursorsFetchedAt: 0,
        webcamVision: new Map(),
        visionAnalyzedAt: 0,
        surfWaveCache: new Map(),
        spotForecasts: new Map(),

        toggleFavorite: (spotId: string) => {
          const current = useSpotStore.getState().favoriteSpotId;
          set({ favoriteSpotId: current === spotId ? null : spotId }, undefined, 'toggleFavorite');
        },

        selectSpot: (spotId: string) => {
          // Empty string = deselect (close popup, keep last activeSpot for reference)
          if (!spotId) {
            set({ activeSpotId: '' }, undefined, 'deselectSpot');
            return;
          }
          const spot = ALL_SPOTS.find((s) => s.id === spotId);
          if (!spot) return;
          set({ activeSpotId: spotId, activeSpot: spot }, undefined, 'selectSpot');
        },

        setScores: (scores) => {
          const now = Date.now();
          const MAX_HISTORY = 24; // ~2h at 5min intervals
          const prev = useSpotStore.getState().windHistory;
          const next = new Map(prev);
          for (const [spotId, sc] of scores) {
            if (sc.wind) {
              const arr = next.get(spotId) ?? [];
              // Avoid duplicate if scored within 60s of last entry
              if (arr.length === 0 || now - arr[arr.length - 1].ts > 60_000) {
                const updated = [...arr, { ts: now, kt: sc.wind.avgSpeedKt }];
                next.set(spotId, updated.length > MAX_HISTORY ? updated.slice(-MAX_HISTORY) : updated);
              }
            }
          }
          set({ scores, lastScored: now, windHistory: next }, undefined, 'setScores');
        },

        setSailingWindows: (sailingWindows) =>
          set({ sailingWindows, windowsFetchedAt: Date.now() }, undefined, 'setSailingWindows'),

        setSectorForecast: (sectorForecast) =>
          set({ sectorForecast }, undefined, 'setSectorForecast'),

        setThermalPrecursors: (thermalPrecursors) =>
          set({ thermalPrecursors, precursorsFetchedAt: Date.now() }, undefined, 'setThermalPrecursors'),

        setWebcamVision: (webcamVision) =>
          set({ webcamVision, visionAnalyzedAt: Date.now() }, undefined, 'setWebcamVision'),

        setSurfWave: (spotId, data) => {
          const next = new Map(useSpotStore.getState().surfWaveCache);
          next.set(spotId, data);
          set({ surfWaveCache: next }, undefined, 'setSurfWave');
        },
        setSpotForecast: (spotId, data) => {
          const next = new Map(useSpotStore.getState().spotForecasts);
          next.set(spotId, { data, fetchedAt: Date.now() });
          set({ spotForecasts: next }, undefined, 'setSpotForecast');
        },
      }),
      {
        name: 'spot-store',
        partialize: (state) => ({
          activeSpotId: state.activeSpotId,
          favoriteSpotId: state.favoriteSpotId,
          // The wind history survives a reload, so the sparkline is there when
          // the popup opens instead of forty minutes later.
          //
          // It is built at five-minute intervals and drawn only from three
          // points up, so from a cold start it took roughly a quarter of an
          // hour to appear — and a refresh sent it back to zero. That is the
          // difference between a chart you rely on and one you never see.
          //
          // A Map does not survive JSON, so it goes out as pairs and comes back
          // through `merge` below.
          //
          // Note the project's own rule against putting time series in local
          // storage, which came from writing ninety days of CSV per station and
          // reaching 190MB. This is three orders of magnitude away: fourteen
          // spots, twenty-four points each, two numbers per point — about 15KB.
          // The rule is about unbounded series, and this one is bounded twice
          // over, by MAX_HISTORY and by the age cutoff on the way back in.
          windHistory: [...state.windHistory.entries()],
        }),
        // Rehydrate the Map, dropping anything past the window the chart claims
        // to show. Stale points are worse than none: the sparkline is labelled
        // "2h" and would otherwise splice yesterday's evening onto this
        // morning as though the two were continuous.
        merge: (persisted, current) => {
          const p = (persisted ?? {}) as Partial<SpotState> & {
            windHistory?: [string, SpotWindSnapshot[]][];
          };
          const cutoff = Date.now() - WIND_HISTORY_MAX_AGE_MS;
          const restored = new Map<string, SpotWindSnapshot[]>();
          for (const [spotId, points] of p.windHistory ?? []) {
            const fresh = (points ?? []).filter((pt) => pt?.ts > cutoff);
            if (fresh.length > 0) restored.set(spotId, fresh);
          }
          return { ...current, ...p, windHistory: restored };
        },
      },
    ),
    { name: 'SpotStore' },
  ),
);

// Rehydrate activeSpot from persisted activeSpotId
const persisted = useSpotStore.getState();
const match = ALL_SPOTS.find((s) => s.id === persisted.activeSpotId);
if (match && match.id !== persisted.activeSpot.id) {
  useSpotStore.setState({ activeSpot: match });
}
