import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { UnifiedAlert, CompositeRisk } from '../services/alertService';

// The history of alerts lived only in this browser, mixed sectors and read as a record it was not:
// out with the V3. It leaves what it stored behind.
try { localStorage.removeItem('meteomap-alert-history'); } catch { /* private mode */ }

// ── Store ────────────────────────────────────────────────────

interface AlertState {
  /** All active alerts, sorted by score descending */
  alerts: UnifiedAlert[];
  /** Overall composite risk index */
  risk: CompositeRisk;

  setAlerts: (alerts: UnifiedAlert[], risk: CompositeRisk) => void;
}

export const useAlertStore = create<AlertState>()(
  devtools(
    (set) => ({
      alerts: [],
      risk: { score: 0, severity: 'info', color: 'green', activeCount: 0 },

      setAlerts: (alerts, risk) => set({ alerts, risk }, undefined, 'setAlerts'),
    }),
    { name: 'AlertStore' },
  ),
);
