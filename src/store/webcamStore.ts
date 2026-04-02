/**
 * Webcam layer store — manages visibility, selection, and vision results.
 */
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { WebcamVisionResult } from '../services/webcamVisionService';

interface WebcamState {
  /** Whether webcam markers are visible on map */
  showOverlay: boolean;
  /** Currently selected webcam ID (for popup) */
  selectedWebcamId: string | null;
  /** Vision analysis results keyed by webcam ID */
  visionResults: Map<string, WebcamVisionResult>;
  /** Toggle webcam layer visibility */
  toggleOverlay: () => void;
  /** Select/deselect a webcam */
  selectWebcam: (id: string | null) => void;
  /** Update vision results from analysis */
  setVisionResults: (results: Map<string, WebcamVisionResult>) => void;
}

export const useWebcamStore = create<WebcamState>()(
  devtools(
    persist(
      (set) => ({
        showOverlay: false,
        selectedWebcamId: null,
        visionResults: new Map(),
        toggleOverlay: () => set((s) => ({ showOverlay: !s.showOverlay }), undefined, 'toggleOverlay'),
        selectWebcam: (id) => set({ selectedWebcamId: id }, undefined, 'selectWebcam'),
        setVisionResults: (results) => set({ visionResults: results }, undefined, 'setVisionResults'),
      }),
      {
        name: 'meteomapgal-webcam',
        partialize: (s) => ({ showOverlay: s.showOverlay }),
      },
    ),
    { name: 'webcamStore' },
  ),
);
