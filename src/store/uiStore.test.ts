import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * simpleMode is a default, not a migration: a new visitor starts in simple mode,
 * and anyone who already saved a preference keeps it. Both halves are checked
 * against a fresh module so persist hydrates from the localStorage we set.
 */
async function freshStore() {
  vi.resetModules();
  const mod = await import('./uiStore');
  return mod.useUIStore;
}

describe('uiStore — simpleMode default', () => {
  beforeEach(() => localStorage.clear());

  it('a new visitor starts in simple mode', async () => {
    const store = await freshStore();
    expect(store.getState().simpleMode).toBe(true);
  });

  it('a saved "advanced" preference is kept', async () => {
    localStorage.setItem('meteomap-ui', JSON.stringify({ state: { onboardingCompleted: true, simpleMode: false }, version: 0 }));
    const store = await freshStore();
    expect(store.getState().simpleMode).toBe(false);
  });

  it('the toggle still flips it both ways', async () => {
    const store = await freshStore();
    store.getState().toggleSimpleMode();
    expect(store.getState().simpleMode).toBe(false);
    store.getState().toggleSimpleMode();
    expect(store.getState().simpleMode).toBe(true);
  });
});
