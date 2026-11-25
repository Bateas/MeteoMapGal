/**
 * What the strip over the map is saying right now. Written by ConditionsTicker (always mounted),
 * read by the strip beside the map tools, so that in simple mode a fact has one voice on the screen.
 */
import { create } from 'zustand';

interface LevelZeroState {
  /** Key of the one line under the official warnings, or null when it is silent */
  tickerKey: string | null;
  setTickerKey: (key: string | null) => void;
}

export const useLevelZeroStore = create<LevelZeroState>((set) => ({
  tickerKey: null,
  setTickerKey: (tickerKey) => set((s) => (s.tickerKey === tickerKey ? s : { tickerKey })),
}));
