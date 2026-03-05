import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { UnifiedAlert, CompositeRisk } from '../services/alertService';

// ── Alert history entry (persisted) ─────────────────────────

export interface AlertHistoryEntry {
  id: string;
  category: string;
  severity: string;
  title: string;
  timestamp: number; // epoch ms for serialization
}

const MAX_HISTORY = 50;
const DEDUP_WINDOW_MS = 10 * 60 * 1000; // 10 min
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// ── Store ────────────────────────────────────────────────────

interface AlertState {
  /** All active alerts, sorted by score descending */
  alerts: UnifiedAlert[];
  /** Overall composite risk index */
  risk: CompositeRisk;
  /** Whether the alert panel strip is expanded */
  panelExpanded: boolean;
  /** Persisted alert history (last 24h, max 50 entries) */
  alertHistory: AlertHistoryEntry[];

  setAlerts: (alerts: UnifiedAlert[], risk: CompositeRisk) => void;
  togglePanel: () => void;
  setPanelExpanded: (expanded: boolean) => void;
  pruneAlertHistory: () => void;
}

export const useAlertStore = create<AlertState>()(
  devtools(
    persist(
      (set, get) => ({
        alerts: [],
        risk: { score: 0, severity: 'info', color: 'green', activeCount: 0 },
        panelExpanded: false,
        alertHistory: [],

        setAlerts: (alerts, risk) => {
          const now = Date.now();
          const prev = get().alertHistory;

          // Record notable alerts (severity > info) with dedup
          const newEntries: AlertHistoryEntry[] = [];
          for (const a of alerts) {
            if (a.severity === 'info') continue;
            const isDupe = prev.some(
              (h) => h.id === a.id && now - h.timestamp < DEDUP_WINDOW_MS,
            );
            if (!isDupe) {
              newEntries.push({
                id: a.id,
                category: a.category,
                severity: a.severity,
                title: a.title,
                timestamp: now,
              });
            }
          }

          const updatedHistory = newEntries.length > 0
            ? [...newEntries, ...prev].slice(0, MAX_HISTORY)
            : prev;

          set({ alerts, risk, alertHistory: updatedHistory }, undefined, 'setAlerts');
        },

        togglePanel: () =>
          set({ panelExpanded: !get().panelExpanded }, undefined, 'togglePanel'),

        setPanelExpanded: (expanded) =>
          set({ panelExpanded: expanded }, undefined, 'setPanelExpanded'),

        pruneAlertHistory: () => {
          const cutoff = Date.now() - HISTORY_TTL_MS;
          set(
            (s) => ({ alertHistory: s.alertHistory.filter((h) => h.timestamp > cutoff) }),
            undefined,
            'pruneAlertHistory',
          );
        },
      }),
      {
        name: 'meteomap-alert-history',
        // Only persist alertHistory (ephemeral state excluded)
        partialize: (state) => ({ alertHistory: state.alertHistory }),
      },
    ),
    { name: 'AlertStore' },
  ),
);
