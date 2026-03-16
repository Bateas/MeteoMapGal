import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { UnifiedAlert, CompositeRisk } from '../services/alertService';
import { useSectorStore } from './sectorStore';

// ── Alert history entry (persisted) ─────────────────────────

export interface AlertHistoryEntry {
  id: string;
  category: string;
  severity: string;
  title: string;
  timestamp: number; // epoch ms for serialization
}

// ── Alert validation (user feedback) ─────────────────────

export interface AlertValidation {
  /** Alert id (e.g. "maritime-fog", "cross-sea") */
  alertId: string;
  /** Sector where the alert was validated (prevents cross-sector bleed) */
  sectorId: string;
  /** When the alert fired */
  alertTime: number; // epoch ms
  /** Alert details at time of validation */
  title: string;
  detail: string;
  score: number;
  category: string;
  /** User validation */
  valid: boolean; // true = correct, false = false positive
  validatedAt: number; // epoch ms
  notes?: string;
}

const MAX_VALIDATIONS = 200;
const VALIDATION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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
  /** User validations of alerts (persisted, last 30 days) */
  validations: AlertValidation[];

  setAlerts: (alerts: UnifiedAlert[], risk: CompositeRisk) => void;
  togglePanel: () => void;
  setPanelExpanded: (expanded: boolean) => void;
  pruneAlertHistory: () => void;
  /** Record a user's validation of an active alert */
  validateAlert: (alertId: string, valid: boolean, notes?: string) => void;
  /** Remove stale validations older than 30 days */
  pruneValidations: () => void;
}

export const useAlertStore = create<AlertState>()(
  devtools(
    persist(
      (set, get) => ({
        alerts: [],
        risk: { score: 0, severity: 'info', color: 'green', activeCount: 0 },
        panelExpanded: false,
        alertHistory: [],
        validations: [],

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

        validateAlert: (alertId, valid, notes) => {
          const alert = get().alerts.find((a) => a.id === alertId);
          if (!alert) return;

          const sectorId = useSectorStore.getState().activeSector.id;

          const validation: AlertValidation = {
            alertId: alert.id,
            sectorId,
            alertTime: alert.updatedAt.getTime(),
            title: alert.title,
            detail: alert.detail,
            score: alert.score,
            category: alert.category,
            valid,
            validatedAt: Date.now(),
            notes,
          };

          set(
            (s) => ({
              validations: [validation, ...s.validations].slice(0, MAX_VALIDATIONS),
            }),
            undefined,
            'validateAlert',
          );
        },

        pruneValidations: () => {
          const cutoff = Date.now() - VALIDATION_TTL_MS;
          set(
            (s) => ({ validations: s.validations.filter((v) => v.validatedAt > cutoff) }),
            undefined,
            'pruneValidations',
          );
        },
      }),
      {
        name: 'meteomap-alert-history',
        // Persist alertHistory + validations (ephemeral state excluded)
        partialize: (state) => ({
          alertHistory: state.alertHistory,
          validations: state.validations,
        }),
      },
    ),
    { name: 'AlertStore' },
  ),
);
