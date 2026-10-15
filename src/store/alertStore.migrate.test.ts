/**
 * Version 1 of the persisted alert store drops the old thumbs-up/down votes (15-oct): they never
 * left the browser and nothing read them. The history must survive the migration.
 */
import { describe, it, expect, vi } from 'vitest';

describe('alertStore persist v1', () => {
  it('keeps the history and drops the old votes from storage', async () => {
    const entry = { id: 'maritime-fog', sectorId: 'rias', category: 'fog', severity: 'moderate', title: 'Riesgo', timestamp: Date.now() };
    localStorage.setItem('meteomap-alert-history', JSON.stringify({
      state: { alertHistory: [entry], validations: [{ alertId: 'maritime-fog', valid: true, validatedAt: Date.now() }] },
      version: 0,
    }));
    vi.resetModules();
    const { useAlertStore } = await import('./alertStore');
    await useAlertStore.persist.rehydrate();
    expect(useAlertStore.getState().alertHistory).toHaveLength(1);
    expect('validations' in useAlertStore.getState()).toBe(false);
    useAlertStore.getState().pruneAlertHistory(); // any write rewrites storage through partialize
    const stored = JSON.parse(localStorage.getItem('meteomap-alert-history')!);
    expect(stored.version).toBe(1);
    expect(stored.state.validations).toBeUndefined();
    expect(stored.state.alertHistory).toHaveLength(1);
  });
});
