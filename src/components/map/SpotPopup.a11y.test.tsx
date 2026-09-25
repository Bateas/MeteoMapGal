/**
 * SpotPopup — keyboard and screen-reader behaviour of the spot card.
 *
 * On mobile the card is a bottom sheet over the map. Before this it was an
 * anonymous div: a screen reader never announced it, focus stayed wherever it
 * was, and Escape did nothing (MapLibre's desktop popup ignores Escape too).
 *
 * SpotPopup is lazy-loaded and no other test imports it, so these tests are
 * also the only render check it has outside `npm run build`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// Every network source the card touches on mount. A promise that never
// settles keeps the test offline and leaves no state update after unmount.
const { pending } = vi.hoisted(() => ({ pending: () => new Promise<never>(() => {}) }));

vi.mock('../../services/spotForecastFetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/spotForecastFetch')>()),
  fetchSpotForecast: vi.fn(pending),
  isSpotForecastStale: vi.fn(() => false),
}));
vi.mock('../../api/marineClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/marineClient')>()),
  fetchMarineForecast: vi.fn(pending),
  fetchMarineData: vi.fn(pending),
}));
vi.mock('../../api/meteoSixClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/meteoSixClient')>()),
  fetchMeteoSixSeaTemp: vi.fn(pending),
}));
vi.mock('../../api/swanGetFeatureInfo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/swanGetFeatureInfo')>()),
  fetchSwanHsAt: vi.fn(pending),
}));
vi.mock('../../api/tideClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/tideClient')>()),
  fetchTidePredictions: vi.fn(pending),
  fetchTides48h: vi.fn(pending),
}));

import { SpotPopup } from './SpotPopup';
import { ALL_SPOTS } from '../../config/spots';
import { useSpotStore } from '../../store/spotStore';
import { useUIStore } from '../../store/uiStore';

const spot = ALL_SPOTS[0];

beforeEach(() => {
  // SpotHistoryChart and the baseline badge call fetch directly.
  vi.stubGlobal('fetch', vi.fn(pending));
  useSpotStore.getState().selectSpot(spot.id);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  useUIStore.setState({ isMobile: false });
});

describe('SpotPopup mobile sheet', () => {
  beforeEach(() => {
    useUIStore.setState({ isMobile: true });
  });

  it('is announced as a dialog named after the spot', () => {
    render(<SpotPopup spot={spot} />);
    expect(screen.getByRole('dialog', { name: spot.name })).toBeInTheDocument();
  });

  it('moves focus to the close button on open and gives it back on close', () => {
    const origin = document.createElement('button');
    origin.textContent = 'Origen';
    document.body.appendChild(origin);
    origin.focus();

    const { unmount } = render(<SpotPopup spot={spot} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cerrar' }));

    unmount();
    expect(document.activeElement).toBe(origin);
  });

  it('closes on Escape', () => {
    render(<SpotPopup spot={spot} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(useSpotStore.getState().activeSpotId).toBe('');
  });

  it('leaves Escape to a modal opened on top of it', () => {
    render(<SpotPopup spot={spot} />);
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(useSpotStore.getState().activeSpotId).toBe(spot.id);
  });

  it('ignores Escape pressed inside a text field', () => {
    render(<SpotPopup spot={spot} />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(useSpotStore.getState().activeSpotId).toBe(spot.id);
  });
});

describe('SpotPopup desktop popup', () => {
  it('closes on Escape too (MapLibre popups do not)', () => {
    useUIStore.setState({ isMobile: false });
    render(<SpotPopup spot={spot} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(useSpotStore.getState().activeSpotId).toBe('');
  });
});
