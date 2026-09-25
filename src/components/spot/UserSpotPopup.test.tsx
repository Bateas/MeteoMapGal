/**
 * UserSpotPopup — Escape closes the pin popup, except inside the rename field.
 *
 * The rename input already uses Escape to cancel the edit. The popup-level
 * handler runs in the capture phase, before that input's own handler, so
 * without the text-field exception a single Escape would throw away the
 * popup along with the edit.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// The shared setup stubs Popup as `() => null`; here its children are needed
// so the rename field can be reached.
vi.mock('react-map-gl/maplibre', () => ({
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

// A coastal pin looks up the next tide; keep that offline.
vi.mock('../../api/tideClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/tideClient')>()),
  fetchTidePredictions: vi.fn(() => new Promise<never>(() => {})),
}));

import { UserSpotPopup } from './UserSpotPopup';
import { useUserSpotStore } from '../../store/userSpotStore';
import type { UserSpot } from '../../config/userSpots';

const pin: UserSpot = {
  id: 'user-test-1',
  name: 'Mi sitio',
  center: [-8.75, 42.32],
  sectorId: 'rias',
  createdAt: Date.now(),
};

beforeEach(() => {
  useUserSpotStore.setState({ userSpots: [pin], selectedUserSpotId: pin.id } as never);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('UserSpotPopup and Escape', () => {
  it('Escape closes the popup', () => {
    render(<UserSpotPopup spot={pin} />);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(useUserSpotStore.getState().selectedUserSpotId).toBeNull();
  });

  it('Escape in the rename field cancels the edit and keeps the popup open', () => {
    render(<UserSpotPopup spot={pin} />);
    fireEvent.click(screen.getByTitle('Cambiar nombre'));
    const field = screen.getByRole('textbox', { name: 'Nombre del spot' });
    expect(document.activeElement).toBe(field);

    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Nombre del spot' })).toBeNull();
    expect(useUserSpotStore.getState().selectedUserSpotId).toBe(pin.id);
  });

  it('an aria-modal dialog on top keeps the popup open', () => {
    render(<UserSpotPopup spot={pin} />);
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(useUserSpotStore.getState().selectedUserSpotId).toBe(pin.id);
  });
});
