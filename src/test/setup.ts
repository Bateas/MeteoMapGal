/**
 * Vitest setup file — global DOM mocks + testing-library matchers.
 */
import '@testing-library/jest-dom/vitest';

// ── Mock maplibre-gl (heavy native dep, not needed in unit tests) ──
vi.mock('maplibre-gl', () => ({
  Map: vi.fn(),
  NavigationControl: vi.fn(),
  Popup: vi.fn(),
  Marker: vi.fn(),
  LngLatBounds: vi.fn(),
}));

// ── Mock react-map-gl/maplibre (avoids canvas/WebGL in jsdom) ──
vi.mock('react-map-gl/maplibre', () => ({
  default: vi.fn(({ children }: { children?: React.ReactNode }) => children),
  Map: vi.fn(({ children }: { children?: React.ReactNode }) => children),
  Marker: vi.fn(() => null),
  Popup: vi.fn(() => null),
  Source: vi.fn(() => null),
  Layer: vi.fn(() => null),
  useMap: vi.fn(() => ({ current: null })),
}));

// ── Stub matchMedia (used by uiStore) ──
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ── Stub ResizeObserver ──
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));
