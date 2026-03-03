import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { SECTORS, DEFAULT_SECTOR_ID, type Sector } from '../config/sectors';

interface SectorState {
  activeSectorId: string;
  activeSector: Sector;
  switchSector: (sectorId: string) => void;
}

export const useSectorStore = create<SectorState>()(
  devtools(
    persist(
      (set) => ({
        activeSectorId: DEFAULT_SECTOR_ID,
        activeSector: SECTORS.find((s) => s.id === DEFAULT_SECTOR_ID)!,

        switchSector: (sectorId: string) => {
          const sector = SECTORS.find((s) => s.id === sectorId);
          if (!sector) return;
          set({ activeSectorId: sectorId, activeSector: sector }, undefined, 'switchSector');
        },
      }),
      { name: 'sector-store', partialize: (state) => ({ activeSectorId: state.activeSectorId }) },
    ),
    { name: 'SectorStore' },
  ),
);

// Rehydrate activeSector from persisted activeSectorId
const persisted = useSectorStore.getState();
const match = SECTORS.find((s) => s.id === persisted.activeSectorId);
if (match && match.id !== persisted.activeSector.id) {
  useSectorStore.setState({ activeSector: match });
}
