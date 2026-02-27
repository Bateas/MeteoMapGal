import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { UnifiedAlert, CompositeRisk } from '../services/alertService';

interface AlertState {
  /** All active alerts, sorted by score descending */
  alerts: UnifiedAlert[];
  /** Overall composite risk index */
  risk: CompositeRisk;
  /** Whether the alert panel strip is expanded */
  panelExpanded: boolean;

  setAlerts: (alerts: UnifiedAlert[], risk: CompositeRisk) => void;
  togglePanel: () => void;
  setPanelExpanded: (expanded: boolean) => void;
}

export const useAlertStore = create<AlertState>()(
  devtools(
    (set, get) => ({
      alerts: [],
      risk: { score: 0, severity: 'info', color: 'green', activeCount: 0 },
      panelExpanded: false,

      setAlerts: (alerts, risk) =>
        set({ alerts, risk }, undefined, 'setAlerts'),

      togglePanel: () =>
        set({ panelExpanded: !get().panelExpanded }, undefined, 'togglePanel'),

      setPanelExpanded: (expanded) =>
        set({ panelExpanded: expanded }, undefined, 'setPanelExpanded'),
    }),
    { name: 'AlertStore' },
  ),
);
