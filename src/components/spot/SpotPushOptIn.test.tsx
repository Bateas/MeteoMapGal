/**
 * SpotPushOptIn — opt-in row states with the push client fully mocked.
 *
 * The transport/permission mechanics are covered in pushClient.test.ts; here
 * we assert WHAT the user sees per state: hidden when unsupported, a single
 * CTA line when off, the active row with Probar/Quitar when on, and the
 * discreet blocked message after a denied permission.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SpotPushOptIn } from './SpotPushOptIn';
import {
  isPushSupported,
  getSubscribedSpots,
  subscribeSpot,
  unsubscribeSpot,
  sendTestPush,
} from '../../api/pushClient';
import { useToastStore } from '../../store/toastStore';

vi.mock('../../api/pushClient', () => ({
  isPushSupported: vi.fn(),
  getSubscribedSpots: vi.fn(),
  subscribeSpot: vi.fn(),
  unsubscribeSpot: vi.fn(),
  sendTestPush: vi.fn(),
}));

const SPOT = { id: 'patos', name: 'Praia de Patos' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isPushSupported).mockReturnValue(true);
  vi.mocked(getSubscribedSpots).mockReturnValue([]);
  vi.mocked(subscribeSpot).mockResolvedValue('on');
  vi.mocked(unsubscribeSpot).mockResolvedValue('off');
  vi.mocked(sendTestPush).mockResolvedValue(true);
  useToastStore.setState({ toasts: [] });
});

describe('SpotPushOptIn', () => {
  it('renders nothing when push is unsupported', () => {
    vi.mocked(isPushSupported).mockReturnValue(false);
    const { container } = render(<SpotPushOptIn spot={SPOT} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the opt-in CTA when the spot is not subscribed', () => {
    render(<SpotPushOptIn spot={SPOT} />);
    const cta = screen.getByRole('button', { name: /Avisarme si hay tormenta cerca/ });
    expect(cta).toHaveAttribute('aria-pressed', 'false');
  });

  it('flows to the active state after a successful subscribe', async () => {
    render(<SpotPushOptIn spot={SPOT} />);

    fireEvent.click(screen.getByRole('button', { name: /Avisarme si hay tormenta cerca/ }));

    expect(await screen.findByText('Aviso de tormenta activado')).toBeInTheDocument();
    expect(subscribeSpot).toHaveBeenCalledWith('patos');
    expect(screen.getByRole('button', { name: 'Probar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quitar aviso de tormenta' })).toBeInTheDocument();
  });

  it('shows the discreet blocked message when permission is denied', async () => {
    vi.mocked(subscribeSpot).mockResolvedValue('denied');
    render(<SpotPushOptIn spot={SPOT} />);

    fireEvent.click(screen.getByRole('button', { name: /Avisarme si hay tormenta cerca/ }));

    expect(
      await screen.findByText('Notificaciones bloqueadas en el navegador')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('starts in the active state when the spot is already subscribed', () => {
    vi.mocked(getSubscribedSpots).mockReturnValue(['patos']);
    render(<SpotPushOptIn spot={SPOT} />);
    expect(screen.getByText('Aviso de tormenta activado')).toBeInTheDocument();
  });

  it('returns to the CTA after Quitar', async () => {
    vi.mocked(getSubscribedSpots).mockReturnValue(['patos']);
    render(<SpotPushOptIn spot={SPOT} />);

    fireEvent.click(screen.getByRole('button', { name: 'Quitar aviso de tormenta' }));

    expect(
      await screen.findByRole('button', { name: /Avisarme si hay tormenta cerca/ })
    ).toBeInTheDocument();
    expect(unsubscribeSpot).toHaveBeenCalledWith('patos');
  });

  it('fires the test push and reports the result through a toast', async () => {
    vi.mocked(getSubscribedSpots).mockReturnValue(['patos']);
    render(<SpotPushOptIn spot={SPOT} />);

    fireEvent.click(screen.getByRole('button', { name: 'Probar' }));

    expect(sendTestPush).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
        'Notificación de prueba enviada'
      );
    });
  });
});
