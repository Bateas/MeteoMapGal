/**
 * createSelectors — auto-generates typed selector hooks for Zustand stores.
 *
 * Prevents the crash pattern where `useStore((s) => s.wrongName)` silently
 * returns undefined at runtime (TypeScript doesn't catch it because selectors
 * are generic functions).
 *
 * Usage:
 *   const useStore = createSelectors(useStoreBase);
 *   // Now: useStore.use.propertyName() — compile-time error if name is wrong
 *   // Still works: useStore((s) => s.propertyName) — but prefer .use.xxx()
 *
 * Based on: https://docs.pmnd.rs/zustand/guides/auto-generating-selectors
 */
import type { StoreApi, UseBoundStore } from 'zustand';

type WithSelectors<S> = S extends { getState: () => infer T }
  ? S & { use: { [K in keyof T]: () => T[K] } }
  : never;

export function createSelectors<S extends UseBoundStore<StoreApi<object>>>(
  _store: S,
): WithSelectors<S> {
  const store = _store as WithSelectors<S>;
  store.use = {} as WithSelectors<S>['use'];
  for (const k of Object.keys(store.getState())) {
    (store.use as Record<string, () => unknown>)[k] = () =>
      store((s: Record<string, unknown>) => s[k]);
  }
  return store;
}
